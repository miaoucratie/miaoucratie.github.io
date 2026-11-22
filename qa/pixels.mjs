/* Comparaison au pixel avec la base */
// node qa/pixels.mjs [pages] [--base] [--largeurs] [--temoin]

import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const option = (nom, defaut) => { const i = process.argv.indexOf(nom); return i > 0 ? process.argv[i + 1] : defaut; };
const BASE = option('--base', 'origin/main');
const LARGEURS = option('--largeurs', '1280,1024,900,768,600,480,375,320').split(',').map(Number);
const TEMOIN = option('--temoin', '');
const SORTIE = option('--sortie', join(tmpdir(), 'miaoucratie-pixels'));
const CACHE = join(SORTIE, 'externes');
const valeurs = new Set(['--base', '--largeurs', '--temoin', '--sortie'].map((n) => option(n)).filter(Boolean));
/* Exceptions nommées */
const EXCEPTIONS = [
  { selecteur: '.art-cycle-legende', raison: 'bord bas de la légende du cycle, centrée par translateY(-50 %)' },
];
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html') && !valeurs.has(a));

/* Une page */
async function comparerUnePage(page) {
  /* Horloge figée, côté serveur d'essai */
  const T0 = Date.parse('2026-11-20T10:00:00+01:00');
  const VraieDate = Date;
  globalThis.Date = class extends VraieDate {
    constructor(...a) { super(...(a.length ? a : [T0])); }
    static now() { return T0; }
  };
  const { chromium } = await import('playwright');
  const { demarrerFauxWorker, demarrerServeur } = await import('./qa.mjs');
  const { parcourirEtats, suivi } = await import('./etats.mjs');

  /* Chien de garde */
  let cote = 'base', minuteur;
  const relancer = () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => { process.stdout.write(`${JSON.stringify({ page, bloque: `${cote}, ${suivi.etape}` })}\n`); process.exit(2); }, 120000);
    minuteur.unref();
  };
  relancer();

  /* Ressources externes rejouées */
  await mkdir(CACHE, { recursive: true });
  let portBranche = '';
  async function rejouer(route) {
    const req = route.request();
    const u = new URL(req.url());
    if (TEMOIN && u.hostname === '127.0.0.1' && u.port === portBranche && u.pathname.endsWith('/css/style.css')) {
      const r = await route.fetch();
      return route.fulfill({ response: r, body: `${await r.text()}\n${TEMOIN}` });
    }
    if (req.method() !== 'GET' || u.hostname === '127.0.0.1') return route.fallback();
    const fichier = join(CACHE, createHash('sha1').update(u.hostname.replace(/^[abc]\.tile\./, 'tile.') + u.pathname + u.search).digest('hex'));
    if (!existsSync(`${fichier}.json`)) {
      const r = await route.fetch();
      await writeFile(fichier, await r.body());
      await writeFile(`${fichier}.json`, JSON.stringify({ status: r.status(), headers: r.headers() }));
    }
    const meta = JSON.parse(await readFile(`${fichier}.json`, 'utf8'));
    delete meta.headers['content-encoding'];
    delete meta.headers['content-length'];
    return route.fulfill({ status: meta.status, headers: meta.headers, body: await readFile(fichier) });
  }

  /* Rendu stable */
  const vraiNav = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--disable-partial-raster', '--disable-skia-runtime-opts'] });
  const nav = {
    newContext: async (o) => {
      const c = await vraiNav.newContext(o);
      await c.clock.setFixedTime(T0);
      await c.route('**/*', rejouer);
      await c.addInitScript(() => {
        const tot = () => document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
        new MutationObserver(tot).observe(document, { subtree: true, childList: true });
      });
      return c;
    },
  };
  const photo = (p) => p.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  const zonesDe = async (p) => {
    const lire = (liste) => liste.flatMap((sel) => [...document.querySelectorAll(sel)].map((e) => {
      const r = e.getBoundingClientRect();
      return { y: Math.floor(r.bottom + scrollY), x0: Math.floor(r.left + scrollX), x1: Math.ceil(r.right + scrollX) };
    })).filter((z) => z.x1 > z.x0);
    const cdp = await p.context().newCDPSession(p);
    const r = await cdp.send('Runtime.evaluate', { expression: `(${lire})(${JSON.stringify(EXCEPTIONS.map((e) => e.selecteur))})`, returnByValue: true });
    await cdp.detach();
    return r.result.value || [];
  };

  /* Pixels différents hors exceptions */
  async function compter(a, b, zones) {
    const ctx = await vraiNav.newContext();
    const p = await ctx.newPage();
    const r = await p.evaluate(async ([da, db, zones]) => {
      const charger = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [ia, ib] = await Promise.all([charger(da), charger(db)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { n: -1, zone: `taille ${ia.width}×${ia.height} → ${ib.width}×${ib.height}` };
      const lire = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
      const pa = lire(ia), pb = lire(ib);
      let n = 0, exceptes = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < pa.length; i += 4) {
        if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2] || pa[i + 3] !== pb[i + 3]) {
          const k = i / 4, x = k % ia.width, y = (k - x) / ia.width;
          if (zones.some((z) => y === z.y && x >= z.x0 && x <= z.x1)) { exceptes++; continue; }
          n++;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      return { n, exceptes, zone: n ? `${n} pixels, x ${x0}–${x1}, y ${y0}–${y1}` : '' };
    }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`, zones]);
    await ctx.close();
    return r;
  }

  const dossierBase = await mkdtemp(join(tmpdir(), 'pixels-base-'));
  execFileSync('sh', ['-c', `git archive "${BASE}" | tar -x -C "${dossierBase}"`], { cwd: RACINE });
  const worker = await demarrerFauxWorker();
  const [sa, sb] = await Promise.all([demarrerServeur(worker.url, dossierBase), demarrerServeur(worker.url)]);
  portBranche = String(sb.address().port);
  const reseau = { coupees: [], antirobot: [], courriels: [], worker };
  const ecarts = [];
  let vues = 0, exceptions = 0;
  for (const largeur of LARGEURS) {
    const avant = new Map();
    cote = 'base';
    await parcourirEtats(nav, `http://127.0.0.1:${sa.address().port}`, reseau, page, largeur, async (p, nom) => { relancer(); avant.set(nom, [await photo(p), await zonesDe(p)]); });
    cote = 'branche';
    await parcourirEtats(nav, `http://127.0.0.1:${sb.address().port}`, reseau, page, largeur, async (p, nom) => {
      relancer(); vues++;
      const [a, zonesA] = avant.get(nom), b = await photo(p);
      if (a.equals(b)) return;
      const r = await compter(a, b, [...zonesA, ...(await zonesDe(p))]);
      if (r.exceptes) exceptions++;
      if (r.n === 0) return;
      const fichier = join(SORTIE, `${page}@${largeur}-${nom.replace(/[^a-zà-ÿ0-9]+/gi, '_')}`);
      await writeFile(`${fichier}-base.png`, a);
      await writeFile(`${fichier}-branche.png`, b);
      ecarts.push(`${page}@${largeur} [${nom}] ${r.zone}`);
    });
  }
  await vraiNav.close();
  sa.close(); sb.close(); worker.serveur.close();
  await rm(dossierBase, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ page, vues, ecarts, exceptions })}\n`);
  process.exit(0);
}

/* Toutes les pages */
async function comparerTout() {
  const debut = Date.now();
  await rm(SORTIE, { recursive: true, force: true }).catch(() => {});
  await mkdir(CACHE, { recursive: true });
  const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html') && (!DEMANDEES.length || DEMANDEES.includes(f))).sort();
  const parallele = Number(process.env.PIXELS_PARALLELE) || Math.max(1, Math.min(4, availableParallelism() - 1));
  const resultats = [];
  const file = [...pages];
  const lancer = (page) => new Promise((ok) => {
    const args = [fileURLToPath(import.meta.url), '--une', page, '--base', BASE, '--largeurs', LARGEURS.join(','), '--sortie', SORTIE, ...(TEMOIN ? ['--temoin', TEMOIN] : [])];
    const fils = spawn(process.execPath, args, { cwd: RACINE, stdio: ['ignore', 'pipe', 'inherit'] });
    let texte = '';
    fils.stdout.on('data', (d) => { texte += d; });
    fils.on('close', () => {
      const ligne = texte.trim().split('\n').reverse().find((l) => l.startsWith('{'));
      ok(ligne ? JSON.parse(ligne) : { page, erreur: texte.trim().split('\n').pop() || 'arrêt sans résultat' });
    });
  });
  await Promise.all(Array.from({ length: parallele }, async () => {
    while (file.length) { const r = await lancer(file.shift()); resultats.push(r); console.log(`  ${r.page} : ${r.bloque ? `bloqué, état ${r.bloque}` : r.erreur ? `erreur, ${r.erreur}` : `${r.vues - r.ecarts.length}/${r.vues} identiques`}`); }
  }));
  resultats.sort((a, b) => a.page.localeCompare(b.page));
  const vues = resultats.reduce((s, r) => s + (r.vues || 0), 0);
  const ecarts = resultats.flatMap((r) => r.ecarts || []);
  const echecs = resultats.filter((r) => r.bloque || r.erreur);
  console.log(`\nAu pixel contre ${BASE} — ${pages.length} pages, ${LARGEURS.length} largeurs, ${vues} vues, ${vues - ecarts.length} identiques, ${Math.round((Date.now() - debut) / 1000)} s`);
  const exceptees = resultats.reduce((s, r) => s + (r.exceptions || 0), 0);
  console.log(`  exceptions nommées : ${exceptees} vue(s) où seules leurs lignes diffèrent\n${EXCEPTIONS.map((e) => `    ${e.selecteur} : ${e.raison}`).join('\n')}`);
  if (ecarts.length) console.log(`\n${ecarts.map((e) => `  ${e}`).join('\n')}\n\n  captures : ${SORTIE}`);
  if (echecs.length) console.log(`\n  ${echecs.length} page(s) non comparée(s)`);
  process.exit(ecarts.length || echecs.length ? 1 : 0);
}

if (process.argv.includes('--une')) {
  await comparerUnePage(option('--une')).catch((e) => {
    process.stdout.write(`${JSON.stringify({ page: option('--une'), erreur: e.message.split('\n')[0] })}\n`);
    process.exit(2);
  });
}
else await comparerTout();
