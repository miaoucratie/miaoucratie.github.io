/* Zone d'intervention */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './zone.js';

const Z = globalThis.MiaouZone;
const R = Z.REGLES.standard;

test('règle standard', () => {
  assert.deepEqual([...R.origineSecours], [48.0572, -1.3365]);
  assert.deepEqual([R.inclusKm, R.souplesseKm, R.devisKm, R.coefficientRoute], [20, 21.5, 45, 1.35]);
  assert.ok(Object.isFrozen(R) && Object.isFrozen(R.origineSecours));
});

test('verdict aux bornes exactes', () => {
  const cas = [
    [0, 'inclus'], [19.99, 'inclus'], [20, 'inclus'], [20.01, 'souplesse'], [21.5, 'souplesse'],
    [21.51, 'devis'], [44.99, 'devis'], [45, 'devis'], [45.01, 'hors'], [200, 'hors'],
  ];
  for (const [km, attendu] of cas) assert.equal(Z.verdictDistance(km), attendu, `${km} km`);
});

test('distance : même point, symétrie, ordre de grandeur', () => {
  assert.equal(Z.distanceKm([48, -1.3], [48, -1.3]), 0);
  const a = [48.0572, -1.3365];
  const b = [48.1173, -1.6778];
  assert.equal(Z.distanceKm(a, b), Z.distanceKm(b, a));
  assert.ok(Math.abs(Z.distanceKm(a, b) - 26.2) < 0.5, String(Z.distanceKm(a, b)));
  assert.equal(Z.distanceRouteKm(a, b), Z.distanceKm(a, b) * 1.35);
});

test('département : code, code postal ou département', () => {
  assert.equal(Z.dansDepartement({ departement: '35' }), true);
  assert.equal(Z.dansDepartement({ code: '35096' }), true);
  assert.equal(Z.dansDepartement({ postal: '35113' }), true);
  assert.equal(Z.dansDepartement({ departement: '53', code: '53130', postal: '53000' }), false);
  assert.equal(Z.dansDepartement({}), false);
});

test('Rennes exclue par nom, code ou code postal', () => {
  assert.equal(Z.communeExclue({ nomNormalise: 'rennes' }), true);
  assert.equal(Z.communeExclue({ nomNormalise: 'chantepie', code: '35000' }), true);
  assert.equal(Z.communeExclue({ nomNormalise: 'chantepie', postal: '35000' }), true);
  assert.equal(Z.communeExclue({ nomNormalise: 'domagne', code: '35096', postal: '35113' }), false);
});
