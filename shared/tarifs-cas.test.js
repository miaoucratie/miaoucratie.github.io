/**
 * Table de cas de shared/tarifs.js, construite à partir des règles publiées
 * (tarifs.html, faq.html, calculateur) :
 * - visite : 18 € pour 1 ou 2 chats, 22 € pour 3, 26 € pour 4, 29 € pour 5 ; au-delà, sur devis ;
 * - 1 € de moins par visite dès 7 visites consécutives ;
 * - 1 € de moins par visite pour le tarif solidaire ;
 * - du 21 juillet au 31 août, une seule remise ; le reste de l'année, les deux se cumulent ;
 * - au-delà de 20 km : 0,70 € par km, aller-retour, à chaque visite ;
 * - acompte de 30 %.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import './tarifs.js';

const { estimerSejour } = globalThis.MiaouTarifs;

const PRIX_PUBLIE = { 1: 18, 2: 18, 3: 22, 4: 26, 5: 29 };

function centimes(montant) {
  return Math.round(montant * 100) / 100;
}

function attendu({ chats, visites, solidaire, periode, km }) {
  const prix = PRIX_PUBLIE[chats];
  const sejourLong = visites >= 7;
  const nombreRemises = (sejourLong ? 1 : 0) + (solidaire ? 1 : 0);
  const remises = periode ? Math.min(nombreRemises, 1) : nombreRemises;
  const deplacement = km * 2 * 0.7 * visites;
  const total = centimes((prix - remises) * visites + deplacement);
  const acompte = centimes(total * 0.3);
  return { total, acompte, solde: centimes(total - acompte), deplacement: centimes(deplacement) };
}

describe('table croisée des règles publiées', () => {
  for (const chats of [1, 2, 3, 4, 5]) {
    for (const visites of [1, 2, 6, 7, 8, 14, 30]) {
      for (const solidaire of [false, true]) {
        for (const periode of [false, true]) {
          for (const km of [0, 1, 2.5, 5, 25]) {
            const cas = { chats, visites, solidaire, periode, km };
            test(JSON.stringify(cas), () => {
              const e = estimerSejour(cas);
              const a = attendu(cas);
              assert.equal(e.total, a.total);
              assert.equal(e.acompte, a.acompte);
              assert.equal(e.solde, a.solde);
              assert.equal(e.supplementKm, a.deplacement);
              assert.equal(e.remiseSejour + e.remiseSolidaire, PRIX_PUBLIE[chats] - e.tarifNet);
            });
          }
        }
      }
    }
  }
});

describe('cas calculés à la main', () => {
  const cas = [
    // [paramètres, total, détail]
    [{ chats: 2, visites: 4 }, 72, '4 × 18'],
    [{ chats: 1, visites: 7 }, 119, '7 × 17, séjour long'],
    [{ chats: 1, visites: 4, solidaire: true }, 68, '4 × 17, solidaire'],
    [{ chats: 2, visites: 10, solidaire: true }, 160, '10 × 16, les deux remises'],
    [{ chats: 2, visites: 10, solidaire: true, periode: true }, 170, '10 × 17, une seule remise en été'],
    [{ chats: 2, visites: 6, solidaire: true, periode: true }, 102, '6 × 17, solidaire seule en été'],
    [{ chats: 1, visites: 6, periode: true }, 108, '6 × 18, période sans remise'],
    [{ chats: 3, visites: 10, solidaire: true, km: 5 }, 270, '10 × 20 + 5 × 2 × 0,70 × 10'],
    [{ chats: 4, visites: 3, km: 25 }, 183, '3 × 26 + 25 × 2 × 0,70 × 3'],
    [{ chats: 5, visites: 14, solidaire: true, periode: true }, 392, '14 × 28'],
    [{ chats: 5, visites: 14, solidaire: true }, 378, '14 × 27'],
    [{ chats: 1, visites: 1, km: 2.5 }, 21.5, '18 + 2,5 × 2 × 0,70'],
  ];
  for (const [parametres, total, detail] of cas) {
    test(detail, () => {
      assert.equal(estimerSejour(parametres).total, total);
    });
  }
});

describe('saisies hors normes', () => {
  test('zéro, négatif ou vide : une visite, un chat, aucun kilomètre', () => {
    for (const e of [
      estimerSejour({ chats: 0, visites: 0, km: -3 }),
      estimerSejour({ chats: 'x', visites: 'y', km: 'z' }),
      estimerSejour(),
    ]) {
      assert.equal(e.visites, 1);
      assert.equal(e.base, 18);
      assert.equal(e.supplementKm, 0);
      assert.equal(e.total, 18);
    }
  });

  test("un nombre de visites décimal est arrondi à l'entier inférieur", () => {
    assert.equal(estimerSejour({ visites: 6.9 }).visites, 6);
    assert.equal(estimerSejour({ visites: 6.9 }).remiseSejour, 0);
  });

  test('au-delà de 5 chats, tout est sur devis, sans aucun montant', () => {
    for (const chats of [6, 7, 10, 25]) {
      for (const options of [{}, { visites: 10, solidaire: true, periode: true, km: 5 }]) {
        const e = estimerSejour({ chats, ...options });
        assert.equal(e.surDevis, true);
        assert.equal(e.total, undefined);
        assert.equal(e.base, undefined);
      }
    }
  });

  test("jusqu'à 5 chats, jamais sur devis", () => {
    for (const chats of [1, 2, 3, 4, 5]) assert.equal(estimerSejour({ chats }).surDevis, false);
  });
});
