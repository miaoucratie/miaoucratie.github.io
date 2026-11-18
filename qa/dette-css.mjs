/* Relevé du CSS mort */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demarrerFauxWorker, demarrerServeur } from './qa.mjs';
import { parcourirEtats } from './etats.mjs';
import { RELEVE, classer, recopiees } from './dette-css-regles.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const DETAIL = process.argv.includes('--detail');
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html'));
const LARGEURS = [1280, 1024, 900, 768, 600, 480, 375, 320];

/* Exceptions */
const EXCEPTIONS = new Map([
  ['calculateur-miaoucratie.html', 'page appelée à disparaître'],
  ['calculateur.css', 'feuille de cette seule page'],
]);

/* Programme */
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html') && !EXCEPTIONS.has(f) && (!DEMANDEES.length || DEMANDEES.includes(f))).sort();
const worker = await demarrerFauxWorker();
const serveur = await demarrerServeur(worker.url);
const base = `http://127.0.0.1:${serveur.address().port}`;
const reseau = { coupees: [], antirobot: [], courriels: [], worker };
const navigateur = await chromium.launch();
const mesuresFaites = [];
const exclues = [...EXCEPTIONS.keys()];
let mesures = 0;
for (const page of pages) {
  for (const largeur of LARGEURS) {
    await parcourirEtats(navigateur, base, reseau, page, largeur, async (p) => {
      mesuresFaites.push(await p.evaluate(RELEVE, exclues));
      mesures++;
    });
  }
}
await navigateur.close();
serveur.close();
worker.serveur.close();

const { vues, utiles, jamais, sansEffet, exclues: horsMesure } = classer(mesuresFaites);
const lister = (dossier, prefixe = '') => readdirSync(join(RACINE, dossier), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? lister(join(dossier, e.name), `${prefixe}${e.name}/`) : e.name.endsWith('.css') ? [`${prefixe}${e.name}`] : []));
const sources = new Map(lister('css').filter((f) => !EXCEPTIONS.has(f)).map((f) => [f, readFileSync(join(RACINE, 'css', f), 'utf8')]));
const chargements = pages.map((p) => [...readFileSync(join(RACINE, p), 'utf8').matchAll(/href="css\/([^"]+)"/g)].map((m) => m[1]));
const doubles = recopiees(sources, chargements);
const parFeuille = (liste) => {
  const n = new Map();
  for (const k of liste) { const f = k.split(' | ')[0]; n.set(f, (n.get(f) || 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]).map(([f, c]) => `    ${String(c).padStart(5)}  ${f}`).join('\n');
};

console.log(`\nCSS mort — ${pages.length} pages, ${LARGEURS.length} largeurs, ${mesures} états mesurés, ${vues.size} déclarations\n`);
console.log(`  utiles                         ${utiles.size}`);
console.log(`  ne s'appliquent jamais         ${jamais.length}`);
console.log(`  s'appliquent sans rien changer ${sansEffet.length}`);
console.log(`  recopiées d'une feuille à l'autre ${doubles.length}`);
console.log(`  recoupement : ${utiles.size} + ${jamais.length} + ${sansEffet.length} = ${utiles.size + jamais.length + sansEffet.length} sur ${vues.size}`);
console.log(`  hors mesure, nommées           ${horsMesure.length}`);
const raisons = new Map();
for (const k of horsMesure) { const r = k.split(' | ').pop(); raisons.set(r, (raisons.get(r) || 0) + 1); }
for (const [r, n] of raisons) console.log(`    ${String(n).padStart(5)}  ${r}`);
if (jamais.length) console.log(`\n  ── ne s'appliquent jamais ──\n${parFeuille(jamais)}`);
if (sansEffet.length) console.log(`\n  ── s'appliquent sans rien changer ──\n${parFeuille(sansEffet)}`);
if (DETAIL) {
  for (const [titre, liste] of [['ne s\'appliquent jamais', jamais], ['s\'appliquent sans rien changer', sansEffet], ['recopiées', doubles], ['hors mesure', horsMesure]]) {
    if (liste.length) console.log(`\n  ── ${titre}, en entier ──\n${liste.map((k) => `    ${k}`).join('\n')}`);
  }
}
console.log(`\n  ── exceptions ──\n${[...EXCEPTIONS].map(([n, r]) => `  ${n} : ${r}`).join('\n')}\n`);
const total = jamais.length + sansEffet.length + doubles.length;
if (STRICT && total) {
  console.error(`CSS mort : ${total} constat(s).`);
  process.exit(1);
}
