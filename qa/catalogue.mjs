/* Catalogue des éléments */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUES = new Set(['calculateur.css']);

const feuillesDe = (dossier, racine = dossier) => readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
  const chemin = join(dossier, e.name);
  if (e.isDirectory()) return feuillesDe(chemin, racine);
  return e.name.endsWith('.css') && !EXCLUES.has(e.name) ? [relative(racine, chemin)] : [];
});

/* Sélecteurs */
const selecteurs = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1]).join('\n');

export function verifierCatalogue(racine) {
  const chemin = join(racine, 'gabarit', 'catalogue.html');
  if (!existsSync(chemin)) return ['gabarit/catalogue.html introuvable'];
  const elements = [...readFileSync(chemin, 'utf8').matchAll(/<section data-element="([\w-]+)" data-feuilles="([^"]*)"/g)]
    .map((m) => ({ classe: m[1], feuilles: m[2].split(/\s+/).filter(Boolean) }));
  if (!elements.length) return ['gabarit/catalogue.html ne déclare aucun élément'];
  const css = new Map(feuillesDe(join(racine, 'css')).map((f) => [f, selecteurs(readFileSync(join(racine, 'css', f), 'utf8'))]));
  const constats = [];
  for (const { classe, feuilles } of elements) {
    const motif = new RegExp(`\\.${classe}(?![\\w-])`);
    const reelles = [...css].filter(([, s]) => motif.test(s)).map(([f]) => f);
    for (const f of reelles) if (!feuilles.includes(f)) constats.push(`${classe} : stylé aussi dans ${f}, alors que son style vit dans ${feuilles.join(', ')}`);
    for (const f of feuilles) if (!reelles.includes(f)) constats.push(`${classe} : ${f} est déclarée mais ne le style plus, à retirer du catalogue`);
  }
  return constats;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const constats = verifierCatalogue(join(dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(`\nCatalogue des éléments — ${constats.length} constat(s)`);
  for (const c of constats) console.log(`  ${c}`);
  if (constats.length) process.exit(1);
}
