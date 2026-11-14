/* Contrôle des espacements */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html'));
const LARGEURS = [1280, 768, 375];

/* Pages contrôlées */
const registre = JSON.parse(readFileSync(join(RACINE, 'blog', 'articles.json'), 'utf8'));
const PAGES = [
  registre.site.blogUrl.replace(/^\//, ''),
  ...registre.articles.filter((a) => a.status === 'published').map((a) => a.url.replace(/^\//, '')),
];

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function demarrerServeur() {
  const s = createServer(async (req, res) => {
    const f = join(RACINE, normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(RACINE) || !existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(await readFile(f));
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s)));
}

const RELEVE = () => {
  const d = document;
  const constats = [];
  const nom = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '');
  const visible = (e) => {
    for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden') return false; }
    return e.getBoundingClientRect().height > 0;
  };

  /* ── 1. Blocs collés ── */
  const PORTEURS = '.cred-item, .art-fig, .art-tab-cadre, .pcard, .art-etapes, .art-lies, .art-fin, details, figure';
  for (const e of d.querySelectorAll(PORTEURS)) {
    const suivant = e.nextElementSibling;
    if (!suivant || !suivant.matches(PORTEURS)) continue;
    if (!visible(e) || !visible(suivant)) continue;
    const a = e.getBoundingClientRect(), b = suivant.getBoundingClientRect();
    const ecart = Math.round(b.top - a.bottom);
    if (ecart >= 0 && ecart < 8) constats.push({ genre: 'blocs colles', detail: `${nom(e)} et ${nom(suivant)} separes de ${ecart}px` });
  }

  /* ── 2. Composants appariés ── */
  for (const rangee of d.querySelectorAll('.art-duo, .art-trio, .cards-grid')) {
    let cartes = [...rangee.children].filter(visible);
    if (cartes.length < 2) continue;
    const premiere = Math.round(cartes[0].getBoundingClientRect().top);
    cartes = cartes.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - premiere) < 4);
    if (cartes.length < 2) continue;
    for (const sel of ['h2, h3', 'ul', '.note', '.art-actions', '.art-etiquettes', '.art-carte-texte']) {
      const tops = cartes.map((c) => { const x = c.querySelector(sel); return x && visible(x) ? Math.round(x.getBoundingClientRect().top) : null; });
      const presents = tops.filter((x) => x !== null);
      if (presents.length !== cartes.length || presents.length < 2) continue;
      const ecart = Math.max(...presents) - Math.min(...presents);
      if (ecart > 2) constats.push({ genre: 'composants desalignes', detail: `${nom(rangee)} : « ${sel} » a ${ecart}px d'ecart d'une carte a l'autre` });
    }
    const hauteurs = cartes.map((c) => Math.round(c.getBoundingClientRect().height));
    if (Math.max(...hauteurs) - Math.min(...hauteurs) > 2) {
      constats.push({ genre: 'composants desalignes', detail: `${nom(rangee)} : hauteurs de carte ${hauteurs.join(' / ')}` });
    }
  }

  /* ── 3. Une seule largeur par colonne ── */
  const flux = d.querySelector('.art-flux, .art-corps');
  if (flux) {
    const largeurs = new Map();
    for (const e of flux.querySelectorAll(':scope > p, :scope > .art-fig, :scope > .art-tab-cadre, :scope > .cred-item, :scope > .art-etapes, :scope > h2')) {
      if (!visible(e)) continue;
      const l = Math.round(e.getBoundingClientRect().width);
      if (!largeurs.has(l)) largeurs.set(l, []);
      largeurs.get(l).push(nom(e));
    }
    if (largeurs.size > 1) {
      const detail = [...largeurs].sort((a, b) => b[1].length - a[1].length)
        .map(([l, q]) => `${l}px (${[...new Set(q)].slice(0, 3).join(', ')})`).join(' · ');
      constats.push({ genre: 'largeurs melangees', detail });
    }
  }

  /* ── 4. Contenu tassé ── */
  const large = (e) => {
    const s = getComputedStyle(e);
    const b = e.getBoundingClientRect();
    return b.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  };
  for (const e of d.querySelectorAll('header, section, aside, .art-hero, .art-page > *, .grille > *')) {
    if (!visible(e)) continue;
    const dispo = large(e);
    if (dispo < 600) continue;
    if (getComputedStyle(e).textAlign === 'center') continue;

    const boite = e.getBoundingClientRect();
    const st = getComputedStyle(e);
    const gauche = boite.left + parseFloat(st.paddingLeft);
    let droite = gauche, signes = 0;

    for (const x of e.querySelectorAll('*')) {
      if (!visible(x)) continue;
      const r = x.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) droite = Math.max(droite, r.right);
    }
    const w = d.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    const R2 = d.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue;
      if (!t.trim() || !visible(n.parentElement)) continue;
      R2.selectNodeContents(n);
      for (const r of R2.getClientRects()) {
        if (r.height >= 4 && r.width >= 1) droite = Math.max(droite, r.right);
      }
      signes += t.trim().length;
    }
    if (signes < 80) continue;
    const plusLarge = droite - gauche;

    const part = plusLarge / dispo;
    if (part < 0.55) {
      constats.push({
        genre: 'contenu tasse',
        detail: `${nom(e)} : le bloc fait ${Math.round(dispo)}px, son texte n'en occupe que ${Math.round(plusLarge)}px, soit ${Math.round(part * 100)} %`,
      });
    }
  }

  /* ── 5. Titre mal rattaché ── */
  const TITRES = 'h2, h3, .section-label, .art-fig-titre, .art-lies-titre';
  const suite = [];
  for (const s of d.querySelectorAll('.art-flux > .section, .art-page > *, main > .section')) {
    for (const e of s.children) if (visible(e)) suite.push(e);
  }
  for (let i = 1; i < suite.length - 1; i++) {
    const e = suite[i];
    if (!e.matches(TITRES)) continue;
    const r = e.getBoundingClientRect();
    const dessus = Math.round(r.top - suite[i - 1].getBoundingClientRect().bottom);
    const dessous = Math.round(suite[i + 1].getBoundingClientRect().top - r.bottom);
    if (dessous > dessus + 8) {
      constats.push({
        genre: 'titre mal rattache',
        detail: `${nom(e)} : ${dessus}px au-dessus, ${dessous}px en dessous, il se lit avec le bloc precedent`,
      });
    }
  }

  return constats;
};

const serveur = await demarrerServeur();
const base = `http://127.0.0.1:${serveur.address().port}`;
const navigateur = await chromium.launch();
const pages = DEMANDEES.length ? DEMANDEES : PAGES;
const parPage = new Map();
let total = 0;

for (const f of pages) {
  for (const largeur of LARGEURS) {
    const ctx = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(`${base}/${f}`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    for (const c of await p.evaluate(RELEVE)) {
      if (!parPage.has(f)) parPage.set(f, new Map());
      const cle = `${c.genre} — ${c.detail}`;
      if (!parPage.get(f).has(cle)) parPage.get(f).set(cle, []);
      parPage.get(f).get(cle).push(largeur);
      total++;
    }
    await ctx.close();
  }
}
await navigateur.close();
serveur.close();

console.log(`\nEspacements et grille — ${pages.length} page(s), largeurs ${LARGEURS.join(' / ')}\n`);
if (!parPage.size) console.log('  Aucun constat.\n');
else {
  for (const [f, c] of [...parPage].sort()) {
    console.log(`  ${f}`);
    for (const [texte, l] of c) console.log(`    ✗ ${texte}\n        a ${[...new Set(l)].join(', ')} px`);
    console.log('');
  }
}
const distincts = [...parPage.values()].reduce((n, m) => n + m.size, 0);
console.log(`  ${distincts} constat(s) distinct(s), ${total} occurrence(s)\n`);
if (STRICT && distincts) { console.error(`Controle des espacements en echec : ${distincts} constat(s).`); process.exit(1); }
