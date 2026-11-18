/* Relevé des styles */

import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demarrerFauxWorker, demarrerServeur } from './qa.mjs';
import { parcourirEtats } from './etats.mjs';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REF = process.argv[2] || 'origin/main';
const LARGEURS = [1280, 1024, 900, 768, 600, 480, 375, 320];
const MAX_LIGNES = Number(process.env.STYLES_LIGNES) || 200;
const ELEMENTS = 'body *:not(script):not(style):not(noscript):not(template)';

/* Styles de tous les éléments */
const lireTout = (page) => page.evaluate((sel) => {
  const props = [...getComputedStyle(document.body)].filter((k) => !k.startsWith('--'));
  return [...document.querySelectorAll(sel)].map((e) => {
    const ligne = {};
    for (const pseudo of [null, '::before', '::after']) {
      const c = getComputedStyle(e, pseudo);
      if (pseudo && c.content === 'none') continue;
      for (const k of props) ligne[(pseudo || '') + k] = c.getPropertyValue(k);
    }
    return [e.tagName + (e.id ? `#${e.id}` : '') + (e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/).join('.')}` : ''), ligne];
  });
}, ELEMENTS);

/* Comparaison */
function comparer(a, b, lieu, ecarts) {
  if (a.length !== b.length) return ecarts.push(`${lieu} : ${a.length} éléments avant, ${b.length} après`);
  a.forEach(([nom, avant], i) => {
    const apres = b[i][1];
    for (const k of Object.keys({ ...avant, ...apres })) {
      if (avant[k] !== apres[k]) ecarts.push(`${lieu} ${nom} ${k} : « ${avant[k]} » → « ${apres[k]} »`);
    }
  });
}

/* Programme */
const avantDir = await mkdtemp(join(tmpdir(), 'styles-'));
execFileSync('sh', ['-c', `git archive ${REF} | tar -x -C "${avantDir}"`], { cwd: RACINE });
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html') && (!process.argv[3] || f === process.argv[3])).sort();
const worker = await demarrerFauxWorker();
const [sa, sb] = await Promise.all([demarrerServeur(worker.url, avantDir), demarrerServeur(worker.url)]);
const ua = `http://127.0.0.1:${sa.address().port}`;
const ub = `http://127.0.0.1:${sb.address().port}`;
const reseau = { coupees: [], antirobot: [], courriels: [], worker };
const navigateur = await chromium.launch();
const ecarts = [];
let etats = 0;
for (const page of pages) {
  for (const largeur of LARGEURS) {
    const avant = new Map();
    await parcourirEtats(navigateur, ua, reseau, page, largeur, async (p, nom) => { avant.set(nom, await lireTout(p)); });
    await parcourirEtats(navigateur, ub, reseau, page, largeur, async (p, nom) => {
      comparer(avant.get(nom), await lireTout(p), `${page}@${largeur} [${nom}]`, ecarts);
      etats++;
    });
  }
}
await navigateur.close();
sa.close();
sb.close();
worker.serveur.close();
await rm(avantDir, { recursive: true, force: true });

console.log(`\nStyles calculés comparés à ${REF} — ${pages.length} pages, ${LARGEURS.length} largeurs, ${etats} états, pseudo-éléments, survol et focus compris\n`);
console.log(ecarts.length ? ecarts.slice(0, MAX_LIGNES).join('\n') : '  Aucun écart.');
if (ecarts.length > MAX_LIGNES) console.log(`  … et ${ecarts.length - MAX_LIGNES} autres`);
process.exit(ecarts.length ? 1 : 0);
