/* Case anti-robot factice */
(() => {
  const etat = {
    rendus: 0,
    remises: 0,
    options: null,
    jetons: [...(window.__jetonsAntirobot || [])],
  };
  window.__antirobot = etat;

  const emettre = () => {
    const jeton = etat.jetons.shift() || `jeton-essai-${etat.rendus + etat.remises}`;
    setTimeout(() => etat.options?.callback?.(jeton), 50);
  };

  window.turnstile = {
    render(conteneur, options) {
      const cible = typeof conteneur === 'string' ? document.querySelector(conteneur) : conteneur;
      const cadre = document.createElement('iframe');
      cadre.title = 'case factice';
      cadre.style.cssText = 'display:block;width:300px;height:73px;border:0;';
      cible.append(cadre);
      etat.options = options;
      etat.rendus += 1;
      emettre();
      return 'factice';
    },
    reset() {
      etat.remises += 1;
      emettre();
    },
    remove() {},
    getResponse() {
      return '';
    },
  };
})();
