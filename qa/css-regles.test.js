/* Tests des règles CSS */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classesDeBibliotheque,
  classesManipulees,
  commentairesCSS,
  commentairesNonFermes,
  estTiers,
  estAccrochee,
  nomsDeClasses,
  reglesCSS,
} from './css-regles.mjs';

describe('commentairesNonFermes', () => {
  test('une banniere non terminee suivie d\'un commentaire ne compte pas deux ouvertures', () => {
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

describe('commentairesCSS', () => {
  test('chaque commentaire est rendu avec sa ligne et son texte', () => {
    const css = '.a { content: "/* non */"; }\n/* Carte */\n.b {}\n/* ouvert';
    assert.deepEqual(commentairesCSS(css).map((c) => [c.ligne, c.texte, c.ferme]), [
      [2, '/* Carte */', true],
      [4, '/* ouvert', false],
    ]);
  });
});

describe('nomsDeClasses', () => {
  test('une decimale dans une media query ne declare pas de classe', () => {
    assert.deepEqual(nomsDeClasses('@media (max-width: 63.99rem)'), []);
    assert.deepEqual(nomsDeClasses('.marge { padding: 0.5rem; }'), ['marge']);
  });

  test('les noms composes et les modificateurs sont rendus entiers', () => {
    assert.deepEqual(nomsDeClasses('.art-trio.art-trio--lies'), ['art-trio', 'art-trio--lies']);
  });

  test('un prefixe ne vaut pas une declaration', () => {
    assert.deepEqual(nomsDeClasses('.art-schema-boite'), ['art-schema-boite']);
  });
});

describe('classesManipulees', () => {
  test('un nom de variable n\'est pas une classe', () => {
    const js = "var grille = car.querySelector('.avis-grid');";
    const vues = classesManipulees(js);
    assert.ok(vues.has('avis-grid'), 'le selecteur doit etre releve');
    assert.ok(!vues.has('grille'), 'la variable ne doit pas l\'etre');
  });

  test('un className pose par un ternaire compte pour ses deux branches', () => {
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
    const js = 'export function arrondirCentimes(m) { return Math.round(m * 100) / 100; }';
    assert.equal(classesManipulees(js).size, 0);
  });
});

describe('reglesCSS', () => {
  test('les declarations ne sont pas prises pour des selecteurs', () => {
    const r = reglesCSS('.a { padding: 0.5rem; background: url(x.png); }\n/* note */\n.b { color: blue; }');
    assert.deepEqual(r.map((x) => x.selecteur), ['.a', '.b']);
  });

  test('une regle dans un @media est lue, avec son contexte', () => {
    const r = reglesCSS('@media (max-width: 5px) { .b, .c { color: red; } @supports (x: y) { .f { margin: 0; } } }');
    assert.deepEqual(r.filter((x) => !x.arobase).map((x) => [x.contexte, x.selecteur]), [
      ['@media (max-width: 5px)', '.b, .c'],
      ['@media (max-width: 5px) > @supports (x: y)', '.f'],
    ]);
  });

  test('le contenu d\'une regle est rendu, !important compris', () => {
    const [r] = reglesCSS('.a { color: red !important; content: "{"; }');
    assert.match(r.corps, /!important/);
    assert.match(r.corps, /content: "\{"/);
  });

  test('les etapes d\'une animation ne sont pas des regles', () => {
    const r = reglesCSS('@keyframes k { from { opacity: 0; } to { opacity: 1; } } @font-face { font-family: x; }');
    assert.deepEqual(r.map((x) => x.selecteur), ['@keyframes k', '@font-face']);
  });
});

describe('classes fabriquees par un script', () => {
  test('une liste de classes passee en argument est relevee', () => {
    const vues = classesManipulees('const card = element("article", "period-card demande-card");');
    assert.ok(vues.has('period-card') && vues.has('demande-card'));
  });

  test('un mot sans tiret passe en argument n\'est pas une classe', () => {
    assert.ok(!classesManipulees('el.addEventListener("click", f);').has('click'));
  });

  test('un nom fabrique a partir d\'un prefixe accroche toutes les classes du prefixe', () => {
    const vues = classesManipulees('b.className = `defile defile--${sens}`; x(`demande-card__info${l ? ` demande-card__info--${l}` : ""}`);');
    assert.ok(estAccrochee('defile--avant', vues));
    assert.ok(estAccrochee('demande-card__info', vues));
    assert.ok(estAccrochee('demande-card__info--large', vues));
    assert.ok(!estAccrochee('autre', vues));
  });
});

describe('estTiers et classesDeBibliotheque', () => {
  test('les prefixes connus sont reconnus', () => {
    for (const n of ['flatpickr-day', 'leaflet-control-zoom-out']) {
      assert.ok(estTiers(n), `${n} devrait etre reconnu comme tiers`);
    }
    assert.ok(!estTiers('art-trio'), 'une classe du site ne doit pas l\'etre');
  });

  test('une classe toujours collee a une classe tierce appartient a la bibliotheque', () => {
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
