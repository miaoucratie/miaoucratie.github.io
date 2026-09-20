/**
 * Tests des regles de lecture du CSS.
 *
 * Ces quatre fonctions decident si un constat est reel ou non. Quand elles se
 * trompent, le harnais ne casse pas : il se met a mentir. Un faux positif
 * permanent apprend a ignorer les avertissements ; un faux negatif laisse
 * passer du balisage mort.
 *
 * Chaque cas ci-dessous fige une erreur que ces regles ont reellement produite
 * sur ce site, avec la forme exacte du code qui l'a declenchee. Un test qui
 * n'est pas tire d'une panne observee ne prouve rien.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classesDeBibliotheque,
  classesManipulees,
  commentairesNonFermes,
  estTiers,
  nomsDeClasses,
  selecteursDePremierNiveau,
} from './css-regles.mjs';

describe('commentairesNonFermes', () => {
  test('une banniere non terminee suivie d\'un commentaire ne compte pas deux ouvertures', () => {
    /* La forme exacte trouvee trois fois dans article.css : une banniere de
       section sans fermeture, puis un commentaire ordinaire qui la ferme. Le
       comptage textuel y voyait deux ouvertures pour une fermeture. */
    const css = [
      '/* ══ DEUX GROUPES QUI SE CROISENT ══════════════════════════',
      '/* Les bandes ne partent pas de zero : elles couvrent la moyenne',
      '   plus ou moins son ecart. */',
      '.art-bande { color: red; }',
    ].join('\n');
    assert.deepEqual(commentairesNonFermes(css), []);
  });

  test('un commentaire reellement ouvert et jamais ferme est signale, avec sa ligne', () => {
    const css = '.a { color: red; }\n\n/* on oublie de fermer\n.b { color: blue; }\n';
    assert.deepEqual(commentairesNonFermes(css), [3]);
  });

  test('une ouverture ecrite dans une chaine n\'ouvre pas de commentaire', () => {
    assert.deepEqual(commentairesNonFermes('.a::before { content: "/*"; }'), []);
  });

  test('un fichier sans commentaire ne signale rien', () => {
    assert.deepEqual(commentairesNonFermes('.a { color: red; }'), []);
  });
});

describe('nomsDeClasses', () => {
  test('une decimale dans une media query ne declare pas de classe', () => {
    /* « @media (max-width: 63.99rem) » faisait apparaitre une classe « 99rem »
       dans la liste des orphelines de reservation.css. */
    assert.deepEqual(nomsDeClasses('@media (max-width: 63.99rem)'), []);
    assert.deepEqual(nomsDeClasses('.marge { padding: 0.5rem; }'), ['marge']);
  });

  test('les noms composes et les modificateurs sont rendus entiers', () => {
    assert.deepEqual(nomsDeClasses('.art-trio.art-trio--lies'), ['art-trio', 'art-trio--lies']);
  });

  test('un prefixe ne vaut pas une declaration', () => {
    /* « .art-schema-boite » ne declare pas « art-schema ». */
    assert.deepEqual(nomsDeClasses('.art-schema-boite'), ['art-schema-boite']);
  });
});

describe('classesManipulees', () => {
  test('un nom de variable n\'est pas une classe', () => {
    /* carrousel.js nomme une variable « grille ». Relever tous les mots du
       fichier suffisait a dedouaner la classe morte « grille » d'une page. */
    const js = "var grille = car.querySelector('.avis-grid');";
    const vues = classesManipulees(js);
    assert.ok(vues.has('avis-grid'), 'le selecteur doit etre releve');
    assert.ok(!vues.has('grille'), 'la variable ne doit pas l\'etre');
  });

  test('un className pose par un ternaire compte pour ses deux branches', () => {
    /* reservation.js : les deux classes etaient declarees orphelines alors
       qu'elles sont posees a chaque rendu de la barre de periode. */
    const js = 'part.className = morceau.couvert ? "periode__seg--oui" : "periode__seg--non";';
    const vues = classesManipulees(js);
    assert.ok(vues.has('periode__seg--oui'));
    assert.ok(vues.has('periode__seg--non'));
  });

  test('classList et un className a plusieurs classes sont releves', () => {
    const vues = classesManipulees([
      "prec.classList.toggle('is-off', x);",
      'editButton.className = "button button--secondary";',
    ].join('\n'));
    assert.ok(vues.has('is-off'));
    assert.ok(vues.has('button'));
    assert.ok(vues.has('button--secondary'));
  });

  test('une classe posee dans du HTML fabrique est relevee', () => {
    const js = `list.innerHTML = '<p class="empty-state">Rien pour le moment.</p>';`;
    assert.ok(classesManipulees(js).has('empty-state'));
  });

  test('un fichier sans DOM ne releve rien', () => {
    /* shared/tarifs.js et shared/booking-utils.js sont dans ce cas. */
    const js = 'export function arrondirCentimes(m) { return Math.round(m * 100) / 100; }';
    assert.equal(classesManipulees(js).size, 0);
  });
});

describe('selecteursDePremierNiveau', () => {
  test('les declarations ne sont pas prises pour des selecteurs', () => {
    const sels = selecteursDePremierNiveau('.a { padding: 0.5rem; background: url(x.png); }');
    assert.deepEqual(sels, ['.a']);
  });

  test('un commentaire entre deux regles ne devient pas un selecteur', () => {
    const sels = selecteursDePremierNiveau('.a { color: red; }\n/* note */\n.b { color: blue; }');
    assert.deepEqual(sels.map((s) => s.trim()).filter(Boolean), ['.a', '.b']);
  });
});

describe('estTiers et classesDeBibliotheque', () => {
  test('les prefixes connus sont reconnus', () => {
    for (const n of ['flatpickr-day', 'leaflet-control-zoom-out', 'h-captcha']) {
      assert.ok(estTiers(n), `${n} devrait etre reconnu comme tiers`);
    }
    assert.ok(!estTiers('art-trio'), 'une classe du site ne doit pas l\'etre');
  });

  test('une classe toujours collee a une classe tierce appartient a la bibliotheque', () => {
    /* Flatpickr pose « .selected », « .startRange », « .numInputWrapper » sans
       aucun prefixe. Ils sortaient en orphelines de reservation.css. */
    const sels = [
      '.flatpickr-day.selected',
      '.flatpickr-day.startRange.inRange',
      '.flatpickr-current-month .numInputWrapper',
    ];
    const bibli = classesDeBibliotheque(sels);
    for (const n of ['selected', 'startRange', 'inRange', 'numInputWrapper']) {
      assert.ok(bibli.has(n), `${n} devrait etre attribue a la bibliotheque`);
    }
  });

  test('une classe vue une seule fois hors compagnie tierce reste la notre', () => {
    const bibli = classesDeBibliotheque(['.flatpickr-day.selected', '.avis-card .selected']);
    assert.ok(!bibli.has('selected'), 'elle est aussi utilisee seule : elle est a nous');
  });
});
