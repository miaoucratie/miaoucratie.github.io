# Dette technique

État au 11 août 2026. Priorité = (Impact + Risque) × (6 − Effort), notes de 1 à 5.

## Classement

| # | Dette | Impact | Risque | Effort | Priorité | État |
|---|---|:---:|:---:|:---:|:---:|---|
| 1 | Aucun test automatisé | 4 | 5 | 2 | **36** | ✅ fait |
| 2 | Aucun garde-fou avant publication | 3 | 4 | 2 | **28** | à faire |
| 3 | Balisage dupliqué dans les 9 pages | 4 | 3 | 3 | **21** | à faire |
| 4 | Cascade CSS inversée, 332 `!important` | 5 | 4 | 4 | **18** | à faire |
| 5 | Consentement cookies absent | 1 | 5 | 3 | **18** | reporté |
| 6 | Images lourdes non optimisées | 2 | 1 | 1 | **15** | ✅ fait |

Les postes traités le 11 août 2026 sont listés en fin de document.

---

## 1. Aucun test automatisé — priorité 36 — ✅ fait le 11 août 2026

**Constat.** Aucun test, aucune vérification automatique. Une suppression de blocs a détruit tout le JavaScript de `faq.html` — accordéon, recherche, filtres, menu — et le code est parti en production. La panne a été signalée par Irina, pas détectée.

**Livré.** `qa/qa.mjs`, lancé par `npm run qa`. Sert le site en local, ouvre les 9 pages en 1272 px et 375 px, et contrôle :

- l'empreinte visuelle de 3 224 éléments contre `qa/reference.json` ;
- le menu burger sur les 9 pages, ouverture **et** fermeture ;
- l'accordéon de la FAQ, la synchronisation de `aria-expanded`, les filtres par catégorie, la recherche et son message d'absence de résultat ;
- la correspondance entre les questions affichées et les données structurées JSON-LD ;
- la carte : classification de trois communes témoins, couleur du marqueur, absence de `NaN`, et réinitialisation complète — y compris le **contenu** de la pastille flottante, dont l'oubli avait laissé un résultat périmé ;
- l'initialisation de Flatpickr et l'ouverture réelle du calendrier ;
- l'absence de nom de famille de client dans les avis, affichés et en JSON-LD ;
- l'absence d'erreur JavaScript et de débordement horizontal.

**Vérifié par sabotage.** Le harnais a été validé en cassant volontairement le site : suppression du bloc JavaScript de la FAQ (la panne réelle du 11 août) et republication d'un nom de famille. Il a détecté les deux, avec 467 écarts visuels et l'échec des trois contrôles fonctionnels dans le premier cas.

**Exclusions documentées.** Les éléments Leaflet, dont le marqueur de départ dépend d'un appel réseau au timing variable. Et `admin-indisponibilites.html`, dont le contenu vient d'une API qui n'autorise que l'origine de production : ses contrôles de comportement restent actifs, seule son empreinte visuelle est exclue.

---

## 2. Aucun garde-fou avant publication — priorité 28

**Constat.** `git push` publie directement. Rien ne s'interpose entre une erreur et les visiteurs.

**Remédiation.** Une action GitHub qui exécute `qa.mjs` sur chaque push et échoue bruyamment. Dépend du poste 1.

**Effort** : deux heures une fois les tests écrits.

---

## 3. Balisage dupliqué dans les 9 pages — priorité 21

**Constat.** Barre de navigation, pied de page et script du menu sont recopiés à l'identique dans les 9 pages. Toute modification de navigation demande 9 corrections.

**Ce que ça a déjà coûté.** Les mentions légales suivaient la même logique et avaient divergé en **cinq versions différentes** : deux pages avaient perdu le bureau d'enregistrement du domaine, deux autres les intitulés des bases légales RGPD. Corrigé le 11 août par extraction en page unique.

**Remédiation.** Trois options, par ordre de préférence :

1. **Un générateur local** (script Python) assemblant les pages depuis des fragments, exécuté avant chaque publication. Garde le HTML statique et indexable.
2. **Un composant web** injectant barre et pied de page. Simple, mais rend la navigation invisible aux moteurs de recherche : à éviter sur un site vitrine local dont le référencement est l'atout principal.
3. **Ne rien faire et documenter.** Acceptable tant que le site reste à 9 pages.

**Effort** : une journée pour l'option 1.

---

## 4. Cascade CSS inversée, 332 `!important` — priorité 18

**Constat.** `css/style.css` est chargé en premier sur toutes les pages, mais contient les couches `TITLE-V2`, `TITLES-V5`, `TOPBAR-V4` censées **écraser** les styles propres à chaque page, qui viennent après dans le document. Une règle antérieure ne peut battre une règle postérieure que d'une façon : `!important`.

Les 332 `!important` ne sont donc pas de la négligence, ce sont les béquilles d'un ordre de chargement inversé. Les marqueurs racontent l'histoire : `TOPBAR-V2` puis `TOPBAR-V4`, `TITLE-V2` puis `TITLES-V5` — des correctifs empilés sans jamais retirer les précédents.

**Tentative du 11 août, échouée.** Déplacer ces couches en fin de cascade a fonctionné sur 7 pages sur 9. Les deux dernières résistent parce que `calculateur-miaoucratie.html` redéfinit `--light: #b8a598` pour son propre compte. La correction de ce cas a fait passer la barre de navigation de 50 à 67 px sur toutes les pages. Tout a été annulé.

**Remédiation.** Traiter page par page, en commençant par recenser les variables CSS redéfinies localement. Nécessite un arbitrage humain sur les cas ambigus. À faire après le poste 1 : sans tests, c'est jouer aux dés.

**Effort** : deux jours, en plusieurs séances.

---

## 5. Consentement cookies absent — priorité 18

**Constat.** Google Analytics 4 (`G-X3H7NL9GEL`) se charge sur 6 pages avant toute action du visiteur, sans bandeau de consentement.

**Ce qui a été fait le 11 août.** Les mentions légales déclaraient qu'aucun cookie de suivi n'était déposé : le texte a été corrigé pour décrire la réalité et indiquer comment s'y opposer. La configuration a été durcie — Google Signals et personnalisation publicitaire désactivés, cookie ramené de 2 ans à 6 mois, `SameSite=Lax;Secure`.

**Ce qui reste.** Le recueil du consentement. Arbitrage assumé, reporté sciemment. Options étudiées : retrait pur et simple, bascule vers une mesure sans cookie (Plausible ~9 €/mois, ou Matomo auto-hébergé), ou bandeau bloquant. La mesure sans cookie était la recommandation : statistiques utilisables, aucun bandeau, aucune exposition.

---

## 6. Images lourdes non optimisées — priorité 15

**Constat.** `label-syndicat-gratouilles.png` pèse 525 Ko pour un badge affiché en petit. `photo-credibilite-2.jpg` pèse 479 Ko.

**Remédiation.** Conversion en WebP et redimensionnement aux dimensions d'affichage réelles. Gain estimé : 800 Ko sur le poids de la page d'accueil.

**Effort** : une heure.

---

## Traité le 11 août 2026

| Poste | Résultat |
|---|---|
| Mentions légales en 5 versions divergentes | Page unique, 101 Ko de duplication supprimés |
| `?v=` manuel sur les feuilles de style | Supprimé : GitHub Pages gère déjà la fraîcheur par ETag |
| CSS mort | 271 règles supprimées, `style.css` de 57 à 33 Ko |
| Blocs CSS recopiés dans 4 pages | Extraits en `overrides.css`, `topbar.css`, `page-legale.css` |
| `!important` de `reservation.css` | 68 sur 69 supprimés ; seul `[hidden]` était nécessaire |
| Flatpickr sans version épinglée | Épinglé en 4.6.13 |
| `</head>` en double sur 6 pages | Corrigé |
| `<div class="process-bg">` jamais refermé sur l'accueil | Corrigé |
| Classes de `<body>` en triple sur CGV et calculateur | Corrigées |
| Feuille `style.css` chargée deux fois sur la réservation | Corrigée |
| Règle `font-family: 'Fraunces'` visant une police jamais chargée | Supprimée |
| Dossier `.old` suivi par git | Supprimé, 1,8 Mo |
| Images jamais référencées | Supprimées, 554 Ko |

## Non traité, sans risque identifié

**Aucun contrôle d'intégrité (SRI) sur les ressources CDN.** Ajouter `integrity` sur Leaflet et Flatpickr protégerait d'une compromission du CDN. Effort faible, risque faible sur un site vitrine sans données sensibles.

**678 styles inline ramenés à 93.** Les restants sont pour l'essentiel légitimes : positionnement ponctuel, couleurs de blocs CTA.
