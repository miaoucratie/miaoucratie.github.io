/** Consentement à la mesure d'audience */
(function () {
  'use strict';

  var CLE = 'miaoucratie.consentement';
  var VERSION = 1;
  // Six mois
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
      // Stockage indisponible
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
      // Sans stockage
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
      // Accueil : racine
      page_location: window.location.href.replace(/\/index\.html(?=$|[?#])/, '/'),
      // Sans ciblage
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // Cookie : 2 mois
      cookie_expires: 5184000,
      cookie_flags: 'SameSite=Lax;Secure',
    });
  }

  /** Effacement des cookies */
  function effacerCookiesMesure() {
    var hote = window.location.hostname;
    var parties = hote.split('.');
    var domaines = [null, hote, '.' + hote];
    if (parties.length > 2) domaines.push('.' + parties.slice(-2).join('.'));

    var cookies = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < cookies.length; i++) {
      var nom = cookies[i].split('=')[0].trim();
      // _ga*, _gcl*
      if (nom.indexOf('_ga') !== 0 && nom.indexOf('_gcl') !== 0) continue;
      for (var j = 0; j < domaines.length; j++) {
        document.cookie = nom + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
          + (domaines[j] ? '; domain=' + domaines[j] : '');
      }
    }
  }

  /* ── Clics de contact ───────────────────────────────────────────────── */

  function moyenDeContact(href) {
    if (href.indexOf('tel:') === 0) return 'telephone';
    if (href.indexOf('mailto:') === 0) return 'email';
    if (href.indexOf('https://wa.me/') === 0) return 'whatsapp';
    return null;
  }

  document.addEventListener('click', function (e) {
    if (!mesureChargee || !e.target.closest) return;
    var lien = e.target.closest('a[href]');
    if (!lien) return;
    var moyen = moyenDeContact(lien.getAttribute('href'));
    if (!moyen) return;
    window.gtag('event', 'contact_clic', {
      moyen: moyen,
      // Liens du relais
      destinataire: lien.closest('.relais') ? 'relais' : 'miaoucratie',
    });
  });

  /* ── Bandeau ────────────────────────────────────────────────────────── */

  var STYLE = [
    '.consentement{position:fixed;left:20px;bottom:20px;z-index:9000;width:380px;',
    'max-width:calc(100vw - 32px);box-sizing:border-box;padding:18px 20px 20px;',
    "font-family:'DM Sans',sans-serif;font-size:13px;line-height:1.55;",
    'color:var(--N,#1E1812);background:var(--cream,#FBF7F0);',
    'border:1px solid var(--light,#D4BEA8);border-radius:14px;',
    'box-shadow:0 10px 30px rgba(30,24,18,.16);animation:consentement-entree .35s ease-out}',

    // Animation sans opacité
    '@keyframes consentement-entree{from{transform:translateY(12px)}to{transform:none}}',
    '@media (prefers-reduced-motion:reduce){.consentement{animation:none}}',

    '.consentement-titre{margin:0 0 6px;font-size:13px;font-weight:600;',
    'letter-spacing:.04em;text-transform:uppercase;color:var(--rust,#A8472A)}',
    '.consentement-texte{margin:0;font-size:13px;line-height:1.55;color:var(--N,#1E1812)}',
    '.consentement-texte a{color:var(--rust,#A8472A);text-decoration:underline;',
    'text-underline-offset:2px}',

    // Boutons identiques
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

  // Global Privacy Control
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
