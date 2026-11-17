#!/usr/bin/env node
/* Générateur du blog */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remplacerZone } from './zones.js';
import { blocFaq } from './faq.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Racine du dépôt */
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

/* ── Lecture et validation du registre ── */
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
/* Rubriques */
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

/* Relations */
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

/* Fichiers des articles publiés */
const fichierDe = (a) => path.join(RACINE, a.url.replace(/^\//, ''));
for (const a of publies) {
  if (!fs.existsSync(fichierDe(a))) faute(`blog/articles.json (${a.slug})`, `article publie sans fichier : ${a.url}`);
}
if (erreurs.length) terminer();

/* ── Cohérence entre registre et page ── */
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
  /* Sur-titre */
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

/* ── Ordre d'affichage ── */
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
<${niveau}><span><a href="${a.url.replace(/^\//, '')}">${a.cardTitle}</a></span></${niveau}>
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
  const t = fs.readFileSync(path.join(RACINE, 'coulisses-miaoucratie.html'), 'utf8');
  const blocs = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocs.length !== 1) { faute('coulisses-miaoucratie.html', `${blocs.length} bloc(s) JSON-LD, il en faut un`); return null; }
  let o;
  try { o = JSON.parse(blocs[0][1]); } catch (e) { faute('coulisses-miaoucratie.html', `JSON-LD illisible : ${e.message}`); return null; }
  /* Liste blogPost */
  const auteur = o.author && o.author.name ? { '@type': 'Person', name: o.author.name } : null;
  o.blogPost = ordre.map((a) => {
    const p = {
      '@type': 'BlogPosting',
      headline: a.ldHeadline,
      description: a.description,
      url: site.origin + a.url,
      image: a.image,
    };
    if (auteur) p.author = auteur;
    if (o.inLanguage) p.inLanguage = o.inLanguage;
    p.datePublished = a.datePublished;
    p.dateModified = a.dateModified;
    return p;
  });
  return JSON.stringify(o, null, 2);
};

const lies = (a) => {
  let cibles = a.related.map((s) => parSlug.get(s)).filter((x) => x && x.status === 'published');
  if (!cibles.length) {
    cibles = ordre.filter((x) => x.slug !== a.slug && x.category === a.category).slice(0, 2);
  }
  if (!cibles.length) return '';
  return `<aside class="art-lies" aria-labelledby="art-lies-titre">
<h2 id="art-lies-titre" class="art-lies-titre">À lire ensuite</h2>
<div class="art-trio">
${cibles.map((x) => carte(x, 'h3')).join('\n\n')}
</div>
</aside>`;
};

/* ── Barre du haut et pied ── */
const NUMERO = '33644247681';
const INSTAGRAM = 'https://www.instagram.com/miaoucratie';

/* Pictogrammes */
const TELEPHONE = 'M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z';
const COURRIEL = 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z';
const LOGO_INSTAGRAM = 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z';
const LOGO_WHATSAPP = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';
const trait = (taille, dessin) => `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dessin}</svg>`;
const pleinBarre = (d) => `<svg fill="currentColor" height="14" viewBox="0 0 24 24" width="14"><path d="${d}"/></svg>`;
const pleinPied = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

/* Entrées du menu */
const MENU = [
  { href: '/', libelle: 'Accueil', dessin: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V21h14V9.6"/>' },
  { href: 'tarifs.html', libelle: 'Tarifs', dessin: '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.6" cy="7.6" r="1.4"/>' },
  { href: 'faq.html', libelle: 'FAQ', dessin: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9.6a2.2 2.2 0 1 1 3 2.1v1.4"/><path d="M12.8 16.6h.01"/>' },
  { href: 'carte.html', libelle: 'Carte', dessin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/>' },
  { href: 'presse.html', libelle: 'Ils en parlent', dessin: '<path d="M4 5h13v14H4z"/><path d="M17 8h3v9a2 2 0 0 1-3 1.7"/><path d="M7 9h7M7 12h7M7 15h4"/>' },
  { href: 'coulisses-miaoucratie.html', libelle: 'Les coulisses de Miaoucratie', dessin: '<path d="M12.6 6.1v14.6a1 1 0 0 1-1.24.97L5 20.2V7.1a1.9 1.9 0 0 1 1.44-1.84l3.8-.95A1.9 1.9 0 0 1 12.6 6.1Z"/><path d="M12.6 5.4h2.9a1.9 1.9 0 0 1 1.9 1.9V21"/><path d="M3.2 21h1.8M12.6 21h8.2"/><path d="M10.2 13.4v.01"/><path fill="currentColor" stroke="none" d="M20.9 0.4 21.6 2.24 23.56 2.33 22.03 3.57 22.55 5.47 20.9 4.39 19.25 5.47 19.77 3.57 18.24 2.33 20.2 2.24Z"/>' },
  { href: 'espece-de-deuil.html', libelle: 'Espèce de Deuil', dessin: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M9 21h6"/>' },
  { href: 'reservation.html', libelle: 'Réservation', classe: 'is-cta', dessin: '<path d="M4 6h16v14H4z"/><path d="M4 10.5h16"/><path d="M8 3v4M16 3v4"/>' },
];
const entreeMenu = (href) => MENU.find((e) => e.href === href);

const barre = (courante) => {
  const liens = MENU.map((e) => {
    const classes = [e.href === courante ? 'is-current' : '', e.classe || ''].filter(Boolean).join(' ');
    return `    <a href="${e.href}"${classes ? ` class="${classes}"` : ''}>${trait(16, e.dessin)}${e.libelle}</a>`;
  }).join('\n');
  return `<header class="topbar"><div class="tmenu-wrap"><button class="tmenu-btn" id="tmenuBtn" aria-expanded="false">&#9776; Menu</button><nav class="tmenu-panel" id="tmenuPanel" style="display:none" aria-label="Menu principal">
${liens}
</nav></div><div class="topbar-links"><a href="tel:+${NUMERO}">${pleinBarre(TELEPHONE)}<span>06&nbsp;44&nbsp;24&nbsp;76&nbsp;81</span></a><span class="tsep"></span><a href="mailto:miaoucratie@gmail.com">${pleinBarre(COURRIEL)}<span>miaoucratie@gmail.com</span></a><span class="tsep"></span><a href="${INSTAGRAM}" target="_blank" rel="noopener">${pleinBarre(LOGO_INSTAGRAM)}<span>@miaoucratie</span></a><span class="tsep"></span><a href="https://wa.me/${NUMERO}" target="_blank" rel="noopener">${pleinBarre(LOGO_WHATSAPP)}<span>WhatsApp</span></a></div></header>`;
};

const lienPied = (href) => `<a href="${href}">${trait(14, entreeMenu(href).dessin)}${entreeMenu(href).libelle}</a>`;
const pied = `<footer class="footer-bar">
<div class="footer-logo"><img alt="Miaoucratie" src="images/logo-footer.webp" width="80" height="80" loading="lazy" decoding="async"/><span>Miaou<em>cratie<sup>®</sup>.</em></span></div>
<div class="footer-links">
${lienPied('coulisses-miaoucratie.html')}
${lienPied('presse.html')}
<a href="${INSTAGRAM}" target="_blank" rel="noopener">${pleinPied(LOGO_INSTAGRAM)}Instagram</a>
<a href="https://wa.me/${NUMERO}" target="_blank" rel="noopener">${pleinPied(LOGO_WHATSAPP)}WhatsApp</a>
</div>
<div class="footer-legal">
<a href="cgv.html">CGV</a> ·
<a href="mentions-legales.html">Mentions légales</a>
</div>
</footer>`;

/* Table des pages */
const PAGES = site.pages;
if (!PAGES || typeof PAGES !== 'object' || Array.isArray(PAGES)) {
  faute('blog/articles.json', "« site.pages » doit associer chaque page du site a son entree courante du menu, ou a null");
} else {
  const surDisque = fs.readdirSync(RACINE).filter((f) => f.endsWith('.html') && !f.startsWith('maquette-'));
  for (const f of surDisque) {
    if (!Object.hasOwn(PAGES, f)) faute(f, "page absente de « site.pages » : son entree courante du menu n'est pas declaree");
  }
  for (const [f, courante] of Object.entries(PAGES)) {
    if (!surDisque.includes(f)) faute('blog/articles.json', `« site.pages » declare « ${f} », qui n'est pas une page du site`);
    if (courante !== null && !entreeMenu(courante)) faute('blog/articles.json', `« site.pages » : entree courante inconnue pour ${f} : « ${courante} »`);
  }
}
if (erreurs.length) terminer();

/* Entrées du sitemap */
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
  const r = remplacerZone(actuel, nom, contenu);
  if (r.erreur) { faute(fichier, r.erreur); return; }
  aEcrire.set(fichier, r.texte);
  if (r.change) changements.push(`${fichier} — zone ${nom}`);
}

poser('coulisses-miaoucratie.html', 'BLOG_GRID', grille);
const ld = jsonld();
if (ld !== null) poser('coulisses-miaoucratie.html', 'BLOG_JSONLD', `<script type="application/ld+json">\n${ld}\n</script>`);
for (const a of publies) poser(a.url.replace(/^\//, ''), 'RELATED', lies(a));
poser('sitemap.xml', 'BLOG_URLS', urlsSitemap());
for (const [f, courante] of Object.entries(PAGES)) {
  poser(f, 'TOPBAR', barre(courante));
  poser(f, 'FOOTER', pied);
}
if (fs.existsSync(path.join(RACINE, 'faq.html'))) {
  poser('faq.html', 'FAQ_JSONLD', blocFaq(aEcrire.get('faq.html') ?? fs.readFileSync(path.join(RACINE, 'faq.html'), 'utf8')));
}
if (erreurs.length) terminer();

/* ── Contrôles avant écriture ── */
{
  const bg = aEcrire.get('coulisses-miaoucratie.html') || '';
  for (const a of publies) {
    const href = `href="${a.url.replace(/^\//, '')}"`;
    if (!bg.includes(href)) faute('coulisses-miaoucratie.html', `l'article publie « ${a.slug} » n'apparait pas dans la grille`);
  }
  for (const a of tous.filter((x) => x.status !== 'published')) {
    if (bg.includes(`href="${a.url.replace(/^\//, '')}"`)) faute('coulisses-miaoucratie.html', `le brouillon « ${a.slug} » apparait dans la grille`);
  }
  const sm = aEcrire.get('sitemap.xml') || '';
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const doublons = locs.filter((u, i) => locs.indexOf(u) !== i);
  if (doublons.length) faute('sitemap.xml', `url en double : ${[...new Set(doublons)].join(', ')}`);
  for (const a of publies) {
    if (!locs.includes(site.origin + a.url)) faute('sitemap.xml', `l'article publie « ${a.slug} » manque`);
  }
  if (!locs.includes(site.origin + site.blogUrl)) faute('sitemap.xml', "la page d'entree du blog manque");
  for (const a of publies) {
    const f = a.url.replace(/^\//, '');
    if (!fs.existsSync(path.join(RACINE, f))) faute('sitemap.xml', `url generee vers un fichier inexistant : ${site.origin}${a.url}`);
  }
  for (const a of tous.filter((x) => x.status !== 'published')) {
    if (locs.includes(site.origin + a.url)) faute('sitemap.xml', `le brouillon « ${a.slug} » est dans le sitemap`);
  }
  /* Liens des zones générées */
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
  /* JSON-LD généré */
  const b = (aEcrire.get('coulisses-miaoucratie.html') || '').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (b) { try { JSON.parse(b[1]); } catch (e) { faute('coulisses-miaoucratie.html', `JSON-LD genere invalide : ${e.message}`); } }
}
if (erreurs.length) terminer();

/* ── Vérification sans écriture ── */
if (CHECK) {
  if (!changements.length) {
    dire(`${publies.length} article(s) publie(s). Le depot est a jour.`);
    terminer();
  }
  for (const c of changements) faute(c, 'une zone generee (blog, barre du haut ou pied de page) differe de sa source : lancer npm run blog');
  terminer();
}

/* ── Écriture et relecture ── */
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
