/**
 * Taux metier du site, et le calcul qui s'appuie dessus.
 *
 * Avant ce fichier, « 0,70 €/km » etait recopie a sept endroits sur trois
 * pages et « acompte de 30 % » sur cinq pages, sans que rien ne verifie qu'ils
 * disent la meme chose. Aucune divergence n'avait eu lieu, mais une hausse
 * appliquee a six endroits sur sept serait passee sans un mot : le site aurait
 * annonce deux tarifs differents selon la page consultee.
 *
 * Deux usages, et c'est ce qui fait la valeur du fichier :
 *
 *  1. le calculateur importe `estimerSejour` — le calcul n'existe plus qu'ici,
 *     et il est teste par shared/tarifs.test.js ;
 *  2. le harnais de QA importe les constantes et relit le texte affiche de
 *     chaque page : un montant en euros par kilometre ou un pourcentage
 *     d'acompte qui ne correspond pas est nomme, page et phrase a l'appui.
 *
 * Changer un tarif se fait donc ici, et la QA dit ou le texte des pages reste
 * a mettre a jour.
 *
 * Fonctions pures, sans DOM ni reseau : elles tournent aussi bien dans le
 * navigateur que sous node --test.
 */

/** Frais kilometriques hors zone, par kilometre parcouru. */
export const FRAIS_KM_EUR = 0.7;

/** Part du total demandee a la reservation pour bloquer les dates. */
export const TAUX_ACOMPTE = 0.3;

/** Rayon d'intervention sans frais, par la route, depuis Domagne. */
export const RAYON_INCLUS_KM = 20;

/** Au-dela, l'intervention reste possible sur devis jusqu'a cette distance. */
export const RAYON_DEVIS_KM = 45;

/**
 * Tarif d'une visite selon le nombre de chats. Au-dela de quatre chats, le
 * tarif ne bouge plus.
 */
export const TARIF_VISITE_EUR = Object.freeze({
  1: 18,
  2: 18,
  3: 22,
  4: 26,
  5: 29,
});

/** Nombre de visites a partir duquel la remise sejour long s'applique. */
export const SEUIL_SEJOUR_LONG = 7;

/** Montant retire a chaque visite par une remise. */
export const REMISE_PAR_VISITE_EUR = 1;

/** Tarif d'une visite, pour un nombre de chats quelconque. */
export function tarifVisite(chats) {
  const nombre = Math.max(1, Math.trunc(Number(chats) || 1));
  return TARIF_VISITE_EUR[Math.min(nombre, 5)];
}

/** Arrondi au centime. Sans lui, 0,1 + 0,2 s'affiche a la quinzieme decimale. */
export function arrondirCentimes(montant) {
  return Math.round(Number(montant) * 100) / 100;
}

/** Montant en euros, au format francais : « 18,00 € ». */
export function formatEuros(montant) {
  return `${Number(montant).toFixed(2).replace('.', ',')} €`;
}

/**
 * Estimation d'un sejour.
 *
 * `solidaire` est le tarif Moustaches & Compagnie, `periode` la forte demande
 * du 15 juillet au 15 aout. Les deux ne se cumulent pas : en periode de forte
 * demande la remise solidaire ne s'applique pas, et `cumulBloque` le dit pour
 * que la page puisse l'expliquer au visiteur plutot que de retirer une remise
 * en silence.
 *
 * `km` est la distance hors zone, comptee en plus du rayon inclus. Elle est
 * facturee a l'aller-retour, a chaque visite.
 */
export function estimerSejour({ chats = 1, visites = 1, solidaire = false, periode = false, km = 0 } = {}) {
  const nombreVisites = Math.max(1, Math.trunc(Number(visites) || 1));
  const distance = Math.max(0, Number(km) || 0);

  const base = tarifVisite(chats);
  const remiseSejour = nombreVisites >= SEUIL_SEJOUR_LONG ? REMISE_PAR_VISITE_EUR : 0;
  const remiseSolidaire = solidaire && !periode ? REMISE_PAR_VISITE_EUR : 0;
  const cumulBloque = Boolean(solidaire && periode);

  const tarifNet = base - remiseSejour - remiseSolidaire;
  const supplementKm = distance * 2 * FRAIS_KM_EUR * nombreVisites;
  const total = arrondirCentimes(tarifNet * nombreVisites + supplementKm);
  const acompte = arrondirCentimes(total * TAUX_ACOMPTE);

  return {
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
