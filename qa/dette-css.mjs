/* Relevé du CSS mort */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demarrerFauxWorker, demarrerServeur } from './qa.mjs';
import { parcourirEtats } from './etats.mjs';
import { RELEVE, classer, recopiees, empreinteDePage } from './dette-css-regles.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const DETAIL = process.argv.includes('--detail');
const SANS_CACHE = process.argv.includes('--sans-cache');
const CACHE = join(RACINE, 'qa', '.cache', 'dette-css');
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html'));
const LARGEURS = [1280, 1024, 900, 768, 600, 480, 375, 320];

/* Exceptions */
const EXCEPTIONS = new Map([
  ['calculateur-miaoucratie.html', 'page appelée à disparaître'],
  ['calculateur.css', 'feuille de cette seule page'],
]);

/* Programme */
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html') && !EXCEPTIONS.has(f) && (!DEMANDEES.length || DEMANDEES.includes(f))).sort();
const exclues = [...EXCEPTIONS.keys()];
let mesures = 0;

/* Pages inchangées */
mkdirSync(CACHE, { recursive: true });
const releves = new Map();
const empreintes = new Map(pages.map((p) => [p, empreinteDePage(RACINE, p)]));
for (const p of pages) {
  const fichier = join(CACHE, `${p}.json`);
  if (SANS_CACHE || !existsSync(fichier)) continue;
  const garde = JSON.parse(readFileSync(fichier, 'utf8'));
  if (garde.empreinte !== empreintes.get(p)) continue;
  releves.set(p, garde);
  mesures += garde.etats;
}
const reprises = releves.size;
const aMesurer = pages.filter((p) => !releves.has(p));
for (const p of aMesurer) releves.set(p, { empreinte: empreintes.get(p), etats: 0, vues: new Set(), visees: new Set(), utiles: new Set(), exclues: new Set() });

const navigateur = await chromium.launch();
/* Quatre files en parallèle */
const travaux = aMesurer.flatMap((page) => LARGEURS.map((largeur) => [page, largeur]));
const FILES = Number(process.env.DETTE_PARALLELE) || Math.max(1, Math.min(4, availableParallelism() - 1));
await Promise.all(Array.from({ length: FILES }, async () => {
  const worker = await demarrerFauxWorker();
  const serveur = await demarrerServeur(worker.url);
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const reseau = { coupees: [], antirobot: [], courriels: [], worker };
  while (travaux.length) {
    const [page, largeur] = travaux.shift();
    let minuteur;
    await Promise.race([
      parcourirEtats(navigateur, base, reseau, page, largeur, async (p) => {
        const m = await p.evaluate(RELEVE, exclues);
        const r = releves.get(page);
        for (const k of ['vues', 'visees', 'utiles', 'exclues']) m[k].forEach((c) => r[k].add(c));
        r.etats++;
        mesures++;
      }),
      new Promise((_, ko) => { minuteur = setTimeout(() => ko(new Error(`${page}@${largeur} : plus de 3 minutes`)), 180000); }),
    ]).finally(() => clearTimeout(minuteur));
    if (DETAIL) process.stderr.write(`  ${page}@${largeur}\n`);
  }
  serveur.close();
  worker.serveur.close();
}));
await navigateur.close();
for (const p of aMesurer) {
  const r = releves.get(p);
  for (const k of ['vues', 'visees', 'utiles', 'exclues']) r[k] = [...r[k]].sort();
  writeFileSync(join(CACHE, `${p}.json`), JSON.stringify(r));
}

const { vues, utiles, jamais, sansEffet, exclues: horsMesure } = classer([...releves.values()]);
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

console.log(`\nCSS mort — ${pages.length} pages, ${LARGEURS.length} largeurs, ${mesures} états mesurés, ${vues.size} déclarations`);
console.log(`  pages mesurées ${aMesurer.length}, reprises inchangées ${reprises}\n`);
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
