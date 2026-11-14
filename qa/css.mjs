/* Contrôle des feuilles de style */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOM_CLASSE,
  classesDeBibliotheque,
  classesManipulees,
  commentairesNonFermes,
  estTiers,
  nomsDeClasses,
  selecteursDePremierNiveau,
} from './css-regles.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

const feuilles = readdirSync(join(RACINE, 'css')).filter((f) => f.endsWith('.css')).sort();
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html'));

const constats = [];
const noter = (f, quoi) => constats.push(`  ${f.padEnd(18)} ${quoi}`);

/* ── Intégrité des accolades et commentaires ── */
const declarees = new Map();
for (const f of feuilles) {
  const brut = readFileSync(join(RACINE, 'css', f), 'utf8');

  const nonFermes = commentairesNonFermes(brut);
  if (nonFermes.length) {
    noter(f, `${nonFermes.length} commentaire(s) jamais ferme(s), ouvert(s) ligne(s) ${nonFermes.join(', ')}`
      + ' — tout ce qui suit est avale jusqu\'au prochain */');
  }

  const css = brut.replace(/\/\*[\s\S]*?\*\//g, '');
  let profondeur = 0, mini = 0;
  for (const c of css) {
    if (c === '{') profondeur++;
    else if (c === '}') { profondeur--; mini = Math.min(mini, profondeur); }
  }
  if (profondeur !== 0) noter(f, `accolades desequilibrees : ${profondeur > 0 ? profondeur + ' non fermee(s)' : -profondeur + ' en trop'}`);
  if (mini < 0) noter(f, 'une accolade fermante precede son ouvrante');

  declarees.set(f, selecteursDePremierNiveau(brut));

  const bang = (css.match(/!important/g) || []).length;
  if (bang) noter(f, `${bang} !important`);
}

/* ── Trois relevés ── */
const posees = new Set();
for (const p of pages) {
  const html = readFileSync(join(RACINE, p), 'utf8');
  for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].trim().split(/\s+/)) if (c) posees.add(c);
}

const declareesPartout = new Set();
for (const sels of declarees.values()) {
  for (const s of sels) for (const n of nomsDeClasses(s)) declareesPartout.add(n);
}
for (const p of pages) {
  const html = readFileSync(join(RACINE, p), 'utf8');
  for (const bloc of html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []) {
    for (const n of nomsDeClasses(bloc.replace(/\/\*[\s\S]*?\*\//g, ''))) declareesPartout.add(n);
  }
}

const accroches = new Set();
const releverAccroches = (source) => {
  for (const c of classesManipulees(source)) accroches.add(c);
};
for (const j of readdirSync(join(RACINE, 'js')).filter((f) => f.endsWith('.js'))) {
  releverAccroches(readFileSync(join(RACINE, 'js', j), 'utf8'));
}
for (const p of pages) {
  const html = readFileSync(join(RACINE, p), 'utf8');
  for (const bloc of html.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) || []) releverAccroches(bloc);
}

const seulementAvecTiers = classesDeBibliotheque([...declarees.values()].flat());

/* ── Classes déclarées non posées ── */
for (const [f, sels] of declarees) {
  const orphelines = new Set();
  for (const s of sels) {
    for (const n of nomsDeClasses(s)) {
      if (posees.has(n) || accroches.has(n)) continue;
      if (estTiers(n) || seulementAvecTiers.has(n)) continue;
      orphelines.add(n);
    }
  }
  if (orphelines.size) noter(f, `${orphelines.size} classe(s) declaree(s) et jamais posee(s) : ${[...orphelines].sort().join(' ')}`);
}

/* ── Classes posées non déclarées ── */

for (const p of pages) {
  const html = readFileSync(join(RACINE, p), 'utf8');
  const mortes = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].trim().split(/\s+/)) {
      if (!c || declareesPartout.has(c) || accroches.has(c) || estTiers(c)) continue;
      mortes.add(c);
    }
  }
  if (mortes.size) noter(p, `${mortes.size} classe(s) posee(s) et declaree(s) nulle part : ${[...mortes].sort().join(' ')}`);
}

/* ── Sélecteur déclaré deux fois ── */
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
