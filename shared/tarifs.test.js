/**
 * Tests de shared/tarifs.js.
 *
 * Le calculateur est la seule des cinq pages sans parcours qui porte un
 * calcul. Un tarif faux n'y deplace aucun pixel et ne casse aucun clic : il
 * passait donc la QA sans un mot, et se serait vu en devis.
 *
 * Fonctions pures, sans DOM ni reseau : node --test suffit.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FRAIS_KM_EUR,
  TAUX_ACOMPTE,
  SEUIL_SEJOUR_LONG,
  arrondirCentimes,
  estimerSejour,
  formatEuros,
  tarifVisite,
} from './tarifs.js';

describe('tarif d une visite', () => {
  test('un et deux chats partagent le meme tarif', () => {
    assert.equal(tarifVisite(1), 18);
    assert.equal(tarifVisite(2), 18);
  });

  test('trois et quatre chats ont chacun leur palier', () => {
    assert.equal(tarifVisite(3), 22);
    assert.equal(tarifVisite(4), 26);
  });

  test('le tarif plafonne a cinq chats et ne bouge plus au-dela', () => {
    assert.equal(tarifVisite(5), 29);
    assert.equal(tarifVisite(6), 29);
    assert.equal(tarifVisite(10), 29);
  });

  test('une saisie absurde retombe sur le premier palier plutot que sur NaN', () => {
    assert.equal(tarifVisite(0), 18);
    assert.equal(tarifVisite(-3), 18);
    assert.equal(tarifVisite('bonjour'), 18);
  });
});

describe('estimation sans remise ni deplacement', () => {
  test('deux chats, trois visites', () => {
    const e = estimerSejour({ chats: 2, visites: 3 });
    assert.equal(e.base, 18);
    assert.equal(e.tarifNet, 18);
    assert.equal(e.total, 54);
    assert.equal(e.supplementKm, 0);
  });

  test('les valeurs par defaut donnent une visite pour un chat', () => {
    assert.equal(estimerSejour().total, 18);
  });
});

describe('remises', () => {
  test('la remise sejour long s applique a partir du seuil, pas avant', () => {
    assert.equal(estimerSejour({ visites: SEUIL_SEJOUR_LONG - 1 }).remiseSejour, 0);
    assert.equal(estimerSejour({ visites: SEUIL_SEJOUR_LONG }).remiseSejour, 1);
  });

  test('la remise sejour long retire un euro par visite', () => {
    const sans = estimerSejour({ visites: 6 }).total;
    const avec = estimerSejour({ visites: 7 }).total;
    // Six visites a 18, sept a 17 : le sejour plus long coute 11 de plus.
    assert.equal(sans, 108);
    assert.equal(avec, 119);
  });

  test('la remise solidaire retire un euro par visite', () => {
    const e = estimerSejour({ visites: 4, solidaire: true });
    assert.equal(e.remiseSolidaire, 1);
    assert.equal(e.tarifNet, 17);
    assert.equal(e.total, 68);
  });

  test('les deux remises se cumulent hors periode de forte demande', () => {
    const e = estimerSejour({ visites: 7, solidaire: true });
    assert.equal(e.tarifNet, 16);
    assert.equal(e.total, 112);
    assert.equal(e.cumulBloque, false);
  });

  test('en periode de forte demande la remise solidaire tombe, et le dit', () => {
    const e = estimerSejour({ visites: 4, solidaire: true, periode: true });
    assert.equal(e.remiseSolidaire, 0);
    assert.equal(e.cumulBloque, true);
    assert.equal(e.total, 72);
  });

  test('la periode de forte demande seule ne change rien', () => {
    assert.equal(estimerSejour({ visites: 4, periode: true }).total, 72);
    assert.equal(estimerSejour({ visites: 4, periode: true }).cumulBloque, false);
  });
});

describe('supplement kilometrique', () => {
  test('il compte l aller-retour, a chaque visite', () => {
    const e = estimerSejour({ visites: 3, km: 10 });
    assert.equal(e.supplementKm, 10 * 2 * FRAIS_KM_EUR * 3);
    assert.equal(e.supplementKm, 42);
    assert.equal(e.total, 54 + 42);
  });

  test('une distance nulle ou negative n ajoute rien', () => {
    assert.equal(estimerSejour({ km: 0 }).supplementKm, 0);
    assert.equal(estimerSejour({ km: -5 }).supplementKm, 0);
  });

  test('un champ vide ne rend pas NaN', () => {
    const e = estimerSejour({ km: '' });
    assert.equal(e.supplementKm, 0);
    assert.ok(Number.isFinite(e.total));
  });
});

describe('acompte et solde', () => {
  test('l acompte est la part convenue du total', () => {
    const e = estimerSejour({ visites: 10 });
    assert.equal(e.total, 170);
    assert.equal(e.acompte, arrondirCentimes(170 * TAUX_ACOMPTE));
    assert.equal(e.acompte, 51);
  });

  test('acompte et solde recomposent exactement le total', () => {
    for (const visites of [1, 3, 7, 12, 30]) {
      for (const km of [0, 3, 7.5, 21]) {
        const e = estimerSejour({ chats: 3, visites, km, solidaire: true });
        assert.equal(
          arrondirCentimes(e.acompte + e.solde),
          e.total,
          `acompte + solde doivent redonner le total (${visites} visites, ${km} km)`,
        );
      }
    }
  });

  test('l acompte est calcule sur le total affiche, au centime pres', () => {
    // 2,5 km : le supplement tombe sur une demi-decimale, cas ou un calcul
    // mene sur le total non arrondi et l'affichage divergeraient d'un centime.
    const e = estimerSejour({ visites: 1, km: 2.5 });
    assert.equal(e.total, 21.5);
    assert.equal(e.acompte, 6.45);
    assert.equal(e.solde, 15.05);
  });
});

describe('affichage des montants', () => {
  test('deux decimales et une virgule', () => {
    assert.equal(formatEuros(18), '18,00 €');
    assert.equal(formatEuros(6.5), '6,50 €');
    assert.equal(formatEuros(0), '0,00 €');
  });
});
