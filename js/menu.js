/* Menu de la barre du haut */
(function () {
  var bouton = document.getElementById('tmenuBtn');
  var panneau = document.getElementById('tmenuPanel');
  if (!bouton || !panneau) return;
  bouton.addEventListener('click', function (e) {
    e.stopPropagation();
    panneau.hidden = !panneau.hidden;
    bouton.setAttribute('aria-expanded', String(!panneau.hidden));
  });
  document.addEventListener('click', function (e) {
    if (!panneau.hidden && !panneau.contains(e.target)) {
      panneau.hidden = true;
      bouton.setAttribute('aria-expanded', 'false');
    }
  });
})();
