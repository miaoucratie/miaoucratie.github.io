/* Relevé du HTML mort */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { analyser, VIDES } from './dette-html.mjs';

const relever = (html, { css = '', js = '' } = {}) => analyser(
  new Map([['p.html', html]]), new Map([['f.css', css]]), new Map([['js/s.js', js]]),
).map((c) => c.split(' | ').slice(1).join(' | '));

test('un identifiant que rien ne vise est relevé', () => {
  assert.deepEqual(relever('<main id="contenu">x</main>'), ['identifiant que rien ne vise | <main id="contenu">']);
});

test('un identifiant visé par un lien, une étiquette, l\'accessibilité, le CSS ou un script ne l\'est pas', () => {
  assert.deepEqual(relever('<a href="#a">x</a><p id="a">y</p>'), []);
  assert.deepEqual(relever('<label for="b">x</label><input id="b">'), []);
  assert.deepEqual(relever('<div aria-labelledby="t c"><p id="t">x</p><p id="c">y</p></div>'), []);
  assert.deepEqual(relever('<p id="d">x</p>', { css: '#d { color: red; }' }), []);
  assert.deepEqual(relever('<p id="e">x</p>', { js: "document.getElementById('e');" }), []);
  assert.deepEqual(relever('<p id="nom-error">x</p>', { js: 'document.getElementById(`${champ}-error`);' }), []);
});

test('un identifiant de section, de figure ou de titre reste, comme adresse de partage', () => {
  assert.deepEqual(relever('<section id="s">x</section><figure id="f">y</figure><h2 id="h">z</h2>'), []);
});

test('les attributs sans effet sont relevés', () => {
  assert.deepEqual(relever('<p class="">x</p><script type="text/javascript"></script><nav role="navigation">y</nav>'), [
    'attribut sans effet | <nav role="navigation">',
    'attribut sans effet | <p class="">',
    'attribut sans effet | <script type="text/javascript">',
  ]);
});

test('un script sans rien à faire sur la page est relevé, pas un script qui fabrique son contenu', () => {
  const page = '<p class="present">x</p><script src="js/s.js"></script>';
  assert.deepEqual(relever(page, { js: "document.getElementById('absent');" }), ['script sans usage | js/s.js']);
  assert.deepEqual(relever(page, { js: "document.querySelector('.present');" }), []);
  assert.deepEqual(relever(page, { js: "document.querySelector('#absent'); document.body.append(document.createElement('div'));" }), []);
});

test('un élément vide qui ne dessine rien est relevé, pas un élément vide dessiné par le CSS', async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage();
  await page.setContent('<style>.g{display:grid;grid-template-columns:1fr auto} .c i{display:block;width:10px;height:10px;background:#000}</style><div class="g"><b>x</b><span></span></div><div class="c"><i></i></div>');
  assert.deepEqual(await page.evaluate(VIDES), ['<span></span>']);
  await navigateur.close();
});
