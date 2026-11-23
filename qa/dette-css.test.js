/* Relevé du CSS mort */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEVE, classer, recopiees, empreinteDePage } from './dette-css-regles.mjs';

let navigateur;
before(async () => { navigateur = await chromium.launch(); });
after(async () => { await navigateur.close(); });

/* Relevé d'une page d'essai */
async function relever(css, html, agir) {
  const page = await navigateur.newPage();
  await page.setContent(`<style data-feuille="essai.css">${css}</style><body>${html}</body>`);
  const mesures = [await page.evaluate(RELEVE, [])];
  if (agir) { await page.evaluate(agir); mesures.push(await page.evaluate(RELEVE, [])); }
  await page.close();
  return classer(mesures);
}
const cle = (sel, prop) => `essai.css | ${sel} | ${prop}`;

test('une déclaration qui change le rendu est utile', async () => {
  const r = await relever('.a { color: red; }', '<p class="a">x</p>');
  assert.ok(r.utiles.has(cle('.a', 'color')));
});

test('une déclaration toujours écrasée est relevée', async () => {
  const r = await relever('.a { color: red; } .a.b { color: blue; }', '<p class="a b">x</p>');
  assert.deepEqual(r.sansEffet, [cle('.a', 'color')]);
});

test('une déclaration qui répète la valeur héritée est relevée', async () => {
  const r = await relever('body { color: red; } .a { color: red; }', '<p class="a">x</p>');
  assert.deepEqual(r.sansEffet, [cle('.a', 'color')]);
});

test('une déclaration animée par une transition reste utile', async () => {
  const r = await relever('.a { color: red; transition: color 2s; }', '<p class="a">x</p>');
  assert.ok(r.utiles.has(cle('.a', 'color')));
});

test('une règle sur * et ses pseudo-éléments vise bien les éléments', async () => {
  const r = await relever('*, ::before, ::after { box-sizing: border-box; }', '<p>x</p>');
  assert.ok(r.utiles.has(cle('*, ::before, ::after', 'box-sizing')));
});

test('un pseudo-élément propre au navigateur est mis hors mesure, avec sa raison', async () => {
  const r = await relever('.a::-webkit-scrollbar { display: none; }', '<div class="a">x</div>');
  assert.equal(r.vues.size, 0);
  assert.deepEqual(r.exclues, [`${cle('.a::-webkit-scrollbar', 'display')} | pseudo-élément propre au navigateur, non mesurable`]);
});

test('une négation de focus garde sa cible', async () => {
  const r = await relever('.s:not(:focus):not(:active) { position: absolute; }', '<a class="s" href="#x">x</a>');
  assert.ok(r.utiles.has(cle('.s:not(:focus):not(:active)', 'position')));
});

test('une règle qui ne vise rien est relevée', async () => {
  const r = await relever('.zz { color: red; }', '<p>x</p>');
  assert.deepEqual(r.jamais, [cle('.zz', 'color')]);
});

test('une règle utile dans un seul état ne l\'est pas', async () => {
  const r = await relever('.a.open { color: red; }', '<p class="a">x</p>', () => document.querySelector('.a').classList.add('open'));
  assert.deepEqual([r.jamais, r.sansEffet], [[], []]);
  assert.ok(r.utiles.has(cle('.a.open', 'color')));
});

test('une déclaration abrégée compte pour une seule', async () => {
  const r = await relever('.a { background: #fff; } .b { margin: 0; }', '<p class="a">x</p><div class="b">y</div>');
  assert.ok(r.utiles.has(cle('.a', 'background')));
  assert.deepEqual(r.sansEffet, [cle('.b', 'margin')]);
  assert.equal(r.vues.size, 2);
});

test('une règle d\'un @media inactif ne vise rien', async () => {
  const r = await relever('@media (max-width: 1px) { .a { color: red; } }', '<p class="a">x</p>');
  assert.deepEqual(r.jamais, [cle('@media (max-width: 1px) { .a', 'color')]);
});

test('règle recopiée : seulement si les deux feuilles sont chargées ensemble', () => {
  const sources = new Map([['a.css', '.x { color: red; }'], ['b.css', '.x { color: red; }']]);
  assert.equal(recopiees(sources, [['a.css', 'b.css']]).length, 1);
  assert.deepEqual(recopiees(sources, [['a.css'], ['b.css']]), []);
  assert.deepEqual(recopiees(new Map([['a.css', '.x { color: red; }'], ['b.css', '.x { color: blue; }']]), [['a.css', 'b.css']]), []);
});

test('une déclaration est lue telle qu\'écrite, même quand le navigateur la découpe', async () => {
  const r = await relever('.a { border: 0; border-bottom: 1px solid red; }', '<button class="a">x</button>');
  assert.deepEqual([...r.vues].sort(), [cle('.a', 'border'), cle('.a', 'border-bottom')]);
  assert.ok(r.utiles.has(cle('.a', 'border')) && r.utiles.has(cle('.a', 'border-bottom')));
});

test('white-space se mesure sur toutes ses sous-propriétés', async () => {
  const r = await relever('.a { white-space: nowrap; }', '<p class="a">x</p>');
  assert.ok(r.utiles.has(cle('.a', 'white-space')));
});

test('une liste qui mêle éléments et pseudo-éléments se mesure sur les deux', async () => {
  const r = await relever('*, *::before { margin: 0; }', '<p>x</p>');
  assert.ok(r.utiles.has(cle('*, ::before', 'margin')));
});

test('un préfixe de secours écrit avec la propriété standard est mis hors mesure', async () => {
  const r = await relever('.a { -webkit-mask-image: none; mask-image: none; color: red; }', '<p class="a">x</p>');
  assert.ok(r.exclues.includes(`${cle('.a', '-webkit-mask-image')} | préfixe de secours pour un autre navigateur`));
});

test('le repli d’une règle @supports est mis hors mesure, avec sa condition', async () => {
  const r = await relever('.a { display: flex; color: red; } @supports (display: grid) { .a { display: grid; } }', '<p class="a">x</p>');
  assert.ok(r.exclues.includes(`${cle('.a', 'display')} | repli pour les navigateurs sans « (display: grid) »`));
});

test('une propriété animée par une transition se mesure à sa valeur finale', async () => {
  const r = await relever('.a { transition: color 1s; } .a:not(.z) { color: red; }', '<p class="a">x</p>');
  assert.ok(r.utiles.has(cle('.a:not(.z)', 'color')));
});

test('un retrait rend la main aux lignes précédentes de la règle', async () => {
  const r = await relever('.a { color: white; border: 3px solid red; border-top-color: white; }', '<p class="a">x</p>');
  assert.ok(r.utiles.has(cle('.a', 'border-top-color')));
});

test('une propriété standard se juge avec son préfixe de secours', async () => {
  const r = await relever('.a { -webkit-mask-image: linear-gradient(red, transparent); mask-image: linear-gradient(red, transparent); }', '<p class="a">x</p>');
  assert.ok(r.utiles.has(cle('.a', 'mask-image')));
});

test('une règle ajoutée par un script est mise hors mesure', async () => {
  const r = await relever('.a { color: red; }', '<p class="a">x</p>', () => document.styleSheets[0].insertRule('.a { margin-top: 3px; }', 1));
  assert.ok(r.exclues.includes(`${cle('.a', 'margin-top')} | règle ajoutée par un script, absente du fichier`));
  assert.ok(r.utiles.has(cle('.a', 'color')));
});

test('une taille de police presque égale se voit à la hauteur de ligne', async () => {
  const r = await relever('.p { font-size: 12.99996px; } .a { font-size: 13px; line-height: 1.5; }', '<div class="p"><p class="a">x</p></div>');
  assert.ok(r.utiles.has(cle('.a', 'font-size')));
});

test('une déclaration écrasée dans sa propre règle est relevée', async () => {
  const r = await relever('.a { color: red; margin-top: 1px; margin: 0; }', '<p class="a">x</p>');
  assert.deepEqual(r.sansEffet, [cle('.a', 'margin-top')]);
});

test('une propriété inconnue du navigateur est mise hors mesure, avec sa raison', async () => {
  const r = await relever('.a { -moz-osx-font-smoothing: grayscale; color: red; }', '<p class="a">x</p>');
  assert.deepEqual(r.exclues, [`${cle('.a', '-moz-osx-font-smoothing')} | propriété inconnue de ce navigateur`]);
});

/* Empreinte d'une page */
const siteEssai = () => {
  const r = mkdtempSync(join(tmpdir(), 'empreinte-'));
  mkdirSync(join(r, 'css'));
  mkdirSync(join(r, 'qa'));
  writeFileSync(join(r, 'a.html'), '<link href="css/a.css"><a href="b.html">b</a><a href="/">accueil</a>');
  writeFileSync(join(r, 'b.html'), '<link href="css/b.css">');
  writeFileSync(join(r, 'css', 'a.css'), '.a { color: red; }');
  writeFileSync(join(r, 'css', 'b.css'), '.b { color: red; }');
  writeFileSync(join(r, 'qa', 'etats.mjs'), '// états');
  return r;
};

test('une page change d\'empreinte quand une feuille qu\'elle charge change', () => {
  const r = siteEssai();
  const avant = empreinteDePage(r, 'a.html');
  writeFileSync(join(r, 'css', 'a.css'), '.a { color: blue; }');
  assert.notEqual(empreinteDePage(r, 'a.html'), avant);
  rmSync(r, { recursive: true });
});

test('une page garde son empreinte quand une autre page ou sa feuille change', () => {
  const r = siteEssai();
  const avant = empreinteDePage(r, 'a.html');
  writeFileSync(join(r, 'b.html'), '<link href="css/b.css"><p>neuf</p>');
  writeFileSync(join(r, 'css', 'b.css'), '.b { color: blue; }');
  assert.equal(empreinteDePage(r, 'a.html'), avant);
  rmSync(r, { recursive: true });
});

test('toutes les pages changent d\'empreinte quand le harnais change', () => {
  const r = siteEssai();
  const avant = [empreinteDePage(r, 'a.html'), empreinteDePage(r, 'b.html')];
  writeFileSync(join(r, 'qa', 'etats.mjs'), '// états modifiés');
  assert.notEqual(empreinteDePage(r, 'a.html'), avant[0]);
  assert.notEqual(empreinteDePage(r, 'b.html'), avant[1]);
  rmSync(r, { recursive: true });
});
