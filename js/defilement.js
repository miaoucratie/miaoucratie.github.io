/* Rangées qui défilent */
(function () {
  'use strict';

  const PLACE = 44;
  const FLECHE = {
    avant: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    apres: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  };

  function equiper(rangee) {
    const parent = rangee.parentElement;
    const bouton = (sens, nom) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `defile defile--${sens}`;
      b.setAttribute('aria-label', nom);
      b.innerHTML = FLECHE[sens];
      b.addEventListener('click', () => {
        rangee.scrollBy({ left: (sens === 'avant' ? -1 : 1) * rangee.clientWidth * 0.8, behavior: 'smooth' });
      });
      parent.append(b);
      return b;
    };
    const avant = bouton('avant', rangee.dataset.defilement === 'rubriques' ? 'Rubriques précédentes' : 'Précédent');
    const apres = bouton('apres', rangee.dataset.defilement === 'rubriques' ? 'Rubriques suivantes' : 'Suivant');
    const maj = () => {
      const deborde = rangee.scrollWidth > rangee.clientWidth + 1;
      rangee.classList.toggle('deborde', deborde);
      const repere = rangee.querySelector('a, button') || rangee;
      const haut = rangee.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.clientTop;
      const milieu = `${haut + repere.offsetTop - rangee.offsetTop + repere.offsetHeight / 2}px`;
      avant.style.top = milieu;
      apres.style.top = milieu;
      avant.hidden = !deborde || rangee.scrollLeft <= 1;
      apres.hidden = !deborde || rangee.scrollLeft + rangee.clientWidth >= rangee.scrollWidth - 1;
      if (!avant.hidden !== rangee.classList.contains('suite-avant')) {
        rangee.classList.toggle('suite-avant', !avant.hidden);
        if (!avant.hidden) rangee.scrollLeft += PLACE;
      }
      rangee.classList.toggle('suite-apres', !apres.hidden);
    };
    rangee.addEventListener('scroll', maj, { passive: true });
    addEventListener('resize', maj);
    maj();
  }

  document.querySelectorAll('[data-defilement]').forEach(equiper);
})();
