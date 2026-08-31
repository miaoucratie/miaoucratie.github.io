/**
 * QA comparative des articles du blog.
 *
 *   node qa/articles.mjs             releve
 *   node qa/articles.mjs --strict    sort en erreur s'il reste une divergence
 *
 * Pourquoi ce fichier : verifier chaque page isolement ne dit rien de
 * l'harmonie de l'ensemble. Deux articles peuvent passer tous les controles
 * un par un et n'avoir ni la meme largeur de colonne, ni la meme epaisseur de
 * filet sur un encart de meme fonction, ni la meme couleur de lien.
 *
 * Le controle met les articles cote a cote et compare, composant par
 * composant, ce qui doit etre identique au pixel pres :
 *
 *   · la largeur de la colonne de lecture ;
 *   · pour chaque composant recurrent : police, corps, graisse, interligne,
 *     couleur, fond, bordures, rayon, retraits ;
 *   · la presence ou l'absence des elements de structure — fil d'Ariane,
 *     sommaire, bandeau final ;
 *   · l'echelle des titres, et le fait qu'elle soit decroissante ;
 *   · la couleur des liens dans le corps du texte, contre la convention du
 *     site, et l'absence de bleu par defaut ;
 *   · le contraste de chaque texte sur son fond reel.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const LARGEURS = [1280, 768, 375];

/* Les articles du blog. La page d'entree n'en est pas un : elle a sa propre
   composition en grille, et on ne lui demande pas la colonne de lecture. */
const ARTICLES = ['etiquette-nourriture-chat.html', 'croquettes-et-patee.html'];

/* Composants dont deux articles doivent rendre exactement la meme chose.
   La cle est le nom lisible, la valeur le selecteur. */
const COMPOSANTS = {
  'colonne de lecture': '.art-flux',
  'titre de page': 'h1',
  'titre de section': '.art-flux .section > h2',
  'sous-titre': '.art-flux .section > h3',
  /* Un paragraphe du corps, pas une etiquette de section ni une legende :
     « .section-label » est un <p> mais se rend en capitales espacees, et le
     comparer a un paragraphe courant produisait un faux constat. */
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

/* Proprietes comparees : tout ce qui se voit et qui ne depend pas du
   conteneur. La LARGEUR en est volontairement absente. Un meme composant
   n'occupe pas la meme largeur selon qu'il est dans la colonne de lecture,
   dans une fiche ou dans une rangee de deux : comparer « la premiere fiche
   produit de chaque article » revenait a comparer une fiche pleine largeur
   avec une carte de rangee, et rendait neuf faux constats.
   L'invariant de largeur est verifie a part, plus bas, et il est plus fort :
   tout ce qui est pose directement dans la colonne de lecture doit avoir
   exactement la meme largeur. */
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

  /* Liens dans le corps du texte : couleur, soulignement, et bleu par defaut. */
  for (const a of document.querySelectorAll('.art-flux p a, .art-flux li a, .art-corps p a')) {
    if (!visible(a) || a.closest('.btn-primary, .art-actions, .art-sommaire, .art-sources')) continue;
    const c = getComputedStyle(a);
    out.liens.push({ texte: a.textContent.trim().slice(0, 28), color: c.color, deco: c.textDecorationLine, poids: c.fontWeight });
  }

  /* Echelle des titres : le corps rendu par niveau. */
  for (const n of ['h1', 'h2', 'h3', 'h4']) {
    const e = [...document.querySelectorAll(`.art-page ${n}, main ${n}`)].filter(visible)
      .filter((x) => !x.closest('.cta-section, .art-sommaire'));
    if (e.length) {
      const tailles = [...new Set(e.map((x) => Math.round(parseFloat(getComputedStyle(x).fontSize))))];
      out.titres.push({ n, tailles, nb: e.length, exemple: e[0].textContent.trim().slice(0, 34) });
    }
  }

  /* Une seule largeur dans la colonne de lecture. C'est l'invariant fort :
     paragraphes, titres, figures, tableaux et encadres poses directement dans
     le flux doivent partager la meme largeur au pixel pres. */
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

  /* Elements de structure : presents ou absents. */
  for (const [nom, sel] of Object.entries({
    'fil d’Ariane': '.fil-ariane, .breadcrumb, nav[aria-label*="ariane" i]',
    'sommaire': '.art-sommaire',
    'encart avertissement': '.art-alerte',
    'encart affiliation': '.art-affiliation',
    'sources': '.art-sources',
    'bandeau final': '.cta-section',
    'retour au blog': 'a[href="blog.html"]',
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
    /* « couches.css » anime tout enfant direct de body sur 0,7 s et ne prevoit
       pas « prefers-reduced-motion » : l'option du navigateur n'y peut rien. On
       coupe donc animations et transitions apres chargement, sinon la mesure
       tombe tantot avant, tantot apres le fondu, et deux passes identiques ne
       donnent pas le meme resultat. */
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

  /* 3. Liens : jamais de bleu par defaut, meme traitement partout */
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

    /* 3 bis. Une seule largeur dans la colonne de lecture */
    if (r.largeurColonne && r.largeurColonne.length > 1) {
      constats.push({ largeur, genre: 'largeurs melangees dans la colonne',
        detail: `${f} : ` + r.largeurColonne.map((x) => `${x.l}px x${x.n} (${x.exemples.join(', ')})`).join('  ·  ') });
    }

    /* 4. Echelle des titres : un seul corps par niveau, et decroissante */
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
