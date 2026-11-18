/* Contrôle de mise en page */

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { RELEVE, verifierBalisage } from './mise-en-page-regles.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html'));

/* Pages exclues */
const EXCLUES = new Set(['administration.html']);

/* Largeurs de contrôle */
const LARGEURS = [1280, 1024, 900, 768, 600, 480, 375, 320];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function demarrerServeur() {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0]);
    const fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
    if (!fichier.startsWith(RACINE) || !existsSync(fichier)) return res.writeHead(404).end('introuvable');
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
      res.end(await readFile(fichier));
    } catch {
      res.writeHead(500).end('erreur');
    }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(serveur)));
}

/* ══ Execution ════════════════════════════════════════════════════════════ */
const serveur = await demarrerServeur();
const base = `http://127.0.0.1:${serveur.address().port}`;
const navigateur = await chromium.launch();

const pages = DEMANDEES.length
  ? DEMANDEES
  : (await readdir(RACINE)).filter((f) => f.endsWith('.html') && !f.startsWith('maquette-') && !EXCLUES.has(f)).sort();

let total = 0;
const parPage = new Map();

for (const fichier of pages) {
  for (const a of verifierBalisage(readFileSync(join(RACINE, fichier), 'utf8'))) {
    if (!parPage.has(fichier)) parPage.set(fichier, new Map());
    parPage.get(fichier).set(`✗ balisage — ${a}`, ['fichier']);
    total++;
  }
  for (const largeur of LARGEURS) {
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, reducedMotion: 'reduce' });
    const page = await contexte.newPage();

    await page.goto(`${base}/${fichier}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await page.addStyleTag({ content: '* { pointer-events: auto !important; }' });
    const echecs = await page.evaluate(RELEVE);
    await contexte.close();
    if (!echecs.length) continue;
    if (!parPage.has(fichier)) parPage.set(fichier, new Map());
    for (const e of echecs) {
      const cle = `${e.avertissement ? '!' : '✗'} ${e.genre} — ${e.detail}`;
      const m = parPage.get(fichier);
      if (!m.has(cle)) m.set(cle, []);
      m.get(cle).push(largeur);
      total++;
    }
  }
}

await navigateur.close();
serveur.close();

console.log(`\nMise en page — ${pages.length} page(s), largeurs ${LARGEURS.join(' / ')}\n`);
if (!parPage.size) {
  console.log('  Aucun constat.\n');
} else {
  for (const [fichier, constats] of [...parPage].sort()) {
    const tries = [...constats].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(`  ${fichier}`);
    for (const [texte, largeurs] of tries) {
      console.log(`    ${texte}`);
      console.log(`        a ${[...new Set(largeurs)].join(', ')} px`);
    }
    console.log('');
  }
}
let echecs = 0, avertissements = 0;
for (const m of parPage.values()) for (const cle of m.keys()) (cle.startsWith('✗') ? echecs++ : avertissements++);
console.log(`  ${echecs} echec(s), ${avertissements} avertissement(s), ${total} occurrence(s)\n`);

if (STRICT && echecs > 0) {
  console.error(`Controle de mise en page en echec : ${echecs} constat(s).`);
  process.exit(1);
}
