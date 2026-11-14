/** Tarifs et calcul */

(function (racine) {
  'use strict';

  /** Frais km hors zone */
  const FRAIS_KM_EUR = 0.7;

  /** Acompte */
  const TAUX_ACOMPTE = 0.3;

  /** Rayon sans frais */
  const RAYON_INCLUS_KM = 20;

  /** Rayon sur devis */
  const RAYON_DEVIS_KM = 45;

  /** Tarif par nombre de chats */
  const TARIF_VISITE_EUR = Object.freeze({
    1: 18,
    2: 18,
    3: 22,
    4: 26,
    5: 29,
  });

  /** Au-delà : sur devis */
  const MAX_CHATS_TARIF = 5;

  /** Seuil séjour long */
  const SEUIL_SEJOUR_LONG = 7;

  /** Remise par visite */
  const REMISE_PAR_VISITE_EUR = 1;

  /** Tarif d'une visite */
  function nombreDeChats(chats) {
    return Math.max(1, Math.trunc(Number(chats) || 1));
  }

  function tarifVisite(chats) {
    return TARIF_VISITE_EUR[nombreDeChats(chats)] ?? null;
  }

  /** Arrondi au centime */
  function arrondirCentimes(montant) {
    return Math.round(Number(montant) * 100) / 100;
  }

  /** Format euros */
  function formatEuros(montant) {
    return `${Number(montant).toFixed(2).replace('.', ',')} €`;
  }

  /** Estimation d'un séjour */
  function estimerSejour({ chats = 1, visites = 1, solidaire = false, periode = false, km = 0 } = {}) {
    const nombreVisites = Math.max(1, Math.trunc(Number(visites) || 1));
    const distance = Math.max(0, Number(km) || 0);

    if (nombreDeChats(chats) > MAX_CHATS_TARIF) {
      return { surDevis: true, chats: nombreDeChats(chats), visites: nombreVisites };
    }

    const base = tarifVisite(chats);
    const remiseSejour = nombreVisites >= SEUIL_SEJOUR_LONG ? REMISE_PAR_VISITE_EUR : 0;
    const cumulBloque = Boolean(solidaire && periode && remiseSejour > 0);
    const remiseSolidaire = solidaire && !cumulBloque ? REMISE_PAR_VISITE_EUR : 0;

    const tarifNet = base - remiseSejour - remiseSolidaire;
    const supplementKm = distance * 2 * FRAIS_KM_EUR * nombreVisites;
    const total = arrondirCentimes(tarifNet * nombreVisites + supplementKm);
    const acompte = arrondirCentimes(total * TAUX_ACOMPTE);

    return {
      surDevis: false,
      base,
      visites: nombreVisites,
      remiseSejour,
      remiseSolidaire,
      cumulBloque,
      tarifNet,
      supplementKm: arrondirCentimes(supplementKm),
      total,
      acompte,
      solde: arrondirCentimes(total - acompte),
    };
  }

  racine.MiaouTarifs = Object.freeze({
    FRAIS_KM_EUR,
    TAUX_ACOMPTE,
    RAYON_INCLUS_KM,
    RAYON_DEVIS_KM,
    TARIF_VISITE_EUR,
    MAX_CHATS_TARIF,
    SEUIL_SEJOUR_LONG,
    REMISE_PAR_VISITE_EUR,
    tarifVisite,
    arrondirCentimes,
    formatEuros,
    estimerSejour,
  });
})(globalThis);
