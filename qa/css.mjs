/**
 * Controle des feuilles de style.
 *
 *   node qa/css.mjs            liste les constats
 *   node qa/css.mjs --strict   sort en erreur s'il en reste
 *
 * Pourquoi ce fichier : une accolade ou un commentaire mal ferme ne fait pas
 * echouer un navigateur, il jette silencieusement la suite de la feuille. Le
 * defaut est alors visuel, diffus, et se cherche a la main. Ce controle le
 * rend immediat. Il verifie aussi que le blog n'a pas reintroduit de dette :
 * regles dupliquees, selecteurs jamais utilises, !important ajoutes.
 *
 * Aucune dependance : analyse textuelle, le site est en HTML statique.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

const feuilles = readdirSync(join(RACINE, 'css')).filter((f) => f.endsWith('.css')).sort();
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html'));

const constats = [];
const noter = (f, quoi) => constats.push(`  ${f.padEnd(18)} ${quoi}`);

/* ── Integrite : accolades et commentaires ── */
const declarees = new Map();
for (const f of feuilles) {
  const brut = readFileSync(join(RACINE, 'css', f), 'utf8');

  const ouvre = (brut.match(/\/\*/g) || []).length;
  const ferme = (brut.match(/\*\//g) || []).length;
  if (ouvre !== ferme) noter(f, `commentaires desequilibres : ${ouvre} ouvertures, ${ferme} fermetures`);

  const css = brut.replace(/\/\*[\s\S]*?\*\//g, '');
  let profondeur = 0, mini = 0;
  for (const c of css) {
    if (c === '{') profondeur++;
    else if (c === '}') { profondeur--; mini = Math.min(mini, profondeur); }
  }
  if (profondeur !== 0) noter(f, `accolades desequilibrees : ${profondeur > 0 ? profondeur + ' non fermee(s)' : -profondeur + ' en trop'}`);
  if (mini < 0) noter(f, 'une accolade fermante precede son ouvrante');

  /* Selecteurs declares, pour le recoupement avec le balisage. */
  const sels = [];
  let tampon = '', prof = 0;
  for (const c of css) {
    if (c === '{') { if (prof === 0) sels.push(tampon.trim()); prof++; tampon = ''; }
    else if (c === '}') { prof = Math.max(0, prof - 1); tampon = ''; }
    else tampon += c;
  }
  declarees.set(f, sels);

  const bang = (css.match(/!important/g) || []).length;
  if (bang) noter(f, `${bang} !important`);
}

/* ── Classes declarees mais jamais posees dans le balisage ── */
const posees = new Set();
for (const p of pages) {
  const html = readFileSync(join(RACINE, p), 'utf8');
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].trim().split(/\s+/)) posees.add(c);
}
/* Les classes ajoutees par script echappent au balisage : on les releve aussi. */
for (const j of readdirSync(join(RACINE, 'js')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(RACINE, 'js', j), 'utf8');
  for (const m of src.matchAll(/['"`]([a-z][\w-]*(?:\s+[a-z][\w-]*)*)['"`]/g)) for (const c of m[1].split(/\s+/)) posees.add(c);
}

for (const [f, sels] of declarees) {
  const orphelines = new Set();
  for (const s of sels) {
    for (const c of s.match(/\.[-\w]+/g) || []) {
      const nom = c.slice(1);
      if (!posees.has(nom)) orphelines.add(nom);
    }
  }
  if (orphelines.size) noter(f, `${orphelines.size} classe(s) declaree(s) et jamais posee(s) : ${[...orphelines].sort().slice(0, 12).join(' ')}`);
}

/* ── Selecteur declare deux fois dans la meme feuille ── */
for (const [f, sels] of declarees) {
  const vus = new Map();
  for (const s of sels) {
    const cle = s.replace(/\s+/g, ' ').trim();
    if (!cle) continue;
    vus.set(cle, (vus.get(cle) || 0) + 1);
  }
  const doubles = [...vus].filter(([, n]) => n > 1);
  if (doubles.length) noter(f, `${doubles.length} selecteur(s) declare(s) plusieurs fois : ${doubles.slice(0, 4).map(([s, n]) => `${s} ×${n}`).join(' · ')}`);
}

/* ── Ordre de chargement, page par page ── */
const ordres = new Map();
for (const p of pages) {
  const html = readFileSync(join(RACINE, p), 'utf8');
  const suite = [...html.matchAll(/href="css\/([^"]+)"/g)].map((m) => m[1]);
  if (!suite.length) continue;
  const cle = suite.join(' > ');
  if (!ordres.has(cle)) ordres.set(cle, []);
  ordres.get(cle).push(p);
  if (suite.includes('couches.css') && suite[suite.length - 1] !== 'couches.css') {
    noter(p, `couches.css n'est pas chargee en dernier : ${cle}`);
  }
  if (suite.includes('style.css') && suite.indexOf('style.css') > suite.indexOf('couches.css')) {
    noter(p, 'style.css chargee apres couches.css');
  }
}

console.log(`\nFeuilles de style — ${feuilles.length} feuilles, ${pages.length} pages\n`);
console.log(constats.length ? constats.join('\n') : '  Aucun constat.');
console.log('\n  ── ordre de chargement ──');
for (const [suite, liste] of [...ordres].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(liste.length).padStart(2)} page(s)  ${suite}`);
}
console.log('');

if (STRICT && constats.length) {
  console.error(`Controle CSS en echec : ${constats.length} constat(s).`);
  process.exit(1);
}
