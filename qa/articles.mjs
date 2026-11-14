/* Comparaison des articles du blog */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const LARGEURS = [1280, 768, 375];

/* Articles comparés */
const HORS_GABARIT = new Map([
  ['ce-que-jutilise.html', 'composition « cq- » qui lui est propre, sans colonne de lecture'],
]);
const registre = JSON.parse(readFileSync(join(RACINE, 'blog', 'articles.json'), 'utf8'));
const ARTICLES = registre.articles
  .filter((a) => a.status === 'published')
  .map((a) => a.url.replace(/^\//, ''))
  .filter((f) => !HORS_GABARIT.has(f));

/* Composants comparés */
const COMPOSANTS = {
  'colonne de lecture': '.art-flux',
  'titre de page': 'h1',
  'titre de section': '.art-flux .section > h2',
  'sous-titre': '.art-flux .section > h3',
  'paragraphe': '.art-flux .section > p:not([class])',
  'encart avertissement': '.art-alerte',
  'encart note': '.cred-item',
  'figure': '.art-fig',
  'legende de figure': '.art-fig figcaption',
  'tableau': '.art-tab',
  'sommaire': '.art-sommaire',
  'lien de sommaire': '.art-sommaire a',
  'sources': '.art-sources',
  'bandeau final': '.cta-section',
  'titre du bandeau': '.cta-section h2',
  'bouton principal': '.btn-primary',
  'fiche produit': '.art-produit',
};

/* Propriétés comparées */
const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'color', 'backgroundColor', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderLeftColor', 'borderTopLeftRadius',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textAlign'];

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

const RELEVE = ({ composants, props }) => {
  const visible = (e) => {
    for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden') return false; }
    return e.getBoundingClientRect().height > 0;
  };
  const out = { composants: {}, liens: [], titres: [], structure: {} };

  for (const [nom, sel] of Object.entries(composants)) {
    const e = [...document.querySelectorAll(sel)].find(visible);
    if (!e) { out.composants[nom] = null; continue; }
    const c = getComputedStyle(e);
    const v = {};
    for (const p of props) v[p] = c[p];
    v.largeur = Math.round(e.getBoundingClientRect().width);
    out.composants[nom] = v;
  }

  /* Liens du corps de texte */
  for (const a of document.querySelectorAll('.art-flux p a, .art-flux li a, .art-corps p a')) {
    if (!visible(a) || a.closest('.btn-primary, .art-actions, .art-sommaire, .art-sources')) continue;
    const c = getComputedStyle(a);
    out.liens.push({ texte: a.textContent.trim().slice(0, 28), color: c.color, deco: c.textDecorationLine, poids: c.fontWeight });
  }

  /* Échelle des titres */
  for (const n of ['h1', 'h2', 'h3', 'h4']) {
    const e = [...document.querySelectorAll(`.art-page ${n}, main ${n}`)].filter(visible)
      .filter((x) => !x.closest('.cta-section, .art-sommaire'));
    if (e.length) {
      const tailles = [...new Set(e.map((x) => Math.round(parseFloat(getComputedStyle(x).fontSize))))];
      out.titres.push({ n, tailles, nb: e.length, exemple: e[0].textContent.trim().slice(0, 34) });
    }
  }

  /* Largeurs dans la colonne de lecture */
  const flux = document.querySelector('.art-flux');
  if (flux) {
    const largeurs = new Map();
    for (const e of flux.querySelectorAll(':scope > .section > *')) {
      if (!visible(e)) continue;
      const l = Math.round(e.getBoundingClientRect().width);
      if (!largeurs.has(l)) largeurs.set(l, []);
      largeurs.get(l).push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''));
    }
    out.largeurColonne = [...largeurs].sort((a, b) => b[1].length - a[1].length)
      .map(([l, q]) => ({ l, n: q.length, exemples: [...new Set(q)].slice(0, 3) }));
  }

  /* Éléments de structure */
  for (const [nom, sel] of Object.entries({
    'fil d’Ariane': '.fil-ariane, .breadcrumb, nav[aria-label*="ariane" i]',
    'sommaire': '.art-sommaire',
    'encart avertissement': '.art-alerte',
    'encart affiliation': '.art-affiliation',
    'sources': '.art-sources',
    'bandeau final': '.cta-section',
    'retour au blog': 'a[href="coulisses-miaoucratie.html"]',
  })) out.structure[nom] = [...document.querySelectorAll(sel)].some(visible);

  return out;
};

/* ── Comparaison ── */
const serveur = await demarrerServeur();
const base = `http://127.0.0.1:${serveur.address().port}`;
const navigateur = await chromium.launch();
const releves = new Map();

for (const f of ARTICLES) {
  for (const largeur of LARGEURS) {
    const ctx = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(`${base}/${f}`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    releves.set(`${f}@${largeur}`, await p.evaluate(RELEVE, { composants: COMPOSANTS, props: PROPS }));
    await ctx.close();
  }
}
await navigateur.close();
serveur.close();

const constats = [];
const ref = ARTICLES[0];

for (const largeur of LARGEURS) {
  const a = releves.get(`${ref}@${largeur}`);
  for (const autre of ARTICLES.slice(1)) {
    const b = releves.get(`${autre}@${largeur}`);

    /* 1. Presence des composants */
    for (const nom of Object.keys(COMPOSANTS)) {
      const pa = a.composants[nom], pb = b.composants[nom];
      if (!pa && !pb) continue;
      if (!pa || !pb) {
        constats.push({ largeur, genre: 'composant absent d’un cote', detail: `« ${nom} » : ${pa ? ref : autre} seulement` });
        continue;
      }
      for (const p of PROPS) {
        if (String(pa[p]) !== String(pb[p])) {
          constats.push({ largeur, genre: 'composant divergent', detail: `« ${nom} » ${p} : ${pa[p]} contre ${pb[p]}` });
        }
      }
    }

    /* 2. Structure */
    for (const nom of Object.keys(a.structure)) {
      if (a.structure[nom] !== b.structure[nom]) {
        constats.push({ largeur, genre: 'structure divergente', detail: `« ${nom} » : ${a.structure[nom] ? ref : autre} seulement` });
      }
    }
  }

  /* 3. Liens */
  for (const f of ARTICLES) {
    const r = releves.get(`${f}@${largeur}`);
    const couleurs = new Set(r.liens.map((l) => l.color));
    for (const l of r.liens) {
      const m = l.color.match(/\d+/g);
      if (m && +m[2] > +m[0] && +m[2] > 120) {
        constats.push({ largeur, genre: 'lien bleu', detail: `${f} : « ${l.texte} » en ${l.color}` });
      }
      if (l.deco === 'none') {
        constats.push({ largeur, genre: 'lien sans soulignement', detail: `${f} : « ${l.texte} » — la couleur seule ne signale pas un lien` });
      }
    }
    if (couleurs.size > 1) {
      constats.push({ largeur, genre: 'liens de couleurs differentes', detail: `${f} : ${[...couleurs].join(' / ')}` });
    }

    /* 3 bis. Largeur de la colonne */
    if (r.largeurColonne && r.largeurColonne.length > 1) {
      constats.push({ largeur, genre: 'largeurs melangees dans la colonne',
        detail: `${f} : ` + r.largeurColonne.map((x) => `${x.l}px x${x.n} (${x.exemples.join(', ')})`).join('  ·  ') });
    }

    /* 4. Échelle des titres */
    const parNiveau = new Map(r.titres.map((t) => [t.n, t.tailles]));
    for (const [n, tailles] of parNiveau) {
      if (tailles.length > 1) constats.push({ largeur, genre: 'titres de meme niveau, corps differents', detail: `${f} : ${n} rendu en ${tailles.join(' / ')} px` });
    }
    const ordre = ['h1', 'h2', 'h3', 'h4'].filter((n) => parNiveau.has(n));
    for (let i = 1; i < ordre.length; i++) {
      const haut = Math.max(...parNiveau.get(ordre[i - 1])), bas = Math.max(...parNiveau.get(ordre[i]));
      if (bas >= haut) constats.push({ largeur, genre: 'hierarchie de titres inversee', detail: `${f} : ${ordre[i]} a ${bas} px pour ${ordre[i - 1]} a ${haut} px` });
    }
  }
}

/* ── Sortie ── */
const groupes = new Map();
for (const c of constats) {
  const cle = `${c.genre} — ${c.detail}`;
  if (!groupes.has(cle)) groupes.set(cle, []);
  groupes.get(cle).push(c.largeur);
}

console.log(`\nQA comparative des articles — ${ARTICLES.join(' contre ')}\n`);
if (!groupes.size) console.log('  Aucune divergence.\n');
else {
  let genre = null;
  for (const [texte, l] of [...groupes].sort()) {
    const g = texte.split(' — ')[0];
    if (g !== genre) { console.log(`  ${g}`); genre = g; }
    console.log(`    x ${texte.slice(g.length + 3)}`);
    console.log(`        a ${[...new Set(l)].join(', ')} px`);
  }
  console.log('');
}
console.log(`  ${groupes.size} divergence(s) distincte(s), ${constats.length} occurrence(s)\n`);
if (STRICT && groupes.size) { console.error(`QA comparative en echec : ${groupes.size} divergence(s).`); process.exit(1); }
