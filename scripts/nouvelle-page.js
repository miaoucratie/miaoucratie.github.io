#!/usr/bin/env node
/* Page neuve depuis le gabarit */
// npm run page -- <fichier.html> "<titre>" "<description>"

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE = process.env.BLOG_RACINE ? path.resolve(process.env.BLOG_RACINE) : path.join(__dirname, '..');

const echouer = (m) => { console.error(`  ${m}`); process.exit(1); };
const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function creerPage(racine, fichier, titre, description) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.html$/.test(fichier) || fichier.startsWith('maquette-')) throw new Error(`nom de fichier refusé : « ${fichier} » (minuscules, chiffres et tirets, terminé par .html)`);
  if (!titre?.trim() || !description?.trim()) throw new Error('le titre et la description sont obligatoires');
  const cible = path.join(racine, fichier);
  if (fs.existsSync(cible)) throw new Error(`${fichier} existe déjà`);

  /* Registre des pages */
  const chemin = path.join(racine, 'blog', 'articles.json');
  const registre = fs.readFileSync(chemin, 'utf8');
  const bloc = registre.match(/("pages": \{\n)([\s\S]*?)(\n\s*\})/);
  if (!bloc) throw new Error('bloc « site.pages » introuvable dans blog/articles.json');
  const lignes = bloc[2].split('\n');
  const retrait = lignes[0].match(/^\s*/)[0];
  const entrees = lignes.map((l) => l.replace(/,\s*$/, '')).concat(`${retrait}"${fichier}": null`)
    .sort((a, b) => a.trim().localeCompare(b.trim()));
  const nouveau = registre.replace(bloc[0], `${bloc[1]}${entrees.join(',\n')}${bloc[3]}`);
  JSON.parse(nouveau);

  /* Page */
  const page = fs.readFileSync(path.join(racine, 'gabarit', 'page.html'), 'utf8')
    .replaceAll('{{FICHIER}}', fichier)
    .replaceAll('{{TITRE}}', echapper(titre.trim()))
    .replaceAll('{{DESCRIPTION}}', echapper(description.trim()));
  fs.writeFileSync(cible, page);
  fs.writeFileSync(chemin, nouveau);

  /* Zones générées */
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'generate-blog.js')], { env: { ...process.env, BLOG_RACINE: racine }, stdio: 'pipe' });
  } catch (e) {
    fs.rmSync(cible);
    fs.writeFileSync(chemin, registre);
    throw new Error(`générateur en échec, rien n'est créé :\n${e.stderr || e.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [fichier, titre, description] = process.argv.slice(2);
  try {
    creerPage(RACINE, fichier, titre, description);
    console.log(`  ${fichier} créée, en noindex : à ajouter au sitemap et à passer en index à la mise en ligne.`);
  } catch (e) { echouer(e.message); }
}
