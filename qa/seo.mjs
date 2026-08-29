/**
 * Audit SEO on-page du site Miaoucratie.
 *
 *   node qa/seo.mjs            controle et affiche le score
 *   node qa/seo.mjs --strict   sort en erreur si le score passe sous le seuil
 *
 * Pourquoi un script et pas une relecture a la main : le SEO on-page est un
 * critere de qualite a chaque pull request, au meme titre que la non-regression.
 * Une relecture humaine oublie une balise ; un controle qui rend un chiffre, non.
 *
 * Le score est un pourcentage de controles reussis. Une ERREUR compte pour un
 * echec, une ALERTE pour un demi. Le seuil de reussite est SEUIL_SCORE.
 *
 * Aucune dependance : le site est en HTML statique, un analyseur maison suffit
 * et evite d'ajouter un paquet pour douze pages.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEUIL_SCORE = 89;
const SITE = 'https://miaoucratie.fr/';

/* Pages exclues du controle : l'ecran d'administration n'est pas une page
   publique, il porte deja noindex,nofollow et n'a pas a etre reference. */
const EXCLUES = new Set(['admin-indisponibilites.html']);

/* Longueurs retenues : au-dela, les moteurs tronquent l'affichage. Ce sont des
   bornes d'affichage, pas des regles de classement, d'ou l'alerte et non
   l'erreur. */
const TITRE_MIN = 25, TITRE_MAX = 65;
const DESC_MIN = 70, DESC_MAX = 160;

const texteBrut = (h) => h
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/⁠/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const attr = (balise, nom) => {
  const m = balise.match(new RegExp(`${nom}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? m[1] : null;
};

const pages = readdirSync(RACINE)
  .filter((f) => f.endsWith('.html') && !EXCLUES.has(f))
  .sort();

const sitemap = readFileSync(join(RACINE, 'sitemap.xml'), 'utf8');
const urlsSitemap = new Set([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]));

const constats = [];      // { page, gravite, regle, detail }
let controles = 0, echecs = 0;

const verifier = (page, regle, ok, detail, gravite = 'ERREUR') => {
  controles++;
  if (!ok) {
    echecs += gravite === 'ERREUR' ? 1 : 0.5;
    constats.push({ page, gravite, regle, detail });
  }
};

const titres = new Map(), descriptions = new Map();

for (const page of pages) {
  const html = readFileSync(join(RACINE, page), 'utf8');
  const tete = html.slice(0, html.indexOf('</head>') + 7);
  const url = SITE + (page === 'index.html' ? '' : page);

  /* ── Langue et cadrage ── */
  verifier(page, 'attribut lang', /<html[^>]+lang="fr"/i.test(html), 'la langue du document doit etre declaree');
  verifier(page, 'meta viewport', /<meta[^>]+name="viewport"/i.test(tete), 'sans viewport, pas d\'indexation mobile correcte');
  verifier(page, 'jeu de caracteres', /<meta[^>]+charset=/i.test(tete), 'charset absent');

  /* ── Titre ── */
  const titre = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  const titreTexte = titre ? titre.replace(/&nbsp;/g, ' ').trim() : '';
  verifier(page, 'balise title', !!titreTexte, 'title absent ou vide');
  if (titreTexte) {
    verifier(page, 'longueur du title',
      titreTexte.length >= TITRE_MIN && titreTexte.length <= TITRE_MAX,
      `${titreTexte.length} caracteres, attendu entre ${TITRE_MIN} et ${TITRE_MAX}`, 'ALERTE');
    const deja = titres.get(titreTexte);
    verifier(page, 'title unique', !deja, `identique a celui de ${deja}`);
    titres.set(titreTexte, page);
  }

  /* ── Meta description ── */
  const desc = (tete.match(/<meta[^>]+name="description"[^>]*>/i) || [])[0];
  const descTexte = desc ? (attr(desc, 'content') || '').replace(/&nbsp;/g, ' ').trim() : '';
  verifier(page, 'meta description', !!descTexte, 'description absente ou vide');
  if (descTexte) {
    verifier(page, 'longueur de la description',
      descTexte.length >= DESC_MIN && descTexte.length <= DESC_MAX,
      `${descTexte.length} caracteres, attendu entre ${DESC_MIN} et ${DESC_MAX}`, 'ALERTE');
    const deja = descriptions.get(descTexte);
    verifier(page, 'description unique', !deja, `identique a celle de ${deja}`);
    descriptions.set(descTexte, page);
  }

  /* ── Canonique ── */
  const canon = (tete.match(/<link[^>]+rel="canonical"[^>]*>/i) || [])[0];
  const canonUrl = canon ? attr(canon, 'href') : null;
  verifier(page, 'canonical', !!canonUrl, 'canonical absente');
  if (canonUrl) verifier(page, 'canonical auto-referente', canonUrl === url, `pointe vers ${canonUrl}, attendu ${url}`);

  /* ── Open Graph ── */
  for (const prop of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type']) {
    verifier(page, `balise ${prop}`, new RegExp(`property="${prop}"`).test(tete), 'absente', 'ALERTE');
  }

  /* ── Hierarchie des titres ──
     Un seul h1, et aucun saut de niveau : un h3 ne peut pas suivre un h1. */
  const niveaux = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ n: +m[1], texte: texteBrut(m[2]) }))
    .filter((h) => h.texte);
  const nbH1 = niveaux.filter((h) => h.n === 1).length;
  verifier(page, 'un seul h1', nbH1 === 1, `${nbH1} balise(s) h1`);
  const sauts = niveaux.filter((h, i) => i > 0 && h.n - niveaux[i - 1].n > 1);
  verifier(page, 'hierarchie sans saut', sauts.length === 0,
    sauts.map((s) => `h${s.n} « ${s.texte.slice(0, 32)} »`).join(', '));
  verifier(page, 'titres non vides', niveaux.every((h) => h.texte.length > 1), 'un titre est vide');

  /* ── Images ── */
  for (const img of html.match(/<img\b[^>]*>/gi) || []) {
    const alt = attr(img, 'alt');
    const src = attr(img, 'src') || '(sans src)';
    verifier(page, 'attribut alt', alt !== null, `alt absent sur ${basename(src)}`);
    verifier(page, 'dimensions de l\'image',
      attr(img, 'width') !== null && attr(img, 'height') !== null,
      `width/height absents sur ${basename(src)}, risque de decalage a l'affichage`, 'ALERTE');
  }

  /* ── Liens internes ── */
  const corps = html.slice(html.indexOf('<body'));
  for (const a of corps.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(a, 'href');
    if (!href || /^(https?:|mailto:|tel:|#)/.test(href)) continue;
    const cible = href.split('#')[0].split('?')[0];
    if (!cible) continue;
    let existe = true;
    try { readFileSync(join(RACINE, cible)); } catch { existe = false; }
    verifier(page, 'lien interne valide', existe, `${href} ne correspond a aucun fichier`);
  }

  /* ── Donnees structurees ── */
  for (const bloc of html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []) {
    const json = bloc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    let ok = true;
    try { JSON.parse(json); } catch { ok = false; }
    verifier(page, 'JSON-LD valide', ok, 'le bloc de donnees structurees ne se lit pas');
    verifier(page, 'JSON-LD sans entite HTML', !json.includes('&nbsp;'),
      'une entite HTML s\'est glissee dans le JSON, elle y reste litterale');
  }

  /* ── Coherence indexation et sitemap ── */
  const robots = (tete.match(/<meta[^>]+name="robots"[^>]*>/i) || [])[0];
  const noindex = robots ? /noindex/i.test(attr(robots, 'content') || '') : false;
  const dansSitemap = urlsSitemap.has(url);
  verifier(page, 'coherence sitemap', noindex ? !dansSitemap : dansSitemap,
    noindex
      ? 'page en noindex mais presente dans le sitemap'
      : 'page indexable mais absente du sitemap');

  /* ── Contenu ──
     Une page trop courte ne se positionne sur rien. Seuil bas et volontairement
     indulgent : la carte et le calculateur sont des outils, pas des articles. */
  const mots = texteBrut(corps).split(/\s+/).length;
  verifier(page, 'volume de contenu', mots >= 250, `${mots} mots dans le corps`, 'ALERTE');
}

/* ── Le sitemap ne doit pas pointer vers des pages absentes ── */
for (const url of urlsSitemap) {
  const fichier = url === SITE ? 'index.html' : url.replace(SITE, '');
  let existe = true;
  try { readFileSync(join(RACINE, fichier)); } catch { existe = false; }
  verifier('sitemap.xml', 'URL du sitemap existante', existe, `${url} ne correspond a aucun fichier`);
}

/* ── Rapport ── */
const score = Math.round(((controles - echecs) / controles) * 1000) / 10;
const erreurs = constats.filter((c) => c.gravite === 'ERREUR');
const alertes = constats.filter((c) => c.gravite === 'ALERTE');

const parPage = new Map();
for (const c of constats) {
  if (!parPage.has(c.page)) parPage.set(c.page, []);
  parPage.get(c.page).push(c);
}

console.log(`\nAudit SEO on-page — ${pages.length} pages, ${controles} controles\n`);
if (constats.length === 0) {
  console.log('  Aucun defaut.\n');
} else {
  for (const [page, liste] of [...parPage].sort()) {
    console.log(`  ${page}`);
    for (const c of liste) console.log(`    ${c.gravite === 'ERREUR' ? '✗' : '!'} ${c.regle} — ${c.detail}`);
    console.log('');
  }
}
console.log(`  ${erreurs.length} erreur(s), ${alertes.length} alerte(s)`);
console.log(`  Score : ${score} %  (seuil ${SEUIL_SCORE} %)\n`);

if (process.argv.includes('--strict') && score < SEUIL_SCORE) {
  console.error(`Score insuffisant : ${score} % < ${SEUIL_SCORE} %`);
  process.exit(1);
}
