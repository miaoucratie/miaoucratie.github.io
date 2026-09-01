/**
 * Controle des renvois : notes, liens, ancres, « A lire ensuite ».
 *
 *   node qa/renvois.mjs             releve
 *   node qa/renvois.mjs --strict    sort en erreur s'il reste une faute
 *
 * Pourquoi ce fichier : rien ne verifiait ou menent les liens. Le controle SEO
 * regarde les balises d'une page, le generateur regarde le registre, la QA
 * regarde le comportement. Entre les trois, quatre pannes passaient sans que
 * rien ne les arrete :
 *
 *   · un appel de note qui ne tombe sur aucune source, ou une source listee
 *     que plus aucun paragraphe ne cite, apres une reecriture ;
 *   · un lien vers une page renommee, ou vers une ancre supprimee ;
 *   · un lien affilie qui a perdu son « sponsored », ou un lien sortant sans
 *     « noopener » ;
 *   · un article que plus aucune page ne cite dans « A lire ensuite », donc
 *     hors d'atteinte pour un lecteur comme pour un moteur.
 *
 * Aucun navigateur : le controle lit les fichiers et rend la main en une
 * seconde. Les pages ne sont pas recopiees ici, elles sont trouvees a la
 * racine, et les articles publies viennent du registre.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

const PAGES = readdirSync(RACINE).filter((f) => f.endsWith('.html')).sort();
const registre = JSON.parse(readFileSync(join(RACINE, 'blog', 'articles.json'), 'utf8'));
const PUBLIES = registre.articles.filter((a) => a.status === 'published');

const lire = (f) => readFileSync(join(RACINE, f), 'utf8');
const ancresDe = (t) => new Set([...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

/* Un fichier lu une seule fois, meme s'il est la cible de dix liens. */
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

for (const page of PAGES) {
  const t = lire(page);
  const ancres = ancresDe(t);

  /* 1. Les notes. Une page sans bloc de sources n'est pas concernee. */
  const appels = [...new Set([...t.matchAll(/<sup><a href="#(s\d+)">/g)].map((m) => m[1]))];
  const sources = [...t.matchAll(/<li id="(s\d+)"/g)].map((m) => m[1]);
  if (sources.length) {
    for (const a of appels) if (!sources.includes(a)) noter(page, `appel de note vers une source absente : #${a}`);
    for (const s of sources) if (!appels.includes(s)) noter(page, `source listee que rien ne cite : #${s}`);
  } else if (appels.length) {
    noter(page, `${appels.length} appel(s) de note sans bloc de sources`);
  }

  /* 2. Les liens vers un fichier du depot, et leur ancre s'ils en ont une. */
  for (const [, cible, ancre] of t.matchAll(/href="([^"#][^"]*?)(#[^"]*)?"/g)) {
    if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(cible)) continue;
    const chemin = cible.split('?')[0].replace(/^\//, '');
    if (!existsSync(join(RACINE, chemin))) { noter(page, `fichier absent : ${cible}`); continue; }
    if (ancre && chemin.endsWith('.html') && !ancresDuFichier(chemin).has(ancre.slice(1))) {
      noter(page, `ancre absente chez la cible : ${cible}${ancre}`);
    }
  }

  /* 3. Les liens internes a la page. */
  for (const [, a] of t.matchAll(/href="#([^"]+)"/g)) {
    if (a && !ancres.has(a)) noter(page, `ancre absente dans la page : #${a}`);
  }

  /* 4. Ce qui sort du site s'ouvre a cote, sans donner la main a la page
        ouverte, et un lien remunere le dit. */
  for (const [balise] of t.matchAll(/<a\s[^>]*href="https?:[^"]*"[^>]*>/g)) {
    const url = balise.match(/href="([^"]+)"/)[1];
    if (!/target="_blank"/.test(balise)) noter(page, `lien sortant sans nouvelle fenetre : ${url}`);
    else if (!/rel="[^"]*noopener/.test(balise)) noter(page, `lien sortant sans noopener : ${url}`);
    if (/amazon\.|amzlink\./.test(url) && !/rel="[^"]*sponsored/.test(balise)) {
      noter(page, `lien affilie sans sponsored : ${url}`);
    }
  }

  /* 5. « A lire ensuite » : la rangee tient trois colonnes, une page ne se
        cite pas elle-meme, et chaque carte mene quelque part. */
  const bloc = t.match(/<!-- GENERATED:RELATED:START -->([\s\S]*?)<!-- GENERATED:RELATED:END -->/);
  if (bloc) {
    const cartes = [...bloc[1].matchAll(/<a class="btn-primary" href="([^"]+)"/g)].map((m) => m[1]);
    if (cartes.length !== 3) noter(page, `« A lire ensuite » : ${cartes.length} carte(s), 3 attendues`);
    if (cartes.includes(page)) noter(page, '« A lire ensuite » renvoie vers la page elle-meme');
    for (const c of cartes) if (!existsSync(join(RACINE, c))) noter(page, `carte vers une page absente : ${c}`);
  }
}

/* 6. Personne ne reste hors d'atteinte. */
const cibles = new Set(PUBLIES.flatMap((a) => a.related));
for (const a of PUBLIES) {
  if (!cibles.has(a.slug)) noter('blog/articles.json', `aucune page ne mene a « ${a.slug} »`);
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
console.log(`  ${total} faute(s)\n`);
if (STRICT && total) { console.error(`Controle des renvois en echec : ${total} faute(s).`); process.exit(1); }
