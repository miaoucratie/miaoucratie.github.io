/*
 * Carrousel horizontal. Le defilement, l'accroche et le masquage des fleches
 * aux extremites vivent ici ; l'apparence des cartes reste a la page.
 *
 * Ce script etait ecrit en clair dans « index.html », pour le seul carrousel
 * d'avis. Le blog en a maintenant un aussi : plutot que de recopier vingt
 * lignes dans une deuxieme page, elles sont sorties ici et le script monte
 * tous les « .avis-carousel » qu'il trouve.
 *
 * Le pas de defilement se lit sur la premiere carte et sur l'ecart reel de la
 * grille, sans valeur en dur : une carte plus large ou un « gap » modifie dans
 * la feuille de style restent justes sans toucher a ce fichier.
 */
(function () {
  var carrousels = document.querySelectorAll('.avis-carousel');
  for (var i = 0; i < carrousels.length; i++) monter(carrousels[i]);

  function monter(car) {
    var grille = car.querySelector('.avis-grid');
    var prec = car.querySelector('.avis-prev');
    var suiv = car.querySelector('.avis-next');
    if (!grille || !prec || !suiv) return;

    function pas() {
      var carte = grille.firstElementChild;
      if (!carte) return 360;
      var ecart = parseFloat(getComputedStyle(grille).columnGap) || 0;
      return carte.getBoundingClientRect().width + ecart;
    }

    /* Les deux bouts se testent avec la meme marge de 4 px. Au repos la
       grille n'est pas a zero : elle porte un retrait, et l'accroche aligne
       la premiere carte dessus. Compare a zero, la fleche gauche restait
       allumee alors qu'il n'y a rien avant. */
    function etat() {
      var course = grille.scrollWidth - grille.clientWidth;
      prec.classList.toggle('is-off', grille.scrollLeft <= 4);
      suiv.classList.toggle('is-off', grille.scrollLeft >= course - 4);
    }

    prec.addEventListener('click', function () {
      grille.scrollBy({ left: -pas(), behavior: 'smooth' });
    });
    suiv.addEventListener('click', function () {
      grille.scrollBy({ left: pas(), behavior: 'smooth' });
    });
    grille.addEventListener('scroll', etat, { passive: true });
    window.addEventListener('resize', etat);
    etat();
  }
})();
