/* Relevé des styles */

import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REF = process.argv[2] || 'origin/main';
const LARGEURS = [1280, 1024, 768, 375, 320];
const MAX_LIGNES = 200;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.woff2': 'font/woff2',
};

/* Serveur statique */
function servir(racine) {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0]);
    let fichier = join(racine, normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
    if (chemin.endsWith('/')) fichier = join(fichier, 'index.html');
    if (!fichier.startsWith(racine) || !existsSync(fichier)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
    res.end(await readFile(fichier));
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(serveur)));
}

/* Relevé d'une page */
async function relever(contexte, base, page, largeur) {
  const p = await contexte.newPage();
  await p.setViewportSize({ width: largeur, height: 900 });
  await p.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  await p.goto(`${base}/${page}`, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => document.getAnimations().forEach((a) => {
    if (a.effect?.getComputedTiming().endTime === Infinity) { a.pause(); a.currentTime = 0; } else a.finish();
  }));
  const cdp = await contexte.newCDPSession(p);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const survols = await p.evaluate(() => {
    const sels = new Set();
    const lire = (regles) => {
      for (const r of regles) {
        if (r.cssRules) lire(r.cssRules);
        if (r.selectorText && r.selectorText.includes(':hover')) {
          for (const s of r.selectorText.split(',')) if (s.includes(':hover')) sels.add(s.split(':hover')[0].trim() || '*');
        }
      }
    };
    for (const f of document.styleSheets) { try { lire(f.cssRules); } catch { /* feuille tierce */ } }
    const cibles = new Set();
    for (const s of sels) { try { document.querySelectorAll(s).forEach((e) => cibles.add(e)); } catch { /* sélecteur invalide */ } }
    const tous = [...document.querySelectorAll('body *:not(script):not(style):not(noscript):not(template)')];
    return [...cibles].map((e) => tous.indexOf(e)).filter((i) => i >= 0);
  });
  const lireTout = () => p.evaluate(() => {
    const props = [...getComputedStyle(document.body)];
    return [...document.querySelectorAll('body *:not(script):not(style):not(noscript):not(template)')].map((e) => {
      const ligne = {};
      for (const pseudo of [null, '::before', '::after']) {
        const c = getComputedStyle(e, pseudo);
        if (pseudo && c.content === 'none') continue;
        for (const k of props) ligne[(pseudo || '') + k] = c.getPropertyValue(k);
      }
      return [e.tagName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''), ligne];
    });
  });
  const repos = await lireTout();
  const survolees = {};
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'body *:not(script):not(style):not(noscript):not(template)' });
  for (const i of survols) {
    await cdp.send('CSS.forcePseudoState', { nodeId: nodeIds[i], forcedPseudoClasses: ['hover'] });
    survolees[i] = await p.evaluate((n) => {
      document.getAnimations().forEach((a) => { if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish(); });
      const e = document.querySelectorAll('body *:not(script):not(style):not(noscript):not(template)')[n];
      const ligne = {};
      for (const pseudo of [null, '::before', '::after']) {
        const c = getComputedStyle(e, pseudo);
        if (pseudo && c.content === 'none') continue;
        for (const k of c) ligne[(pseudo || '') + k] = c.getPropertyValue(k);
      }
      return ligne;
    }, i);
    await cdp.send('CSS.forcePseudoState', { nodeId: nodeIds[i], forcedPseudoClasses: [] });
  }
  await p.close();
  return { repos, survolees };
}

/* Variables CSS */
const variable = (k) => k.replace(/^::(before|after)/, '').startsWith('--');

/* Comparaison */
function comparer(a, b, lieu, ecarts) {
  if (a.repos.length !== b.repos.length) {
    ecarts.push(`${lieu} : ${a.repos.length} éléments avant, ${b.repos.length} après`);
    return;
  }
  a.repos.forEach(([nom, avant], i) => {
    const apres = b.repos[i][1];
    for (const k of Object.keys({ ...avant, ...apres })) {
      if (!variable(k) && avant[k] !== apres[k]) ecarts.push(`${lieu} ${nom} ${k} : « ${avant[k]} » → « ${apres[k]} »`);
    }
    const sa = a.survolees[i];
    const sb = b.survolees[i];
    if (!sa && !sb) return;
    if (!sa || !sb) return ecarts.push(`${lieu} ${nom} survol présent d'un seul côté`);
    for (const k of Object.keys(sa)) {
      if (!variable(k) && sa[k] !== sb[k]) ecarts.push(`${lieu} ${nom} :hover ${k} : « ${sa[k]} » → « ${sb[k]} »`);
    }
  });
}

/* Programme */
const avantDir = await mkdtemp(join(tmpdir(), 'styles-'));
execFileSync('sh', ['-c', `git archive ${REF} | tar -x -C "${avantDir}"`], { cwd: RACINE });
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html') && (!process.argv[3] || f === process.argv[3])).sort();
const [sa, sb] = await Promise.all([servir(avantDir), servir(RACINE)]);
const ua = `http://127.0.0.1:${sa.address().port}`;
const ub = `http://127.0.0.1:${sb.address().port}`;
const navigateur = await chromium.launch();
const contexte = await navigateur.newContext();
const ecarts = [];
for (const page of pages) {
  for (const largeur of LARGEURS) {
    const [a, b] = [await relever(contexte, ua, page, largeur), await relever(contexte, ub, page, largeur)];
    comparer(a, b, `${page}@${largeur}`, ecarts);
  }
}
await navigateur.close();
sa.close();
sb.close();
await rm(avantDir, { recursive: true, force: true });

console.log(`\nStyles calculés comparés à ${REF} — ${pages.length} pages, ${LARGEURS.length} largeurs, survol et pseudo-éléments compris\n`);
console.log(ecarts.length ? ecarts.slice(0, MAX_LIGNES).join('\n') : '  Aucun écart.');
if (ecarts.length > MAX_LIGNES) console.log(`  … et ${ecarts.length - MAX_LIGNES} autres`);
process.exit(ecarts.length ? 1 : 0);
