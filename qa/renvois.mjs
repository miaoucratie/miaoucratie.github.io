/* Contrôle des renvois */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

const PAGES = readdirSync(RACINE).filter((f) => f.endsWith('.html')).sort();
const registre = JSON.parse(readFileSync(join(RACINE, 'blog', 'articles.json'), 'utf8'));
const PUBLIES = registre.articles.filter((a) => a.status === 'published');
/* Articles sans « À lire ensuite » */
const SANS_LIES = new Set(PUBLIES.filter((a) => !a.related.length).map((a) => a.url.replace(/^\//, '')));

const lire = (f) => readFileSync(join(RACINE, f), 'utf8');
const ancresDe = (t) => new Set([...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

/* Cache des ancres */
const cache = new Map();
const ancresDuFichier = (f) => {
  if (!cache.has(f)) cache.set(f, ancresDe(lire(f)));
  return cache.get(f);
};

const parPage = new Map();
const noter = (page, texte) => {
  if (!parPage.has(page)) parPage.set(page, []);
  parPage.get(page).push(texte);
};

/* Signalements */
const aSignaler = new Map();
const signaler = (page, texte) => {
  if (!aSignaler.has(page)) aSignaler.set(page, []);
  aSignaler.get(page).push(texte);
};

/* Formes de lien Amazon refusées */
const FORMES_BANNIES = [
  [/https:\/\/www\.amazon\.fr\/(?:dp|gp\/product)\/[A-Z0-9]{10}/g, 'lien Amazon reconstruit a la main, le deeplink du SiteStripe est attendu'],
  [/portal\/customer-reviews\//g, 'lien vers les avis Amazon : exige un login, casse pour un visiteur'],
];

for (const page of PAGES) {
  const t = lire(page);
  const ancres = ancresDe(t);

  /* 1. Notes */
  const appels = [...new Set([...t.matchAll(/<sup><a href="#(s\d+)">/g)].map((m) => m[1]))];
  const sources = [...t.matchAll(/<li id="(s\d+)"/g)].map((m) => m[1]);
  if (sources.length) {
    for (const a of appels) if (!sources.includes(a)) noter(page, `appel de note vers une source absente : #${a}`);
    for (const s of sources) if (!appels.includes(s)) noter(page, `source listee que rien ne cite : #${s}`);

    const suite = (l) => l.map((_, i) => `s${i + 1}`).join(' ');
    if (sources.join(' ') !== suite(sources)) {
      noter(page, `liste des sources dans le desordre : ${sources.join(' ')} au lieu de ${suite(sources)}`);
    }
    if (appels.length === sources.length && appels.join(' ') !== suite(appels)) {
      noter(page, `sources numerotees hors ordre d'apparition : ${appels.join(' ')} au lieu de ${suite(appels)}`);
    }
    for (const [, id, libelle] of t.matchAll(/<sup><a href="#s(\d+)">([^<]*)<\/a>/g)) {
      if (libelle !== id) noter(page, `appel affiche « ${libelle} » pour la source #s${id}`);
    }
  } else if (appels.length) {
    noter(page, `${appels.length} appel(s) de note sans bloc de sources`);
  }

  /* 2. Liens vers un fichier */
  for (const [, cible, ancre] of t.matchAll(/href="([^"#][^"]*?)(#[^"]*)?"/g)) {
    if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(cible)) continue;
    let chemin = cible.split('?')[0].replace(/^\//, '');
    if (chemin === '' || chemin.endsWith('/')) chemin += 'index.html';
    if (!existsSync(join(RACINE, chemin))) { noter(page, `fichier absent : ${cible}`); continue; }
    if (ancre && chemin.endsWith('.html') && !ancresDuFichier(chemin).has(ancre.slice(1))) {
      noter(page, `ancre absente chez la cible : ${cible}${ancre}`);
    }
  }

  /* 3. Ancres de la page */
  for (const [, a] of t.matchAll(/href="#([^"]+)"/g)) {
    if (a && !ancres.has(a)) noter(page, `ancre absente dans la page : #${a}`);
  }

  /* 4. Liens sortants */
  for (const [balise] of t.matchAll(/<a\s[^>]*href="https?:[^"]*"[^>]*>/g)) {
    const url = balise.match(/href="([^"]+)"/)[1];
    if (!/target="_blank"/.test(balise)) noter(page, `lien sortant sans nouvelle fenetre : ${url}`);
    else if (!/rel="[^"]*noopener/.test(balise)) noter(page, `lien sortant sans noopener : ${url}`);
    if (/amazon\.|amzlink\./.test(url) && !/rel="[^"]*sponsored/.test(balise)) {
      noter(page, `lien affilie sans sponsored : ${url}`);
    }
  }

  /* 4 bis. Forme des liens affiliés */
  for (const [rx, quoi] of FORMES_BANNIES) {
    const n = (t.match(rx) || []).length;
    if (n) signaler(page, `${n} × ${quoi}`);
  }

  /* 5. « À lire ensuite » */
  const bloc = t.match(/<!-- GENERATED:RELATED:START -->([\s\S]*?)<!-- GENERATED:RELATED:END -->/);
  if (bloc && !(SANS_LIES.has(page) && !bloc[1].trim())) {
    const cartes = [...bloc[1].matchAll(/<a class="btn-primary" href="([^"]+)"/g)].map((m) => m[1]);
    if (cartes.length !== 3) noter(page, `« A lire ensuite » : ${cartes.length} carte(s), 3 attendues`);
    if (cartes.includes(page)) noter(page, '« A lire ensuite » renvoie vers la page elle-meme');
    for (const c of cartes) if (!existsSync(join(RACINE, c))) noter(page, `carte vers une page absente : ${c}`);
  }
}

/* 6. Articles hors d'atteinte */
const cibles = new Set(PUBLIES.flatMap((a) => a.related));
const grille = registre.site.blogUrl.replace(/^\//, '');
for (const a of PUBLIES) {
  if (cibles.has(a.slug)) continue;
  const f = a.url.replace(/^\//, '');
  const atteint = SANS_LIES.has(f)
    && PAGES.some((p) => p !== f && p !== grille && lire(p).includes(`href="${f}"`));
  if (!atteint) noter('blog/articles.json', `aucune page ne mene a « ${a.slug} »`);
}

console.log(`\nRenvois — ${PAGES.length} page(s)\n`);
if (!parPage.size) console.log('  Aucune faute.\n');
else {
  for (const [page, fautes] of [...parPage].sort()) {
    console.log(`  ${page}`);
    for (const f of fautes) console.log(`    ✗ ${f}`);
    console.log('');
  }
}
const total = [...parPage.values()].reduce((n, l) => n + l.length, 0);

if (aSignaler.size) {
  console.log('  Signale, sans faire echouer le controle :\n');
  for (const [page, lignes] of [...aSignaler].sort()) {
    console.log(`  ${page}`);
    for (const l of lignes) console.log(`    ! ${l}`);
    console.log('');
  }
}
const signales = [...aSignaler.values()].reduce((n, l) => n + l.length, 0);

console.log(`  ${total} faute(s), ${signales} signalement(s)\n`);
if (STRICT && total) { console.error(`Controle des renvois en echec : ${total} faute(s).`); process.exit(1); }
