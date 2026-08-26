/**
 * Tests de l'oracle de la QA.
 *
 * `memeElement` decide si deux relevés d'un même élément sont identiques.
 * C'est elle qui dit « regression » ou « rien a signaler » : si elle se met a
 * tout accepter, la QA passe au vert pour de mauvaises raisons et personne ne
 * le voit. Elle etait exportee depuis le debut sans qu'aucun test ne l'importe.
 *
 * Ce qui est verifie ici, c'est le contrat enonce dans qa.mjs :
 *  - les champs geometriques tolerent 2 px, parce que Windows et Linux
 *    n'arrondissent pas les metriques de police pareil ;
 *  - tous les autres sont compares au caractere pres ;
 *  - la tolerance ne s'applique jamais a deux valeurs de formes differentes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { controlerTauxMetier, memeElement } from './qa.mjs';

/**
 * Les relevés sont des chaines de 21 champs separes par des barres. Les ecrire
 * a la main rendrait chaque test illisible et masquerait l'indice teste, qui
 * est justement ce qui compte : c'est la position dans cette liste qui decide
 * si un champ tolere 2 px ou pas.
 */
const CHAMPS = [
  'tagName', 'className',
  'width', 'height', 'left', 'top',
  'color', 'backgroundColor',
  'fontSize', 'fontWeight', 'fontStyle', 'fontFamily',
  'display', 'borderRadius', 'padding', 'margin',
  'textAlign', 'opacity', 'visibility',
  'lineHeight', 'letterSpacing',
];

const BASE = {
  tagName: 'P', className: 'intro',
  width: '300', height: '40', left: '20', top: '100',
  color: 'rgb(30, 24, 18)', backgroundColor: 'rgba(0, 0, 0, 0)',
  fontSize: '16px', fontWeight: '400', fontStyle: 'normal', fontFamily: '"DM Sans"',
  display: 'block', borderRadius: '0px', padding: '4px 8px', margin: '0px',
  textAlign: 'left', opacity: '1', visibility: 'visible',
  lineHeight: '24px', letterSpacing: 'normal',
};

const releve = (modifications = {}) =>
  CHAMPS.map((champ) => ({ ...BASE, ...modifications }[champ])).join('|');

describe('identite', () => {
  test('deux releves identiques se valent', () => {
    assert.equal(memeElement(releve(), releve()), true);
  });

  test('la meme chaine se vaut elle-meme', () => {
    const r = releve();
    assert.equal(memeElement(r, r), true);
  });
});

describe('tolerance geometrique de 2 px', () => {
  test('un ecart de 1 px sur la largeur est accepte', () => {
    assert.equal(memeElement(releve(), releve({ width: '301' })), true);
  });

  test('un ecart de 2 px est accepte : c est la borne, elle est incluse', () => {
    assert.equal(memeElement(releve(), releve({ height: '42' })), true);
  });

  test('un ecart de 3 px est refuse', () => {
    assert.equal(memeElement(releve(), releve({ height: '43' })), false);
  });

  test('l ecart joue dans les deux sens', () => {
    assert.equal(memeElement(releve({ top: '97' }), releve()), false);
    assert.equal(memeElement(releve({ top: '99' }), releve()), true);
  });

  test('la tolerance vaut aussi pour la taille de police', () => {
    assert.equal(memeElement(releve(), releve({ fontSize: '17px' })), true);
    assert.equal(memeElement(releve(), releve({ fontSize: '20px' })), false);
  });

  test('la tolerance vaut aussi pour l interlignage et l interlettrage', () => {
    assert.equal(memeElement(releve(), releve({ lineHeight: '25px' })), true);
    assert.equal(memeElement(releve(), releve({ lineHeight: '30px' })), false);
    assert.equal(memeElement(releve(), releve({ letterSpacing: '0.5px' })), false,
      '« normal » et « 0.5px » n ont pas la meme forme : aucune tolerance ne s applique');
  });

  test('chaque nombre d un champ multiple est compare a sa place', () => {
    assert.equal(memeElement(releve(), releve({ padding: '5px 9px' })), true);
    assert.equal(memeElement(releve(), releve({ padding: '4px 12px' })), false,
      'le second nombre derive de 4 px, meme si le premier est identique');
  });

  test('les valeurs negatives sont comparees en ecart, pas en valeur absolue', () => {
    assert.equal(memeElement(releve({ margin: '-8px' }), releve({ margin: '-9px' })), true);
    assert.equal(memeElement(releve({ margin: '-8px' }), releve({ margin: '8px' })), false);
  });
});

describe('les champs non geometriques sont compares au caractere pres', () => {
  test('une couleur qui change est une regression, meme d une unite', () => {
    assert.equal(memeElement(releve(), releve({ color: 'rgb(31, 24, 18)' })), false);
  });

  test('la graisse de police n a aucune tolerance, malgre son apparence numerique', () => {
    assert.equal(memeElement(releve(), releve({ fontWeight: '401' })), false,
      'fontWeight est a l indice 9, hors des champs geometriques');
  });

  test('l opacite n a aucune tolerance', () => {
    assert.equal(memeElement(releve(), releve({ opacity: '0.99' })), false);
  });

  test('un element cache ne vaut pas un element visible', () => {
    assert.equal(memeElement(releve(), releve({ visibility: 'hidden' })), false);
  });

  test('un changement de display est une regression', () => {
    assert.equal(memeElement(releve(), releve({ display: 'none' })), false);
  });

  test('une classe qui change est une regression', () => {
    assert.equal(memeElement(releve(), releve({ className: 'intro grande' })), false);
  });

  test('une police de secours ne vaut pas la police attendue', () => {
    assert.equal(memeElement(releve(), releve({ fontFamily: 'Arial' })), false);
  });
});

describe('formes incomparables', () => {
  test('« 4px 8px » et « 4px » sont refuses malgre la tolerance', () => {
    assert.equal(memeElement(releve(), releve({ padding: '4px' })), false);
  });

  test('« 0px » et « 0% » sont refuses : meme nombre, unite differente', () => {
    assert.equal(memeElement(releve(), releve({ borderRadius: '0%' })), false);
  });

  test('un nombre en plus dans le meme champ est refuse', () => {
    assert.equal(memeElement(releve(), releve({ margin: '0px 0px' })), false);
  });
});

describe('releves absents ou mal formes', () => {
  test('un element apparu n a pas d equivalent', () => {
    assert.equal(memeElement(undefined, releve()), false);
  });

  test('un element disparu n a pas d equivalent', () => {
    assert.equal(memeElement(releve(), undefined), false);
  });

  test('deux absences se valent : rien contre rien', () => {
    assert.equal(memeElement(undefined, undefined), true);
  });

  test('deux releves de longueurs differentes sont refuses', () => {
    assert.equal(memeElement(releve(), releve() + '|extra'), false);
  });
});

describe('garde-fou : l oracle doit rester capable de dire non', () => {
  /**
   * Le mode de panne qu'on redoute n'est pas qu'un test precis casse, c'est que
   * `memeElement` se mette a tout accepter — la QA reste verte et ne protege
   * plus rien. Ce test echouerait en bloc dans ce cas, quelle que soit la
   * facon dont la fonction aurait ete affaiblie.
   */
  test('aucune de ces alterations ne passe', () => {
    const alterations = [
      { color: 'rgb(255, 0, 0)' },
      { backgroundColor: 'rgb(255, 255, 255)' },
      { display: 'none' },
      { visibility: 'hidden' },
      { fontWeight: '700' },
      { fontStyle: 'italic' },
      { fontFamily: 'serif' },
      { textAlign: 'center' },
      { opacity: '0' },
      { tagName: 'DIV' },
      { width: '400' },
      { height: '80' },
      { left: '0' },
      { top: '0' },
      { fontSize: '24px' },
      { padding: '16px 32px' },
      { lineHeight: '40px' },
    ];

    const acceptees = alterations.filter((a) => memeElement(releve(), releve(a)));
    assert.deepEqual(acceptees, [], 'ces alterations auraient du etre signalees');
  });
});

/**
 * Le controle des taux metier lit le texte des pages et le confronte a
 * shared/tarifs.js. Comme memeElement, c'est un oracle : s'il n'attrape rien,
 * il rend la QA verte sans rien avoir verifie. Les valeurs attendues ici sont
 * celles du site — 0,70 €/km et un acompte de 30 %.
 */
describe('taux metier annonces', () => {
  test('le texte en vigueur sur le site ne declenche rien', () => {
    const texte = [
      "Au-delà des 20 km, je peux venir sur devis, avec des frais de 0,70 €/km.",
      "Un acompte de 30 % bloque vos dates, le contrat est finalisé.",
      "Acompte de 30 % à la réservation",
      "Supplément déplacement (5 km × 2 × 3 visites × 0,70 €)",
    ].join('\n');
    assert.deepEqual(controlerTauxMetier(texte), []);
  });

  test('un tarif kilometrique divergent est signale, avec sa phrase', () => {
    const defauts = controlerTauxMetier('des frais kilométriques de 0,80 €/km');
    assert.equal(defauts.length, 1);
    assert.match(defauts[0], /0,80 €\/km/);
    assert.match(defauts[0], /0,70 €\/km/);
  });

  test('un acompte divergent est signale', () => {
    const defauts = controlerTauxMetier('Acompte de 40 % à la réservation');
    assert.equal(defauts.length, 1);
    assert.match(defauts[0], /acompte/i);
  });

  test('une hausse appliquee partout sauf a un endroit est nommee une seule fois', () => {
    // Le cas redoute : cinq mentions a jour, une oubliee.
    const texte = Array(5).fill('frais de 0,70 €/km').concat('frais de 0,60 €/km').join(' · ');
    const defauts = controlerTauxMetier(texte);
    assert.equal(defauts.length, 1);
    assert.match(defauts[0], /0,60/);
  });

  test('l espace insecable ne masque pas une divergence', () => {
    // Les pages ecrivent « 30&nbsp;% » : sans normalisation, le motif ne
    // reconnaitrait pas le pourcentage et le controle serait aveugle.
    assert.equal(controlerTauxMetier('acompte de 45 %').length, 1);
  });

  test('« acompte » sans pourcentage ne declenche rien', () => {
    // Les CGV parlent d'acompte conservé ou remboursé, sans chiffre. Un
    // controle qui exigerait un pourcentage a chaque mention serait faux.
    const texte = "Moins de 72 h : acompte conservé à titre d'indemnité forfaitaire";
    assert.deepEqual(controlerTauxMetier(texte), []);
  });

  test('un pourcentage sans rapport avec l acompte est ignore', () => {
    assert.deepEqual(controlerTauxMetier('une remise de 15 % sur la seconde semaine'), []);
  });
});
