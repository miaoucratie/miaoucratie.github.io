/* Données de la FAQ */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { texteAffiche, questionsFaq, blocFaq } from '../scripts/faq.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const item = (q, r, attrs = '') => `<div class="acc-item"${attrs}>
<button class="acc-trigger"><span class="acc-question">${q}</span><span class="acc-icon"><svg><path d="M1"></path></svg></span></button>
<div class="acc-body">
<div class="acc-content">
${r}
</div>
</div>
</div>`;

test('texte lisible : balises, entités, espaces', () => {
  assert.equal(texteAffiche('<p>Une <strong>garde</strong>&nbsp;: oui.</p><p>Deux&#39;s &amp; trois</p>'), "Une garde : oui. Deux's & trois");
  assert.equal(texteAffiche('<ul><li>✓ un</li><li>✓ deux</li></ul>'), '✓ un ✓ deux');
  assert.equal(texteAffiche('ligne<br>suivante<br/>fin'), 'ligne suivante fin');
  assert.equal(texteAffiche('a<svg><path d="x"></path></svg>b'), 'ab');
  assert.equal(texteAffiche('<a href="x">lien</a>&nbsp;?'), 'lien ?');
});

test('questions et réponses, div imbriquées comprises', () => {
  const html = item('Q1&nbsp;?', '<p>R1</p>') + item('Q2', '<div class="encart"><p>R2a</p></div><p>R2b</p>', ' data-mots="x"');
  assert.deepEqual(questionsFaq(html), [
    { question: 'Q1 ?', reponse: 'R1' },
    { question: 'Q2', reponse: 'R2a R2b' },
  ]);
});

test('question sans réponse : erreur', () => {
  assert.throws(() => questionsFaq('<div class="acc-item"><span class="acc-question">Q</span></div>'), /sans intitulé ou sans réponse/);
  assert.throws(() => questionsFaq('<div class="acc-item"><span class="acc-question">Q</span>'), /mal fermée/);
});

test('le bloc de la page est celui que produit son accordéon', () => {
  const html = fs.readFileSync(path.join(RACINE, 'faq.html'), 'utf8');
  const zone = html.split('<!-- GENERATED:FAQ_JSONLD:START -->\n')[1].split('\n<!-- GENERATED:FAQ_JSONLD:END -->')[0];
  assert.equal(zone, blocFaq(html));
  const donnees = JSON.parse(zone.replace(/<\/?script[^>]*>/g, ''));
  assert.equal(donnees.mainEntity.length, (html.match(/<div class="acc-item"/g) || []).length);
});
