/**
 * Consentement a la mesure d'audience.
 *
 * Ce fichier est le seul endroit du site qui charge Google Analytics. Le
 * script gtag n'est plus ecrit en dur dans les pages : il n'est injecte
 * qu'apres un choix explicite du visiteur. Sans choix, rien n'est charge et
 * aucun cookie n'est depose.
 *
 * Comment le brancher sur une page :
 *
 *   <script src="js/consentement.js" data-mesure="G-XXXXXXX" defer></script>
 *     la page est mesuree ; le bandeau s'affiche tant qu'aucun choix n'est
 *     enregistre.
 *
 *   <script src="js/consentement.js" defer></script>
 *     la page n'est pas mesuree et n'affiche pas de bandeau, mais les
 *     commandes de reglage qu'elle contient restent actives. C'est le cas des
 *     mentions legales, ou le visiteur peut revenir sur son choix.
 *
 *   <button type="button" data-consentement-reglages>...</button>
 *     rouvre le bandeau, quel que soit le choix deja enregistre.
 *
 * Le style est injecte par ce fichier plutot que pose dans une feuille : le
 * bandeau est un composant autonome, une page l'obtient en ajoutant une seule
 * ligne. Aucune regle ne vise de h1/h2/h3 — la couche de titres de
 * couches.css est chargee en dernier et les repeindrait.
 */
(function () {
  'use strict';

  var CLE = 'miaoucratie.consentement';
  var VERSION = 1;
  // Six mois : la duree recommandee par la CNIL pour conserver un choix. Elle
  // est volontairement plus longue que celle du cookie de mesure — reposer la
  // question tous les deux mois serait exactement l'inverse de « discret ».
  var DUREE_MS = 182 * 24 * 60 * 60 * 1000;

  var script = document.currentScript;
  var ID_MESURE = script ? script.getAttribute('data-mesure') : null;

  /* ── Choix enregistre ───────────────────────────────────────────────── */

  function lireChoix() {
    try {
      var brut = window.localStorage.getItem(CLE);
      if (!brut) return null;
      var choix = JSON.parse(brut);
      if (!choix || choix.version !== VERSION) return null;
      if (choix.valeur !== 'accepte' && choix.valeur !== 'refuse') return null;
      if (!choix.date || Date.now() - Date.parse(choix.date) > DUREE_MS) return null;
      return choix.valeur;
    } catch (e) {
      // Stockage indisponible (navigation privee, cookies bloques) : on se
      // comporte comme si aucun choix n'avait ete fait, donc sans mesure.
      return null;
    }
  }

  function ecrireChoix(valeur) {
    try {
      window.localStorage.setItem(CLE, JSON.stringify({
        valeur: valeur,
        version: VERSION,
        date: new Date().toISOString(),
      }));
    } catch (e) {
      // Sans stockage, le choix ne vaut que pour la page en cours. C'est le
      // comportement le moins mauvais : on n'insiste pas, et on ne mesure pas.
    }
  }

  /* ── Mesure d'audience ──────────────────────────────────────────────── */

  var mesureChargee = false;

  function chargerMesure() {
    if (mesureChargee || !ID_MESURE) return;
    mesureChargee = true;

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID_MESURE);
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ID_MESURE, {
      // Pas de recoupement multi-appareils ni de ciblage publicitaire.
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // Cookie ramene de 2 ans (defaut) a 2 mois, pour coller a la duree de
      // conservation reglee dans GA4. Au-dela, les donnees de l'utilisateur
      // sont supprimees cote Google : garder l'identifiant plus longtemps sur
      // le terminal ne mesurerait plus rien.
      cookie_expires: 5184000,
      cookie_flags: 'SameSite=Lax;Secure',
    });
  }

  /**
   * Efface les cookies deja poses. Indispensable pour un visiteur qui avait
   * ete mesure avant l'arrivee du bandeau, ou qui revient sur son accord :
   * refuser sans nettoyer laisserait l'identifiant en place pendant six mois.
   */
  function effacerCookiesMesure() {
    var hote = window.location.hostname;
    var parties = hote.split('.');
    var domaines = [null, hote, '.' + hote];
    if (parties.length > 2) domaines.push('.' + parties.slice(-2).join('.'));

    var cookies = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < cookies.length; i++) {
      var nom = cookies[i].split('=')[0].trim();
      // _ga* : identifiants de mesure. _gcl* : pose par le meme script pour le
      // suivi de conversion publicitaire, il n'a rien a faire ici non plus.
      if (nom.indexOf('_ga') !== 0 && nom.indexOf('_gcl') !== 0) continue;
      for (var j = 0; j < domaines.length; j++) {
        document.cookie = nom + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
          + (domaines[j] ? '; domain=' + domaines[j] : '');
      }
    }
  }

  /* ── Bandeau ────────────────────────────────────────────────────────── */

  var STYLE = [
    '.consentement{position:fixed;left:20px;bottom:20px;z-index:9000;width:380px;',
    'max-width:calc(100vw - 32px);box-sizing:border-box;padding:18px 20px 20px;',
    "font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.55;",
    'color:var(--N,#1E1812);background:var(--cream,#FBF7F0);',
    'border:1px solid var(--light,#D4BEA8);border-radius:14px;',
    'box-shadow:0 10px 30px rgba(30,24,18,.16);animation:consentement-entree .35s ease-out}',

    // L'animation ne touche ni l'opacite ni le remplissage : un onglet en
    // arriere-plan gele ses animations a l'image zero, et un fondu depuis
    // opacity:0 laisserait alors un bandeau invisible mais bien present.
    // Gele, celui-ci est simplement pose 12px plus bas.
    '@keyframes consentement-entree{from{transform:translateY(12px)}to{transform:none}}',
    '@media (prefers-reduced-motion:reduce){.consentement{animation:none}}',

    '.consentement-titre{margin:0 0 6px;font-size:13px;font-weight:600;',
    'letter-spacing:.04em;text-transform:uppercase;color:var(--rust,#A8472A)}',
    '.consentement-texte{margin:0;font-size:13px;line-height:1.55;color:var(--N,#1E1812)}',
    '.consentement-texte a{color:var(--rust,#A8472A);text-decoration:underline;',
    'text-underline-offset:2px}',

    // Les deux boutons partagent la meme geometrie et occupent la largeur du
    // cadre : refuser demande exactement le meme geste qu'accepter.
    '.consentement-choix{display:flex;gap:10px;margin-top:14px}',
    '.consentement-choix button{flex:1 1 0;min-height:44px;padding:10px 12px;',
    "font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;line-height:1.2;",
    'border-radius:10px;border:1px solid var(--rust,#A8472A);cursor:pointer;',
    'transition:background .2s,color .2s}',
    '.consentement-refuser{background:transparent;color:var(--rust,#A8472A)}',
    '.consentement-refuser:hover{background:rgba(168,71,42,.08)}',
    '.consentement-accepter{background:var(--rust,#A8472A);color:#FFF8F2}',
    '.consentement-accepter:hover{background:var(--terracotta,#C8603A);',
    'border-color:var(--terracotta,#C8603A)}',
    '.consentement-choix button:focus-visible{outline:2px solid var(--N,#1E1812);outline-offset:2px}',

    '@media (max-width:520px){.consentement{left:12px;right:12px;bottom:12px;width:auto;',
    'max-width:none;padding:16px 16px 18px}}',
  ].join('');

  var styleInjecte = false;

  function injecterStyle() {
    if (styleInjecte) return;
    styleInjecte = true;
    var s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  var bandeau = null;

  function fermerBandeau() {
    if (!bandeau) return;
    bandeau.remove();
    bandeau = null;
  }

  function afficherBandeau() {
    if (bandeau) return;
    injecterStyle();

    bandeau = document.createElement('section');
    bandeau.className = 'consentement';
    bandeau.setAttribute('role', 'region');
    bandeau.setAttribute('aria-label', "Consentement à la mesure d'audience");

    var titre = document.createElement('p');
    titre.className = 'consentement-titre';
    titre.textContent = "Mesure d'audience";

    var texte = document.createElement('p');
    texte.className = 'consentement-texte';
    texte.appendChild(document.createTextNode(
      'Je compte les visites du site pour savoir ce qui vous sert vraiment. '
      + 'Aucune publicité, aucune revente de données. ',
    ));
    var lien = document.createElement('a');
    lien.href = 'mentions-legales.html#cookies';
    lien.textContent = 'En savoir plus';
    texte.appendChild(lien);
    texte.appendChild(document.createTextNode('.'));

    var choix = document.createElement('div');
    choix.className = 'consentement-choix';
    choix.appendChild(bouton('consentement-refuser', 'Refuser', 'refuse'));
    choix.appendChild(bouton('consentement-accepter', 'Accepter', 'accepte'));

    bandeau.appendChild(titre);
    bandeau.appendChild(texte);
    bandeau.appendChild(choix);
    document.body.appendChild(bandeau);
  }

  function bouton(classe, libelle, valeur) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.textContent = libelle;
    b.addEventListener('click', function () {
      appliquer(valeur);
      ecrireChoix(valeur);
      fermerBandeau();
    });
    return b;
  }

  /* ── Mise en oeuvre du choix ────────────────────────────────────────── */

  function appliquer(valeur) {
    if (valeur === 'accepte') chargerMesure();
    else effacerCookiesMesure();
  }

  /* ── Demarrage ──────────────────────────────────────────────────────── */

  // Signal « Global Privacy Control » : c'est une opposition deja exprimee par
  // le visiteur au niveau de son navigateur. La respecter evite de lui poser
  // une question a laquelle il a deja repondu.
  var oppositionNavigateur = window.navigator.globalPrivacyControl === true;

  var choix = lireChoix();

  if (choix) {
    appliquer(choix);
  } else if (oppositionNavigateur) {
    effacerCookiesMesure();
  } else if (ID_MESURE) {
    afficherBandeau();
  }

  var reglages = document.querySelectorAll('[data-consentement-reglages]');
  for (var i = 0; i < reglages.length; i++) {
    reglages[i].addEventListener('click', function () {
      afficherBandeau();
    });
  }
})();
