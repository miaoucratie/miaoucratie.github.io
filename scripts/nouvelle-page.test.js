/* Page neuve depuis le gabarit */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerPage } from './nouvelle-page.js';

const DEPOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const copie = () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'page-neuve-'));
  fs.cpSync(DEPOT, racine, { recursive: true, filter: (s) => !/[/\\](node_modules|\.git|images|fonts|presse)$/.test(s) });
  return racine;
};

test('la page neuve a la barre, le pied de page et les feuilles communes, et entre au registre', () => {
  const racine = copie();
  creerPage(racine, 'essai-gabarit.html', 'Titre « essai » & co', 'Une description.');
  const page = fs.readFileSync(path.join(racine, 'essai-gabarit.html'), 'utf8');
  assert.match(page, /<header class="topbar">/);
  assert.match(page, /<footer class="footer-bar">/);
  for (const f of ['polices', 'style', 'article', 'couches']) assert.ok(page.includes(`href="css/${f}.css"`), f);
  assert.match(page, /<title>Titre « essai » &amp; co \| Miaoucratie<\/title>/);
  assert.match(page, /<meta name="robots" content="noindex,follow">/);
  assert.doesNotMatch(page, /\{\{/);
  const registre = JSON.parse(fs.readFileSync(path.join(racine, 'blog', 'articles.json'), 'utf8'));
  assert.equal(registre.site.pages['essai-gabarit.html'], null);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('un nom de fichier invalide ou déjà pris est refusé, sans rien écrire', () => {
  const racine = copie();
  const registre = fs.readFileSync(path.join(racine, 'blog', 'articles.json'), 'utf8');
  assert.throws(() => creerPage(racine, 'Essai.html', 'T', 'D'), /refusé/);
  assert.throws(() => creerPage(racine, 'maquette-x.html', 'T', 'D'), /refusé/);
  assert.throws(() => creerPage(racine, 'tarifs.html', 'T', 'D'), /existe déjà/);
  assert.throws(() => creerPage(racine, 'essai.html', ' ', 'D'), /obligatoires/);
  assert.equal(fs.readFileSync(path.join(racine, 'blog', 'articles.json'), 'utf8'), registre);
  fs.rmSync(racine, { recursive: true, force: true });
});
