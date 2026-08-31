#!/usr/bin/env node
/**
 * Generateur du blog Miaoucratie.
 *
 *   node scripts/generate-blog.js            valide, genere, relit, controle
 *   node scripts/generate-blog.js --check    valide et compare, n'ecrit rien
 *
 * Outil de build local. Aucune dependance. Il ne tourne jamais dans un
 * navigateur, il n'est reference par aucune page, et le HTML qu'il produit est
 * statique : le maillage, les cartes et les donnees structurees sont dans la
 * source livree, sans JavaScript.
 *
 * Ce qu'il possede, et rien d'autre :
 *   · la grille de blog.html                    GENERATED:BLOG_GRID
 *   · la liste blogPost du JSON-LD de blog.html GENERATED:BLOG_JSONLD
 *   · le bloc « articles lies » de chaque article  GENERATED:RELATED
 *   · les entrees d'article du sitemap          GENERATED:BLOG_URLS
 *
 * Tout le reste est edite a la main et il n'y touche pas. Il VALIDE en
 * revanche les metadonnees de chaque page contre le registre et s'arrete si
 * elles divergent : il ne corrige jamais un contenu editorial en silence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* La racine est celle du depot. « BLOG_RACINE » permet de faire tourner le
   generateur sur une arborescence de test : les cas negatifs se verifient
   ainsi sur des fixtures, sans jamais casser les vrais fichiers du site. */
const RACINE = process.env.BLOG_RACINE ? path.resolve(process.env.BLOG_RACINE) : path.join(__dirname, '..');
const REGISTRE = path.join(RACINE, 'blog', 'articles.json');
const CHECK = process.argv.includes('--check');

/* ── Journal ────────────────────────────────────────────────────────────── */
const erreurs = [];
const infos = [];
const faute = (ou, quoi) => erreurs.push({ ou, quoi });
const dire = (s) => infos.push(s);

function terminer() {
  for (const s of infos) console.log('  ' + s);
  if (erreurs.length) {
    console.error(`\n  ${erreurs.length} probleme(s) :\n`);
    for (const e of erreurs) console.error(`    x ${e.ou}\n      ${e.quoi}`);
    console.error('\n  Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
  console.log('');
  process.exit(0);
}

/* ── Lecture et validation du registre (§8) ─────────────────────────────── */
let registre;
try {
  registre = JSON.parse(fs.readFileSync(REGISTRE, 'utf8'));
} catch (e) {
  faute('blog/articles.json', `JSON illisible : ${e.message}`);
  terminer();
}

const OBLIGATOIRES = ['slug', 'url', 'status', 'category', 'h1', 'seoTitle', 'description',
  'ldHeadline', 'cardTitle', 'cardText', 'cardCta', 'datePublished', 'dateModified', 'related', 'image'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/* Une categorie porte un nom court et un emoji, et un seul. Deux categories qui
   partageraient le meme emoji cesseraient d'etre identifiables d'un coup d'oeil,
   ce qui est toute la fonction de cet emoji. */
const validerRubriques = (liste) => {
  if (!Array.isArray(liste) || !liste.length) { faute('blog/articles.json', '« site.rubriques » doit lister les categories'); return; }
  const vus = new Set();
  for (const r of liste) {
    const ou = `blog/articles.json — rubrique « ${r && r.nom} »`;
    if (!r || typeof r.nom !== 'string' || !r.nom.trim()) { faute('blog/articles.json', 'une rubrique sans nom'); continue; }
    if (typeof r.emoji !== 'string' || !r.emoji.trim() || [...r.emoji].length > 3) {
      faute(ou, "l'emoji d'une rubrique doit tenir en trois caracteres au plus");
    }
    if (vus.has(r.emoji)) faute(ou, `l'emoji « ${r.emoji} » sert deja a une autre rubrique`);
    vus.add(r.emoji);
  }
};
/* Les categories sont declarees une fois, avec leur emoji : c'est un
   identifiant visuel fixe, pas une decoration choisie article par article. */
const RUBRIQUES = (registre.site && registre.site.rubriques) || [];
const NOMS = RUBRIQUES.map((r) => r.nom);
const emojiDe = (nom) => (RUBRIQUES.find((r) => r.nom === nom) || {}).emoji || '';
const site = registre.site || {};
validerRubriques(RUBRIQUES);
const tous = Array.isArray(registre.articles) ? registre.articles : [];

if (!site.origin || !site.blogUrl) faute('blog/articles.json', 'la section « site » doit porter « origin » et « blogUrl »');
if (!tous.length) faute('blog/articles.json', 'aucun article declare');

const vusSlug = new Map();
const vusUrl = new Map();
for (const [i, a] of tous.entries()) {
  const ou = `blog/articles.json, article ${i + 1}${a.slug ? ` (${a.slug})` : ''}`;
  for (const c of OBLIGATOIRES) {
    if (a[c] === undefined || a[c] === null || a[c] === '') faute(ou, `champ obligatoire manquant : « ${c} »`);
  }
  if (typeof a.slug === 'string' && !/^[a-z0-9-]+$/.test(a.slug)) faute(ou, `slug non conforme : « ${a.slug} » (minuscules, chiffres et tirets)`);
  if (!['published', 'draft'].includes(a.status)) faute(ou, `status inconnu : « ${a.status} » (published ou draft)`);
  if (!Array.isArray(a.cardText) || !a.cardText.length) faute(ou, '« cardText » doit etre une liste non vide');
  if (!NOMS.includes(a.category)) {
    faute(ou, `rubrique « ${a.category} » absente de « site.rubriques », qui fixe l'ordre d'affichage`);
  }
  if (a.rang !== undefined && (!Number.isInteger(a.rang) || a.rang < 1)) {
    faute(ou, '« rang » doit etre un entier positif');
  }
  if (!Array.isArray(a.related)) faute(ou, '« related » doit etre une liste');
  if (!Array.isArray(a.keywords || [])) faute(ou, '« keywords » doit etre une liste');
  if (typeof a.affiliate !== 'boolean') faute(ou, '« affiliate » doit valoir true ou false');
  for (const c of ['datePublished', 'dateModified']) {
    if (!DATE.test(a[c] || '')) faute(ou, `${c} doit etre au format AAAA-MM-JJ, lu « ${a[c]} »`);
  }
  if (DATE.test(a.datePublished || '') && DATE.test(a.dateModified || '') && a.dateModified < a.datePublished) {
    faute(ou, `dateModified (${a.dateModified}) anterieure a datePublished (${a.datePublished})`);
  }
  if (vusSlug.has(a.slug)) faute(ou, `slug en double, deja porte par l'article ${vusSlug.get(a.slug) + 1}`);
  else vusSlug.set(a.slug, i);
  if (vusUrl.has(a.url)) faute(ou, `url en double, deja portee par l'article ${vusUrl.get(a.url) + 1}`);
  else vusUrl.set(a.url, i);
}
if (erreurs.length) terminer();

const parSlug = new Map(tous.map((a) => [a.slug, a]));
const publies = tous.filter((a) => a.status === 'published');

/* Relations (§8, §12) */
for (const a of tous) {
  const ou = `blog/articles.json (${a.slug})`;
  const vus = new Set();
  for (const r of a.related) {
    if (r === a.slug) faute(ou, `« related » se refere a lui-meme`);
    if (vus.has(r)) faute(ou, `« related » contient « ${r} » deux fois`);
    vus.add(r);
    const cible = parSlug.get(r);
    if (!cible) faute(ou, `« related » designe « ${r} », qui n'existe pas dans le registre`);
    else if (cible.status !== 'published' && a.status === 'published') {
      faute(ou, `« related » designe « ${r} », qui n'est pas publie : un brouillon ne doit pas devenir decouvrable`);
    }
  }
}

/* Le fichier de chaque article publie doit exister (§8) */
const fichierDe = (a) => path.join(RACINE, a.url.replace(/^\//, ''));
for (const a of publies) {
  if (!fs.existsSync(fichierDe(a))) faute(`blog/articles.json (${a.slug})`, `article publie sans fichier : ${a.url}`);
}
if (erreurs.length) terminer();

/* ── Coherence registre / page, sans correction silencieuse (§9) ────────── */
const net = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const nbsp = (s) => s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const pages = new Map();
for (const a of publies) pages.set(a.slug, fs.readFileSync(fichierDe(a), 'utf8'));

for (const a of publies) {
  const t = pages.get(a.slug);
  const ou = `${a.url.replace(/^\//, '')}`;
  const compare = (nom, attendu, lu) => {
    if (lu === null) { faute(ou, `${nom} absent de la page, le registre attend « ${attendu} »`); return; }
    if (nbsp(lu) !== nbsp(attendu)) faute(ou, `${nom} diverge du registre.\n        page     : « ${nbsp(lu)} »\n        registre : « ${nbsp(attendu)} »`);
  };
  const un = (rx) => { const m = t.match(rx); return m ? m[1] : null; };

  compare('<title>', a.seoTitle, un(/<title>([\s\S]*?)<\/title>/));
  compare('meta description', a.description, un(/<meta name="description" content="([^"]*)"/));
  const h1 = [...t.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => net(m[1]));
  if (h1.length !== 1) faute(ou, `${h1.length} balise(s) h1, il en faut exactement une`);
  else compare('h1', a.h1, h1[0]);
  /* Le sur-titre nomme la rubrique, comme la pastille de la carte : les deux
     doivent dire la meme chose. Les pages dont le sur-titre est une accroche et
     non une rubrique portent une autre classe et ne sont pas concernees. */
  const surtitre = un(/<p class="eyebrow">([^<]*)<\/p>/);
  if (surtitre !== null) compare('sur-titre', `${emojiDe(a.category)} ${a.category}`, surtitre);
  compare('canonical', site.origin + a.url, un(/<link rel="canonical" href="([^"]*)"/));
  compare('og:url', site.origin + a.url, un(/<meta property="og:url" content="([^"]*)"/));
  compare('og:image', a.image, un(/<meta property="og:image" content="([^"]*)"/));

  const blocs = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  let article = null;
  for (const b of blocs) {
    let o;
    try { o = JSON.parse(b[1]); } catch (e) { faute(ou, `donnees structurees illisibles : ${e.message}`); continue; }
    for (const x of (Array.isArray(o) ? o : [o])) if (x['@type'] === 'BlogPosting') article = x;
  }
  if (!article) faute(ou, 'aucun bloc BlogPosting dans les donnees structurees');
  else {
    compare('JSON-LD headline', a.ldHeadline, article.headline ?? null);
    compare('JSON-LD url', site.origin + a.url, article.url ?? null);
    compare('JSON-LD datePublished', a.datePublished, article.datePublished ?? null);
    compare('JSON-LD dateModified', a.dateModified, article.dateModified ?? null);
  }
}
if (erreurs.length) terminer();

/* ── Zones generees ─────────────────────────────────────────────────────── */
/**
 * Remplace le contenu entre deux marqueurs. Refuse tout ce qui est ambigu :
 * marqueur absent, en double, ou END avant START (§10).
 * Retourne { texte, change } ou leve une erreur decrivant le probleme.
 */
function remplacerZone(texte, nom, contenu, ou) {
  const debut = `<!-- GENERATED:${nom}:START -->`;
  const fin = `<!-- GENERATED:${nom}:END -->`;
  const nbD = texte.split(debut).length - 1;
  const nbF = texte.split(fin).length - 1;
  if (nbD !== 1 || nbF !== 1) {
    faute(ou, `marqueur ${nom} ambigu : ${nbD} balise(s) START et ${nbF} balise(s) END, il en faut exactement une de chaque`);
    return null;
  }
  const i = texte.indexOf(debut);
  const j = texte.indexOf(fin);
  if (j < i) { faute(ou, `marqueur ${nom} : END apparait avant START`); return null; }
  const avant = texte.slice(0, i + debut.length);
  const apres = texte.slice(j);
  /* Le bloc adopte la fin de ligne du fichier qui l'accueille. Les pages du
     depot sont en fin de ligne Windows ; un bloc pose en fin de ligne Unix est
     un texte identique au caractere pres, mais des octets differents. Sans
     cela, « --check » signalait les six zones a chaque passage, et « npm run
     blog » reecrivait six fichiers sans rien changer au rendu. */
  const saut = texte.includes('\r\n') ? '\r\n' : '\n';
  const bloc = (contenu.trimEnd() + '\n').replace(/\r?\n/g, saut);
  const nouveau = avant + saut + bloc + apres;
  return { texte: nouveau, change: nouveau !== texte };
}

/* ── Ordre d'affichage, deterministe (§11) ──────────────────────────────── */
/* Regle explicite, dans l'ordre : rang de la rubrique, rang de l'article dans
   sa rubrique, date de publication decroissante, puis slug pour que deux
   articles du meme jour gardent un ordre stable.
   Les deux rangs viennent du registre. Sans « rang », deux articles publies le
   meme jour etaient departages par l'alphabet, et « Croquettes et patee »
   passait devant « Decoder une etiquette » alors qu'on apprend a lire une
   etiquette avant de choisir entre les deux formes (§7.1). */
const rangRubrique = (a) => {
  const i = NOMS.indexOf(a.category);
  return i < 0 ? NOMS.length : i;
};
const ordre = publies.slice().sort((a, b) =>
  (rangRubrique(a) - rangRubrique(b))
  || ((a.rang ?? Infinity) - (b.rang ?? Infinity))
  || (b.datePublished.localeCompare(a.datePublished))
  || a.slug.localeCompare(b.slug));

/* ── Fabrication des blocs ──────────────────────────────────────────────── */
const carte = (a, niveau) => {
  const badge = a.affiliate ? '\n<span class="art-tag">Liens affiliés</span>' : '';
  const textes = a.cardText.map((p) => `<p>${p}</p>`).join('\n');
  return `<article class="pcard art-produit">
<div class="art-etiquettes">
<span class="art-cat">${emojiDe(a.category)} ${a.category}</span>${badge}
</div>
<${niveau}><span>${a.cardTitle}</span></${niveau}>
<div class="art-carte-texte">
${textes}
</div>
<div class="art-actions">
<a class="btn-primary" href="${a.url.replace(/^\//, '')}">${a.cardCta}</a>
</div>
</article>`;
};

const grille = ordre.map((a) => carte(a, 'h2')).join('\n\n');

const jsonld = () => {
  const t = fs.readFileSync(path.join(RACINE, 'blog.html'), 'utf8');
  const blocs = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocs.length !== 1) { faute('blog.html', `${blocs.length} bloc(s) JSON-LD, il en faut un`); return null; }
  let o;
  try { o = JSON.parse(blocs[0][1]); } catch (e) { faute('blog.html', `JSON-LD illisible : ${e.message}`); return null; }
  /* On ne remplace QUE la liste blogPost : le reste du bloc (auteur,
     editeur, langue) reste tel qu'il est ecrit a la main (§16). */
  o.blogPost = ordre.map((a) => ({
    '@type': 'BlogPosting',
    headline: a.ldHeadline,
    url: site.origin + a.url,
    datePublished: a.datePublished,
    dateModified: a.dateModified,
  }));
  return JSON.stringify(o, null, 2);
};

const lies = (a) => {
  /* Relation editoriale explicite d'abord ; a defaut, meme rubrique, du plus
     recent au plus ancien, deux au maximum (§12). */
  let cibles = a.related.map((s) => parSlug.get(s)).filter((x) => x && x.status === 'published');
  if (!cibles.length) {
    cibles = ordre.filter((x) => x.slug !== a.slug && x.category === a.category).slice(0, 2);
  }
  if (!cibles.length) return '';
  return `<aside class="art-lies" aria-labelledby="art-lies-titre">
<h2 id="art-lies-titre" class="art-lies-titre">À lire ensuite</h2>
<div class="art-trio art-trio--lies">
${cibles.map((x) => carte(x, 'h3')).join('\n\n')}
</div>
</aside>`;
};

/* La page d'entree du blog en tete, puis les articles.
   Sa date de derniere modification n'est pas inventee : c'est la plus recente
   des dates de ses articles, puisque son contenu est leur liste. Elle ne bouge
   donc que si un article bouge (§15). */
const urlsSitemap = () => {
  const entree = { url: site.blogUrl, dateModified: ordre.map((a) => a.dateModified).sort().pop() };
  return [entree, ...ordre].map((a) =>
    `  <url>\n    <loc>${site.origin}${a.url}</loc>\n    <lastmod>${a.dateModified}</lastmod>\n  </url>`).join('\n');
};

/* ── Application ────────────────────────────────────────────────────────── */
const aEcrire = new Map();
const changements = [];

function poser(fichier, nom, contenu) {
  const chemin = path.join(RACINE, fichier);
  if (!fs.existsSync(chemin)) { faute(fichier, 'fichier introuvable'); return; }
  const actuel = aEcrire.has(fichier) ? aEcrire.get(fichier) : fs.readFileSync(chemin, 'utf8');
  const r = remplacerZone(actuel, nom, contenu, fichier);
  if (!r) return;
  aEcrire.set(fichier, r.texte);
  if (r.change) changements.push(`${fichier} — zone ${nom}`);
}

poser('blog.html', 'BLOG_GRID', grille);
const ld = jsonld();
if (ld !== null) poser('blog.html', 'BLOG_JSONLD', `<script type="application/ld+json">\n${ld}\n</script>`);
for (const a of publies) poser(a.url.replace(/^\//, ''), 'RELATED', lies(a));
poser('sitemap.xml', 'BLOG_URLS', urlsSitemap());
if (erreurs.length) terminer();

/* ── Controles sur le resultat calcule, avant toute ecriture (§6.6) ─────── */
{
  const bg = aEcrire.get('blog.html') || '';
  for (const a of publies) {
    const href = `href="${a.url.replace(/^\//, '')}"`;
    if (!bg.includes(href)) faute('blog.html', `l'article publie « ${a.slug} » n'apparait pas dans la grille`);
  }
  for (const a of tous.filter((x) => x.status !== 'published')) {
    if (bg.includes(`href="${a.url.replace(/^\//, '')}"`)) faute('blog.html', `le brouillon « ${a.slug} » apparait dans la grille`);
  }
  const sm = aEcrire.get('sitemap.xml') || '';
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const doublons = locs.filter((u, i) => locs.indexOf(u) !== i);
  if (doublons.length) faute('sitemap.xml', `url en double : ${[...new Set(doublons)].join(', ')}`);
  for (const a of publies) {
    if (!locs.includes(site.origin + a.url)) faute('sitemap.xml', `l'article publie « ${a.slug} » manque`);
  }
  if (!locs.includes(site.origin + site.blogUrl)) faute('sitemap.xml', "la page d'entree du blog manque");
  /* L'existence n'est verifiee que sur les URL que le generateur produit :
     les autres entrees du sitemap appartiennent au reste du site, et une
     erreur chez elles ne doit pas bloquer la generation du blog. Les
     doublons, eux, sont controles sur l'ensemble, parce qu'un doublon peut
     naitre de ce que le generateur ajoute. */
  for (const a of publies) {
    const f = a.url.replace(/^\//, '');
    if (!fs.existsSync(path.join(RACINE, f))) faute('sitemap.xml', `url generee vers un fichier inexistant : ${site.origin}${a.url}`);
  }
  for (const a of tous.filter((x) => x.status !== 'published')) {
    if (locs.includes(site.origin + a.url)) faute('sitemap.xml', `le brouillon « ${a.slug} » est dans le sitemap`);
  }
  /* Les liens generes doivent etre de vrais <a href> (§13) */
  for (const [f, t] of aEcrire) {
    if (!f.endsWith('.html')) continue;
    for (const nom of ['BLOG_GRID', 'RELATED']) {
      const d = t.indexOf(`<!-- GENERATED:${nom}:START -->`);
      if (d < 0) continue;
      const zone = t.slice(d, t.indexOf(`<!-- GENERATED:${nom}:END -->`));
      if (/onclick=|javascript:/i.test(zone)) faute(f, `la zone ${nom} contient un lien non standard`);
      for (const m of zone.matchAll(/href="([^"]+)"/g)) {
        if (m[1].startsWith('http') || m[1].startsWith('#')) continue;
        if (!fs.existsSync(path.join(RACINE, m[1]))) faute(f, `la zone ${nom} pointe vers un fichier inexistant : ${m[1]}`);
      }
    }
  }
  /* Le JSON-LD calcule doit rester valide (§16) */
  const b = (aEcrire.get('blog.html') || '').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (b) { try { JSON.parse(b[1]); } catch (e) { faute('blog.html', `JSON-LD genere invalide : ${e.message}`); } }
}
if (erreurs.length) terminer();

/* ── Mode --check : comparer sans ecrire (§7) ───────────────────────────── */
if (CHECK) {
  if (!changements.length) {
    dire(`${publies.length} article(s) publie(s). Le depot est a jour.`);
    terminer();
  }
  for (const c of changements) faute(c, 'le bloc genere ne correspond plus au registre');
  terminer();
}

/* ── Ecriture, puis relecture et verification (§6.8 a §6.10) ────────────── */
if (!changements.length) {
  dire(`${publies.length} article(s) publie(s). Rien a changer.`);
  terminer();
}
for (const [f, t] of aEcrire) fs.writeFileSync(path.join(RACINE, f), t, 'utf8');
for (const [f, t] of aEcrire) {
  if (fs.readFileSync(path.join(RACINE, f), 'utf8') !== t) faute(f, 'le fichier relu ne correspond pas a ce qui devait etre ecrit');
}
if (erreurs.length) terminer();

dire(`${publies.length} article(s) publie(s), ${changements.length} zone(s) mise(s) a jour :`);
for (const c of changements) dire(`  · ${c}`);
terminer();
