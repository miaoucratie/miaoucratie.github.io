/* Relevé du CSS mort */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { RELEVE, classer, recopiees } from './dette-css-regles.mjs';

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
