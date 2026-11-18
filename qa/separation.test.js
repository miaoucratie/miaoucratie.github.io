/* Harnais et pages séparés */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerFichiers } from './separation.mjs';

test('harnais seul ou site seul : accepté', () => {
  assert.equal(classerFichiers(['qa/css.mjs', '.github/workflows/qa.yml', 'package.json']).melange, false);
  assert.equal(classerFichiers(['index.html', 'css/couches.css', 'qa/reference.json']).melange, false);
});

test('harnais et site dans la même PR : refusé', () => {
  const r = classerFichiers(['qa/mise-en-page.mjs', 'carte.html']);
  assert.equal(r.melange, true);
  assert.deepEqual([r.harnais, r.site], [['qa/mise-en-page.mjs'], ['carte.html']]);
});

test('la référence de l\'empreinte suit les pages', () => {
  assert.deepEqual(classerFichiers(['qa/reference.json']).harnais, []);
});
