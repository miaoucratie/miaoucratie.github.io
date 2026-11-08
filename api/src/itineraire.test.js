/**
 * Tests de l'itinéraire de l'appli Indisponibilités.
 *
 * Les services de cartes sont remplacés par des réponses fixes : aucun appel
 * réseau, aucune attente d'une seconde entre deux adresses.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ETAPES_MAX,
  ErreurAdresse,
  ErreurTrajet,
  boucle,
  erreurEtapes,
  meilleurOrdre,
  plusCourteBoucle,
  variantesAdresse,
  viderCacheItineraire,
} from './itineraire.js';

const sansAttente = async () => {};

/** Distance totale d'un ordre donné, pour comparer à la recherche exacte. */
function longueur(matrice, ordre) {
  const chemin = [0, ...ordre, matrice.length - 1];
  let total = 0;
  for (let i = 0; i < chemin.length - 1; i += 1) total += matrice[chemin[i]][chemin[i + 1]];
  return total;
}

function* permutations(liste) {
  if (liste.length <= 1) { yield liste; return; }
  for (let i = 0; i < liste.length; i += 1) {
    for (const reste of permutations([...liste.slice(0, i), ...liste.slice(i + 1)])) {
      yield [liste[i], ...reste];
    }
  }
}

/** Matrice non symétrique, comme des distances routières réelles. */
function matriceAleatoire(points, graine) {
  let x = graine;
  const hasard = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const coords = Array.from({ length: points }, () => [hasard() * 40, hasard() * 40]);
  coords[points - 1] = coords[0];
  return coords.map((a) => coords.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * (1 + hasard() * 0.3)));
}

/**
 * Faux services : chaque adresse connue a une position, les distances sont
 * celles d'une grille. Les requêtes reçues sont conservées.
 */
function fauxServices({ connues = {}, ban = {}, codesPostaux = {}, refuser = [] }) {
  const requetes = [];
  const lire = async (url) => {
    requetes.push(url);
    const u = new URL(url);
    if (u.hostname.includes('geopf')) {
      const trouve = ban[u.searchParams.get('q')];
      return Response.json({
        features: trouve ? [{
          geometry: { coordinates: [trouve.point[1], trouve.point[0]] },
          properties: { type: trouve.type, score: trouve.score, postcode: trouve.postcode, street: trouve.street, name: trouve.street },
        }] : [],
      });
    }
    if (u.hostname.includes('nominatim')) {
      const q = u.searchParams.get('q');
      if (refuser.includes(q)) throw new Error('réseau');
      const point = connues[q];
      const address = codesPostaux[q] ? { postcode: codesPostaux[q] } : undefined;
      return Response.json(point ? [{ lat: String(point[0]), lon: String(point[1]), address }] : []);
    }
    const coords = u.pathname.split('/').at(-1).split(';').map((c) => c.split(',').map(Number));
    const dist = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) * 1000;
    if (u.pathname.startsWith('/table/')) {
      return Response.json({ code: 'Ok', distances: coords.map((a) => coords.map((b) => dist(a, b))) });
    }
    let total = 0;
    for (let i = 0; i < coords.length - 1; i += 1) total += dist(coords[i], coords[i + 1]);
    return Response.json({ code: 'Ok', routes: [{ distance: total, duration: total / 10 }] });
  };
  return { lire, requetes, attendre: sansAttente };
}

beforeEach(() => viderCacheItineraire());

describe('meilleur ordre de passage', () => {
  test('la recherche exacte trouve la même distance que l essai de tous les ordres', () => {
    for (let etapes = 1; etapes <= 7; etapes += 1) {
      for (let graine = 1; graine <= 5; graine += 1) {
        const matrice = matriceAleatoire(etapes + 2, graine * 7919 + etapes);
        const { ordre, distance } = plusCourteBoucle(matrice);
        let meilleure = Infinity;
        for (const p of permutations(Array.from({ length: etapes }, (_, i) => i + 1))) {
          meilleure = Math.min(meilleure, longueur(matrice, p));
        }
        assert.ok(Math.abs(distance - meilleure) < 1e-9, `${etapes} étapes, graine ${graine}`);
        assert.ok(Math.abs(longueur(matrice, ordre) - distance) < 1e-9);
        assert.deepEqual([...ordre].sort((a, b) => a - b), Array.from({ length: etapes }, (_, i) => i + 1));
      }
    }
  });

  test('dix étapes se calculent sans délai notable', () => {
    const debut = performance.now();
    plusCourteBoucle(matriceAleatoire(ETAPES_MAX + 2, 42));
    assert.ok(performance.now() - debut < 200);
  });

  test('l ordre est rendu avec les adresses, départ fourni par le serveur', async () => {
    const services = fauxServices({
      connues: { Maison: [0, 0], 'Loin, Ville': [0, 9], 'Près, Ville': [0, 2], 'Milieu, Ville': [0, 5] },
    });
    const resultat = await meilleurOrdre('Maison', ['Loin, Ville', 'Près, Ville', 'Milieu, Ville'], services);
    assert.equal(resultat.homeAddress, 'Maison');
    assert.equal(resultat.totalDistanceKm, 18);
    // Aller dans un sens ou dans l'autre fait la même distance : les deux sont justes.
    const sens = ['Près, Ville', 'Milieu, Ville', 'Loin, Ville'];
    assert.ok(
      [sens.join('|'), [...sens].reverse().join('|')].includes(resultat.orderedAddresses.join('|')),
      resultat.orderedAddresses.join(' > '),
    );
  });
});

describe('distance de la boucle', () => {
  test('la boucle part et revient au départ, dans l ordre donné', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0], 'A, Ville': [0, 3], 'B, Ville': [4, 3] } });
    const resultat = await boucle('Maison', ['A, Ville', 'B, Ville'], services);
    assert.deepEqual(resultat, { totalDistanceKm: 14, totalDurationMin: 14000 / 10 / 60 });
  });

  test('le départ n est situé qu une fois', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0], 'A, Ville': [0, 3] } });
    await boucle('Maison', ['A, Ville'], services);
    const recherches = services.requetes.filter((u) => u.includes('nominatim'));
    assert.equal(recherches.length, 2);
  });
});

describe('adresses', () => {
  test('une adresse avec « Rés » est retentée sans le numéro', () => {
    assert.deepEqual(variantesAdresse('6 Rés les Jardins, 35500 Vitré, France'), [
      '6 Rés les Jardins, 35500 Vitré, France',
      'les Jardins, 35500 Vitré, France',
      '35500 Vitré, France',
    ]);
  });

  test('la variante trouvée sert au calcul', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0], 'les Jardins, 35500 Vitré': [0, 1] } });
    const resultat = await boucle('Maison', ['6 Rés les Jardins, 35500 Vitré'], services);
    assert.equal(resultat.totalDistanceKm, 2);
  });

  test('une adresse introuvable est nommée dans l erreur', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0] } });
    await assert.rejects(boucle('Maison', ['Nulle part'], services), (erreur) => {
      assert.ok(erreur instanceof ErreurAdresse);
      assert.equal(erreur.adresse, 'Nulle part');
      assert.equal(erreur.message, 'Adresse introuvable.');
      return true;
    });
  });

  test('un service de géocodage injoignable est distingué d une adresse introuvable', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0] }, refuser: ['Rue X'] });
    await assert.rejects(boucle('Maison', ['Rue X'], services), { message: 'Service de géocodage injoignable.' });
  });
});

describe('base adresse nationale', () => {
  const MAISON = { Maison: [0, 0] };

  test('un numéro trouvé avec le bon code postal est retenu, sans passer par Nominatim', async () => {
    const services = fauxServices({
      connues: MAISON,
      ban: { '8 Chem. des Lilas, 35000 Rennes': { point: [0, 4], type: 'housenumber', score: 0.68, postcode: '35000' } },
    });
    const resultat = await boucle('Maison', ['8 Chem. des Lilas, 35000 Rennes'], services);
    assert.equal(resultat.totalDistanceKm, 8);
    assert.ok(!services.requetes.some((u) => u.includes('nominatim') && u.includes('Lilas')));
  });

  test('un numéro trouvé dans une autre commune est écarté', async () => {
    const services = fauxServices({
      connues: { ...MAISON, '12 Pl. de l Église, 35000 Saint-Martin': [0, 6] },
      ban: { '12 Pl. de l Église, 35000 Saint-Martin': { point: [0, 400], type: 'housenumber', score: 0.9, postcode: '21210' } },
    });
    const resultat = await boucle('Maison', ['12 Pl. de l Église, 35000 Saint-Martin'], services);
    assert.equal(resultat.totalDistanceKm, 12);
  });

  test('une rue au nom différent de celle demandée est écartée', async () => {
    const services = fauxServices({
      connues: { ...MAISON, 'Centre, 35000 Rennes': [0, 5] },
      ban: { 'Centre, 35000 Rennes': { point: [0, 9], type: 'street', score: 0.43, postcode: '35000', street: 'Le Champ Fleuri' } },
    });
    const resultat = await boucle('Maison', ['Centre, 35000 Rennes'], services);
    assert.equal(resultat.totalDistanceKm, 10);
  });

  test('une rue dont tous les mots sont dans l adresse demandée est retenue', async () => {
    const services = fauxServices({
      connues: MAISON,
      ban: { 'All. des Peupliers, 35000 Rennes': { point: [0, 3], type: 'street', score: 0.52, postcode: '35000', street: 'Allée des Peupliers' } },
    });
    const resultat = await boucle('Maison', ['All. des Peupliers, 35000 Rennes'], services);
    assert.equal(resultat.totalDistanceKm, 6);
  });

  test('Nominatim en secours : un homonyme hors du code postal demandé est écarté', async () => {
    const services = fauxServices({
      connues: { ...MAISON, 'Mairie, 35000 Saint-Martin, France': [0, 400], '35000 Saint-Martin, France': [0, 6] },
      codesPostaux: { 'Mairie, 35000 Saint-Martin, France': '21210', '35000 Saint-Martin, France': '35000' },
    });
    const resultat = await boucle('Maison', ['Mairie, 35000 Saint-Martin, France'], services);
    assert.equal(resultat.totalDistanceKm, 12);
  });
});

describe('trajets', () => {
  test('chaque service reçoit un identifiant d application, sans quoi il refuse', async () => {
    const entetes = [];
    const services = fauxServices({ connues: { Maison: [0, 0], 'A, Ville': [0, 3] } });
    const lire = (url, options) => { entetes.push(options?.headers?.['User-Agent']); return services.lire(url); };
    await meilleurOrdre('Maison', ['A, Ville'], { lire, attendre: sansAttente });
    await boucle('Maison', ['A, Ville'], { lire, attendre: sansAttente });
    assert.ok(entetes.length >= 4);
    assert.ok(entetes.every((e) => typeof e === 'string' && e.startsWith('MiaoucratieIndisponibilites/')), String(entetes));
  });

  test('aucun trajet trouvé donne une erreur, jamais une distance estimée', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0], 'A, Ville': [0, 3] } });
    const lire = async (url) => (url.includes('nominatim')
      ? services.lire(url)
      : Response.json({ code: 'NoRoute' }));
    await assert.rejects(
      meilleurOrdre('Maison', ['A, Ville'], { lire, attendre: sansAttente }),
      (erreur) => erreur instanceof ErreurTrajet,
    );
  });

  test('un service de trajets injoignable est signalé', async () => {
    const services = fauxServices({ connues: { Maison: [0, 0], 'A, Ville': [0, 3] } });
    const lire = async (url) => (url.includes('nominatim')
      ? services.lire(url)
      : new Response('', { status: 503 }));
    await assert.rejects(
      boucle('Maison', ['A, Ville'], { lire, attendre: sansAttente }),
      { message: "Service de calcul d'itinéraire injoignable." },
    );
  });
});

describe('liste d étapes reçue', () => {
  test('vide, mal formée ou trop longue, elle est refusée avec un message clair', () => {
    assert.equal(erreurEtapes([]), 'Au moins une étape est requise.');
    assert.equal(erreurEtapes('Vitré'), 'Au moins une étape est requise.');
    assert.equal(erreurEtapes(['Vitré', '  ']), "Adresses d'étape invalides.");
    assert.equal(erreurEtapes(Array(ETAPES_MAX + 1).fill('Vitré')), 'Maximum 10 étapes par tournée.');
    assert.equal(erreurEtapes(Array(ETAPES_MAX).fill('Vitré')), null);
  });
});
