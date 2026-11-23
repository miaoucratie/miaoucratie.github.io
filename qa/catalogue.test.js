/* Catalogue des éléments */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifierCatalogue } from './catalogue.mjs';

const site = (feuilles) => {
  const r = mkdtempSync(join(tmpdir(), 'catalogue-'));
  mkdirSync(join(r, 'gabarit'));
  mkdirSync(join(r, 'css', 'pages'), { recursive: true });
  writeFileSync(join(r, 'gabarit', 'catalogue.html'), '<section data-element="pcard" data-feuilles="style.css">\n<h2>Carte</h2>\n<div class="pcard"></div>\n</section>');
  for (const [f, css] of Object.entries(feuilles)) writeFileSync(join(r, 'css', f), css);
  return r;
};

test('un élément stylé dans sa seule feuille est accepté', () => {
  const r = site({ 'style.css': '.pcard { padding: 8px; }', 'pages/x.css': '.pcarde { color: red; } /* .pcard */' });
  assert.deepEqual(verifierCatalogue(r), []);
  rmSync(r, { recursive: true });
});

test('un élément du catalogue recopié avec un style à part est refusé', () => {
  const r = site({ 'style.css': '.pcard { padding: 8px; }', 'pages/x.css': '.page .pcard h3 { color: red; }' });
  assert.deepEqual(verifierCatalogue(r), ['pcard : stylé aussi dans pages/x.css, alors que son style vit dans style.css']);
  rmSync(r, { recursive: true });
});

test('une feuille déclarée qui ne style plus l\'élément est signalée', () => {
  const r = site({ 'style.css': 'p { margin: 0; }' });
  assert.deepEqual(verifierCatalogue(r), ['pcard : style.css est déclarée mais ne le style plus, à retirer du catalogue']);
  rmSync(r, { recursive: true });
});
