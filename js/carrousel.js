/* Carrousel horizontal */
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
