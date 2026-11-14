/**
 * Agenda du jour de l'appli Indisponibilités.
 *
 * Lit le flux iCal privé de l'agenda Google et renvoie les événements d'une
 * journée, à l'heure de Paris. Gère les événements sur la journée entière, sur
 * plusieurs jours, et les répétitions : les gardes sont saisies comme des
 * événements « journée entière » répétés chaque jour, il faut donc dérouler la
 * répétition pour les voir au milieu de la garde, pas seulement le premier jour.
 *
 * Seuls sortent les événements qui demandent de se déplacer : créés par la
 * propriétaire de l'agenda et avec une adresse physique. Les invitations
 * reçues, les formations en ligne et les appels n'apparaissent pas.
 */

const FUSEAU = "Europe/Paris";
const JOUR_MS = 24 * 60 * 60 * 1000;
const PROPRIETAIRE = "miaoucratie@gmail.com";

/** Durée pendant laquelle un flux lu reste servi sans être relu. */
const FRAICHEUR_MS = 5 * 60 * 1000;

/** Répétitions déroulées au plus pour atteindre une date. */
const ITERATIONS_MAX = 20000;

let cache = null;

export class ErreurAgenda extends Error {
  constructor(code) {
    super(code);
    this.name = "ErreurAgenda";
    this.code = code;
  }
}

/** Date du jour à Paris, au format AAAA-MM-JJ. */
export function aujourdhuiAParis(maintenant = new Date()) {
  return cleJourParis(maintenant);
}

/**
 * Événements de la journée `date` (AAAA-MM-JJ, heure de Paris).
 * `lire` est injectable pour les tests ; par défaut, `fetch`.
 */
export async function evenementsDuJour(urlIcal, date, { lire = fetch, maintenant = Date.now() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dateValide(date)) {
    throw new ErreurAgenda("DATE_INVALIDE");
  }

  const evenements = await evenementsEnCache(urlIcal, lire, maintenant);
  return evenementsDeLaJournee(evenements, date);
}

/** État de la lecture de l'agenda, sans donnée personnelle. */
export async function etatAgenda(urlIcal, { lire = fetch, maintenant = Date.now() } = {}) {
  const evenements = await evenementsEnCache(urlIcal, lire, maintenant);
  return {
    ok: true,
    reglesNonComprises: evenements.filter((e) => e.regle?.nonGeree).length,
  };
}

/** Vide le cache : réservé aux tests. */
export function viderCacheAgenda() {
  cache = null;
}

async function evenementsEnCache(urlIcal, lire, maintenant) {
  if (cache && cache.url === urlIcal && maintenant - cache.luLe < FRAICHEUR_MS) {
    return cache.evenements;
  }

  try {
    const evenements = await lireFlux(urlIcal, lire);
    cache = { url: urlIcal, luLe: maintenant, evenements };
    return evenements;
  } catch (erreur) {
    // Dernière lecture réussie
    if (cache && cache.url === urlIcal) {
      return cache.evenements;
    }
    throw erreur;
  }
}

async function lireFlux(urlIcal, lire) {
  let reponse;
  try {
    reponse = await lire(urlIcal, {
      headers: { Accept: "text/calendar" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ErreurAgenda("AGENDA_INJOIGNABLE");
  }

  if (!reponse.ok) {
    throw new ErreurAgenda("AGENDA_INJOIGNABLE");
  }

  const texte = await reponse.text();
  if (!texte.includes("BEGIN:VCALENDAR")) {
    throw new ErreurAgenda("AGENDA_ILLISIBLE");
  }

  return analyserIcal(texte);
}

/* ------------------------------------------------------------------------ */
/* Lecture du format iCal                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Transforme le texte iCal en événements. Les modifications d'une occurrence
 * (RECURRENCE-ID) sont rattachées à l'événement répété qu'elles remplacent.
 */
export function analyserIcal(texte) {
  const lignes = texte.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const bruts = [];
  let courant = null;
  let profondeur = 0;

  for (const ligne of lignes) {
    if (ligne === "BEGIN:VEVENT") {
      courant = { proprietes: [] };
      profondeur = 0;
      continue;
    }
    if (!courant) continue;
    if (ligne === "END:VEVENT") {
      bruts.push(courant);
      courant = null;
      continue;
    }
    // Les rappels (VALARM) sont imbriqués dans l'événement : on les saute.
    if (ligne.startsWith("BEGIN:")) {
      profondeur += 1;
      continue;
    }
    if (ligne.startsWith("END:")) {
      profondeur -= 1;
      continue;
    }
    if (profondeur > 0) continue;

    const propriete = lirePropriete(ligne);
    if (propriete) courant.proprietes.push(propriete);
  }

  const parUid = new Map();
  const modifications = [];

  for (const brut of bruts) {
    const evenement = construireEvenement(brut.proprietes);
    if (!evenement) continue;
    if (evenement.remplace) {
      modifications.push(evenement);
    } else if (!parUid.has(evenement.uid)) {
      parUid.set(evenement.uid, evenement);
    }
  }

  for (const modification of modifications) {
    const parent = parUid.get(modification.uid);
    if (parent) {
      parent.modifications.set(modification.remplace, modification);
    } else {
      // Occurrence modifiée dont l'événement d'origine n'est pas dans le flux :
      // elle reste un événement à part entière.
      parUid.set(`${modification.uid}#${modification.remplace}`, { ...modification, remplace: null });
    }
  }

  return [...parUid.values()];
}

/** Seules propriétés utiles à l'appli : les autres lignes ne sont pas analysées. */
const PROPRIETES_UTILES = new Set([
  "UID", "SUMMARY", "LOCATION", "ORGANIZER",
  "DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE", "RECURRENCE-ID",
]);

function lirePropriete(ligne) {
  const finNom = ligne.search(/[;:]/);
  if (finNom < 1 || !PROPRIETES_UTILES.has(ligne.slice(0, finNom).toUpperCase())) return null;

  // Le nom et les paramètres s'arrêtent au premier « : » hors guillemets.
  let guillemets = false;
  let separateur = -1;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (c === '"') guillemets = !guillemets;
    else if (c === ":" && !guillemets) {
      separateur = i;
      break;
    }
  }
  if (separateur < 0) return null;

  const tete = ligne.slice(0, separateur).split(";");
  const parametres = {};
  for (const morceau of tete.slice(1)) {
    const egal = morceau.indexOf("=");
    if (egal > 0) {
      parametres[morceau.slice(0, egal).toUpperCase()] = morceau.slice(egal + 1).replace(/^"|"$/g, "");
    }
  }

  return { nom: tete[0].toUpperCase(), parametres, valeur: ligne.slice(separateur + 1) };
}

function texteIcal(valeur) {
  if (valeur == null) return undefined;
  const texte = valeur
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
  return texte || undefined;
}

function construireEvenement(proprietes) {
  const une = (nom) => proprietes.find((p) => p.nom === nom);
  const toutes = (nom) => proprietes.filter((p) => p.nom === nom);

  const debutBrut = une("DTSTART");
  if (!debutBrut) return null;

  const debut = lireDate(debutBrut);
  if (!debut) return null;

  let fin = null;
  const finBrute = une("DTEND");
  const duree = une("DURATION");
  if (finBrute) {
    fin = lireDate(finBrute);
  } else if (duree) {
    const ms = dureeEnMs(duree.valeur);
    if (ms != null) {
      fin = debut.journee
        ? { journee: true, jour: ajouterJours(debut.jour, Math.round(ms / JOUR_MS)) }
        : { journee: false, instant: debut.instant + ms, fuseau: debut.fuseau, mur: null };
    }
  }
  if (!fin) {
    fin = debut.journee
      ? { journee: true, jour: ajouterJours(debut.jour, 1) }
      : { ...debut };
  }

  const organisateur = une("ORGANIZER");
  const courriel = organisateur
    ? organisateur.valeur.replace(/^mailto:/i, "").trim().toLowerCase()
    : "";

  const exclusions = new Set();
  for (const ex of toutes("EXDATE")) {
    for (const valeur of ex.valeur.split(",")) {
      const date = lireDate({ parametres: ex.parametres, valeur });
      if (date) exclusions.add(cleOccurrence(date));
    }
  }

  const remplaceBrut = une("RECURRENCE-ID");
  let remplace = remplaceBrut ? lireDate(remplaceBrut) : null;
  // Remplacement daté de 1970 : jour de la visite
  if (remplace && (remplace.journee ? remplace.jour < "1980" : dateMur(remplace.mur || murDansFuseau(remplace.instant, FUSEAU)) < "1980")) {
    remplace = debut;
  }
  const regleBrute = une("RRULE");

  return {
    uid: une("UID")?.valeur || `sans-uid-${Math.random().toString(36).slice(2)}`,
    titre: texteIcal(une("SUMMARY")?.valeur),
    lieu: texteIcal(une("LOCATION")?.valeur),
    proprietaire: !courriel || courriel === PROPRIETAIRE,
    debut,
    fin,
    regle: regleBrute && !remplace ? lireRegle(regleBrute.valeur) : null,
    exclusions,
    remplace: remplace ? cleOccurrence(remplace) : null,
    modifications: new Map(),
  };
}

/**
 * Une date iCal : journée entière (AAAAMMJJ), instant UTC (…Z), heure locale
 * d'un fuseau (TZID), ou heure « flottante », lue à l'heure de Paris.
 */
function lireDate({ parametres = {}, valeur }) {
  const v = String(valeur).trim();
  const jour = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (jour || parametres.VALUE === "DATE") {
    if (!jour) return null;
    return { journee: true, jour: `${jour[1]}-${jour[2]}-${jour[3]}` };
  }

  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const mur = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])];

  if (m[7] === "Z") {
    return {
      journee: false,
      instant: Date.UTC(mur[0], mur[1] - 1, mur[2], mur[3], mur[4], mur[5]),
      fuseau: parametres.TZID && fuseauConnu(parametres.TZID) ? parametres.TZID : FUSEAU,
      mur: null,
    };
  }

  const fuseau = parametres.TZID && fuseauConnu(parametres.TZID) ? parametres.TZID : FUSEAU;
  return heureLocale(mur, fuseau);
}

/** Heure murale d'un fuseau, instant calculé à la première lecture. */
function heureLocale(mur, fuseau) {
  let instant = null;
  return {
    journee: false,
    fuseau,
    mur,
    get instant() {
      if (instant === null) instant = instantDepuisHeureLocale(mur, fuseau);
      return instant;
    },
  };
}

function dureeEnMs(valeur) {
  const m = String(valeur).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const signe = m[1] === "-" ? -1 : 1;
  const [semaines, jours, heures, minutes, secondes] = m.slice(2).map((x) => Number(x || 0));
  return signe * ((((semaines * 7 + jours) * 24 + heures) * 60 + minutes) * 60 + secondes) * 1000;
}

/** Clé d'une occurrence : la date pour une journée entière, le jour à Paris sinon. */
function cleOccurrence(date) {
  return date.journee ? date.jour : cleJourParis(new Date(date.instant));
}

/* ------------------------------------------------------------------------ */
/* Répétitions (RRULE)                                                       */
/* ------------------------------------------------------------------------ */

const JOURS_SEMAINE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function lireRegle(texte) {
  const regle = {};
  for (const morceau of texte.split(";")) {
    const [cle, valeur] = morceau.split("=");
    if (cle && valeur != null) regle[cle.toUpperCase()] = valeur;
  }

  const frequence = regle.FREQ;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequence)) {
    return { nonGeree: true };
  }

  // Parties de règle prises en charge
  const comprises = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);
  if (Object.keys(regle).some((cle) => !comprises.has(cle))) {
    return { nonGeree: true };
  }

  let jours = null;
  let joursDuMois = null;
  if (regle.BYDAY) {
    jours = regle.BYDAY.split(",").map((j) => {
      const m = j.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
      return m ? { rang: m[1] ? Number(m[1]) : null, jour: JOURS_SEMAINE.indexOf(m[2]) } : null;
    });
    if (jours.some((j) => !j)) return { nonGeree: true };
    if (frequence === "DAILY" && jours.some((j) => j.rang != null)) return { nonGeree: true };
  }
  if (regle.BYMONTHDAY) {
    joursDuMois = regle.BYMONTHDAY.split(",").map(Number);
    if (joursDuMois.some((j) => !Number.isInteger(j) || j === 0)) return { nonGeree: true };
  }

  let jusqua = null;
  if (regle.UNTIL) {
    jusqua = lireDate({ valeur: regle.UNTIL });
    if (!jusqua) return { nonGeree: true };
  }

  return {
    frequence,
    intervalle: Math.max(1, Number(regle.INTERVAL || 1)),
    nombre: regle.COUNT ? Number(regle.COUNT) : null,
    jusqua,
    jours,
    joursDuMois,
    mois: regle.BYMONTH ? regle.BYMONTH.split(",").map(Number) : null,
  };
}

/**
 * Jours (AAAA-MM-JJ, dans le calendrier de l'événement) où une répétition
 * commence, du premier jour jusqu'à `limite` incluse.
 */
function joursDeRepetition(regle, premierJour, limite, plancher) {
  // Le premier jour compte toujours
  const resultats = premierJour <= limite ? [premierJour] : [];
  let compte = 1;
  let iterations = 0;

  const accepter = (jour) => {
    if (jour <= premierJour) return true;
    if (regle.nombre != null && compte >= regle.nombre) return false;
    if (jour > limite) return false;
    compte += 1;
    resultats.push(jour);
    return true;
  };

  const [an0, mois0] = premierJour.split("-").map(Number);

  // Sans nombre d'occurrences à compter, inutile de dérouler depuis le début :
  // on repart de la période qui précède le plancher.
  let depart = 0;
  if (regle.nombre == null && plancher > premierJour) {
    const [anP, moisP] = plancher.split("-").map(Number);
    const ecart =
      regle.frequence === "DAILY" ? joursEntre(premierJour, plancher)
        : regle.frequence === "WEEKLY" ? Math.floor(joursEntre(premierJour, plancher) / 7)
          : regle.frequence === "MONTHLY" ? (anP - an0) * 12 + (moisP - mois0)
            : anP - an0;
    depart = Math.max(0, Math.floor(ecart / regle.intervalle) - 1) * regle.intervalle;
  }

  for (let periode = depart; iterations < ITERATIONS_MAX; periode += regle.intervalle) {
    iterations += 1;
    const candidats = candidatsDeLaPeriode(regle, premierJour, an0, mois0, periode);
    if (!candidats) break;
    if (candidats.debutPeriode > limite) break;
    let continuer = true;
    for (const jour of candidats.jours) {
      if (!accepter(jour)) {
        continuer = false;
        break;
      }
    }
    if (!continuer) break;
  }

  return resultats;
}

function candidatsDeLaPeriode(regle, premierJour, an0, mois0, periode) {
  if (regle.frequence === "DAILY") {
    const jour = ajouterJours(premierJour, periode);
    if (regle.mois && !regle.mois.includes(Number(jour.slice(5, 7)))) {
      return { debutPeriode: jour, jours: [] };
    }
    if (regle.jours && !regle.jours.some((j) => j.jour === jourSemaine(jour))) {
      return { debutPeriode: jour, jours: [] };
    }
    if (regle.joursDuMois && !correspondJourDuMois(jour, regle.joursDuMois)) {
      return { debutPeriode: jour, jours: [] };
    }
    return { debutPeriode: jour, jours: [jour] };
  }

  if (regle.frequence === "WEEKLY") {
    // Semaine commençant le lundi qui contient le premier jour.
    const lundi = ajouterJours(premierJour, -((jourSemaine(premierJour) + 6) % 7));
    const debut = ajouterJours(lundi, periode * 7);
    const voulus = regle.jours ? regle.jours.map((j) => j.jour) : [jourSemaine(premierJour)];
    const jours = [];
    for (let i = 0; i < 7; i += 1) {
      const jour = ajouterJours(debut, i);
      if (voulus.includes(jourSemaine(jour))) jours.push(jour);
    }
    return { debutPeriode: debut, jours };
  }

  if (regle.frequence === "MONTHLY") {
    const total = mois0 - 1 + periode;
    const an = an0 + Math.floor(total / 12);
    const mois = (total % 12) + 1;
    const debut = `${an}-${pad(mois)}-01`;
    if (regle.mois && !regle.mois.includes(mois)) return { debutPeriode: debut, jours: [] };
    return { debutPeriode: debut, jours: joursDuMoisVoulus(regle, an, mois, premierJour) };
  }

  // YEARLY
  const an = an0 + periode;
  const debut = `${an}-01-01`;
  const moisVoulus = regle.mois || [mois0];
  const jours = [];
  for (const mois of moisVoulus) {
    jours.push(...joursDuMoisVoulus(regle, an, mois, premierJour));
  }
  return { debutPeriode: debut, jours: jours.sort() };
}

function joursDuMoisVoulus(regle, an, mois, premierJour) {
  const nbJours = new Date(Date.UTC(an, mois, 0)).getUTCDate();
  const jours = [];

  if (regle.jours) {
    for (const { rang, jour } of regle.jours) {
      const correspondants = [];
      for (let d = 1; d <= nbJours; d += 1) {
        const date = `${an}-${pad(mois)}-${pad(d)}`;
        if (jourSemaine(date) === jour) correspondants.push(date);
      }
      if (rang == null) jours.push(...correspondants);
      else {
        const choisi = rang > 0 ? correspondants[rang - 1] : correspondants[correspondants.length + rang];
        if (choisi) jours.push(choisi);
      }
    }
    const filtres = regle.joursDuMois ? jours.filter((j) => correspondJourDuMois(j, regle.joursDuMois)) : jours;
    return [...new Set(filtres)].sort();
  }

  const voulus = regle.joursDuMois || [Number(premierJour.slice(8, 10))];
  for (const v of voulus) {
    const d = v > 0 ? v : nbJours + v + 1;
    if (d >= 1 && d <= nbJours) jours.push(`${an}-${pad(mois)}-${pad(d)}`);
  }
  return [...new Set(jours)].sort();
}

function correspondJourDuMois(jour, joursDuMois) {
  const [an, mois, d] = jour.split("-").map(Number);
  const nbJours = new Date(Date.UTC(an, mois, 0)).getUTCDate();
  return joursDuMois.some((v) => (v > 0 ? v === d : nbJours + v + 1 === d));
}

function regleTerminee(regle, occurrence) {
  if (!regle.jusqua) return false;
  if (regle.jusqua.journee) {
    const jour = occurrence.journee ? occurrence.jour : cleJourParis(new Date(occurrence.instant));
    return jour > regle.jusqua.jour;
  }
  const instant = occurrence.journee ? Date.parse(`${occurrence.jour}T00:00:00Z`) : occurrence.instant;
  return instant > regle.jusqua.instant;
}

/* ------------------------------------------------------------------------ */
/* Sélection de la journée                                                   */
/* ------------------------------------------------------------------------ */

function evenementsDeLaJournee(evenements, date) {
  const debutJour = minuitParis(date);
  const finJour = minuitParis(ajouterJours(date, 1));
  const bornes = { veille: ajouterJours(date, -1), lendemain: ajouterJours(date, 1) };
  const sortie = [];

  for (const evenement of evenements) {
    for (const occurrence of occurrencesAutourDe(evenement, date, bornes)) {
      // L'appli ne sert qu'aux déplacements : un événement sans adresse
      // physique (formation en ligne, appel, visio) n'y apparaît pas.
      if (!evenement.proprietaire || !adressePhysique(occurrence.source.lieu)) continue;
      if (occurrence.debut.journee) {
        if (date >= occurrence.debut.jour && date < occurrence.fin.jour) {
          sortie.push(versSortie(occurrence, evenement));
        }
      } else if (occurrence.debut.instant < finJour && occurrence.fin.instant > debutJour) {
        sortie.push(versSortie(occurrence, evenement));
      }
    }
  }

  // Tri sur les dates ISO
  sortie.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });

  return sortie;
}

const EN_LIGNE = /https?:\/\/|www\.|zoom|teams|google meet|meet\.google|visio|en ligne|webinaire|webinar|distanciel|skype|whatsapp/i;

/**
 * Le lieu est-il un endroit où se rendre ? Ni un lien de visio, ni un numéro
 * de téléphone, ni une mention « en ligne ».
 */
export function adressePhysique(lieu) {
  if (!lieu || !lieu.trim()) return false;
  if (EN_LIGNE.test(lieu)) return false;
  if (/^[\d\s+().-]+$/.test(lieu.trim())) return false;
  return /\p{L}/u.test(lieu);
}

/**
 * Occurrences d'un événement qui peuvent toucher la journée : l'événement
 * lui-même s'il n'est pas répété, sinon les répétitions qui commencent assez
 * tôt pour la chevaucher, exclusions retirées et modifications appliquées.
 */
function occurrencesAutourDe(evenement, date, bornes) {
  const { debut, fin } = evenement;

  if (!evenement.regle) {
    // Tri rapide sur la date murale, sans conversion : un événement qui
    // commence plus d'un jour après la journée ne peut pas la toucher.
    if (!debut.journee && debut.mur && dateMur(debut.mur) > bornes.lendemain) return [];
    if (!fin.journee && fin.mur && dateMur(fin.mur) < bornes.veille) return [];
    return [{ debut, fin, source: evenement, suffixe: "" }];
  }
  if (evenement.regle.nonGeree) {
    return [{ debut, fin, source: evenement, suffixe: "" }];
  }

  const resultats = [];
  const dureeJours = debut.journee ? Math.max(1, joursEntre(debut.jour, fin.jour)) : 0;
  const dureeMs = debut.journee ? 0 : fin.instant - debut.instant;
  const premierJour = debut.journee ? debut.jour : (debut.mur ? dateMur(debut.mur) : cleJourDansFuseau(debut.instant, debut.fuseau));
  const margeJours = debut.journee ? dureeJours : Math.ceil(dureeMs / JOUR_MS) + 1;
  const limite = ajouterJours(date, 1);
  const plancher = ajouterJours(date, -margeJours - 1);

  const vus = new Set();
  const jusqua = evenement.regle.jusqua;
  const jourFin = jusqua ? (jusqua.journee ? jusqua.jour : cleJourParis(new Date(jusqua.instant))) : null;
  const repetitions = jourFin && jourFin < plancher && premierJour < plancher
    ? []
    : joursDeRepetition(evenement.regle, premierJour, limite, plancher);

  for (const jour of repetitions) {
    if (jour < plancher) continue;

    let occurrence;
    if (debut.journee) {
      occurrence = { debut: { journee: true, jour }, fin: { journee: true, jour: ajouterJours(jour, dureeJours) } };
    } else {
      const mur = debut.mur || murDansFuseau(debut.instant, debut.fuseau);
      const [an, mois, j] = jour.split("-").map(Number);
      const instant = instantDepuisHeureLocale([an, mois, j, mur[3], mur[4], mur[5]], debut.fuseau);
      occurrence = {
        debut: { journee: false, instant, fuseau: debut.fuseau },
        fin: { journee: false, instant: instant + dureeMs, fuseau: debut.fuseau },
      };
    }

    if (jour !== premierJour && regleTerminee(evenement.regle, occurrence.debut)) continue;

    const cle = cleOccurrence(occurrence.debut);
    if (evenement.exclusions.has(cle)) continue;
    vus.add(cle);

    const modification = evenement.modifications.get(cle);
    if (modification) {
      resultats.push({ debut: modification.debut, fin: modification.fin, source: modification, suffixe: `-${cle}` });
    } else {
      resultats.push({ ...occurrence, source: evenement, suffixe: `-${cle}` });
    }
  }

  // Une occurrence déplacée sur un autre jour apparaît à sa nouvelle date.
  for (const [cle, modification] of evenement.modifications) {
    if (vus.has(cle) || evenement.exclusions.has(cle)) continue;
    resultats.push({ debut: modification.debut, fin: modification.fin, source: modification, suffixe: `-${cle}` });
  }

  return resultats;
}

function versSortie(occurrence, evenement) {
  const source = occurrence.source;
  const commun = {
    id: `${evenement.uid}${occurrence.suffixe}`,
    summary: source.titre || "(Sans titre)",
  };

  if (occurrence.debut.journee) {
    return {
      ...commun,
      start: occurrence.debut.jour,
      end: occurrence.fin.jour,
      allDay: true,
      location: source.lieu,
    };
  }

  const debut = new Date(occurrence.debut.instant);
  const fin = new Date(occurrence.fin.instant);
  return {
    ...commun,
    start: debut.toISOString(),
    end: fin.toISOString(),
    startTime: heureParis(debut),
    endTime: heureParis(fin),
    allDay: false,
    location: source.lieu,
  };
}

/* ------------------------------------------------------------------------ */
/* Dates et fuseaux                                                          */
/* ------------------------------------------------------------------------ */

const formateurs = new Map();

function formateur(fuseau) {
  if (!formateurs.has(fuseau)) {
    formateurs.set(
      fuseau,
      new Intl.DateTimeFormat("en-US", {
        timeZone: fuseau,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  }
  return formateurs.get(fuseau);
}

function fuseauConnu(fuseau) {
  if (fuseau === FUSEAU) return true;
  try {
    formateur(fuseau);
    return true;
  } catch {
    return false;
  }
}

/**
 * Décalage de Paris sur l'heure universelle, par la règle européenne : heure
 * d'été du dernier dimanche de mars au dernier dimanche d'octobre, changement
 * à 1 h en temps universel.
 */
function decalageParisMs(instant) {
  const an = new Date(instant).getUTCFullYear();
  const debutEte = Date.UTC(an, 2, 31 - new Date(Date.UTC(an, 2, 31)).getUTCDay(), 1);
  const finEte = Date.UTC(an, 9, 31 - new Date(Date.UTC(an, 9, 31)).getUTCDay(), 1);
  return (instant >= debutEte && instant < finEte ? 2 : 1) * 60 * 60 * 1000;
}

function murDansFuseau(instant, fuseau) {
  if (fuseau === FUSEAU) {
    const d = new Date(instant + decalageParisMs(instant));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
  }
  const parties = Object.fromEntries(
    formateur(fuseau).formatToParts(new Date(instant)).map((p) => [p.type, p.value])
  );
  return [
    Number(parties.year),
    Number(parties.month),
    Number(parties.day),
    Number(parties.hour) % 24,
    Number(parties.minute),
    Number(parties.second),
  ];
}

function decalageMs(instant, fuseau) {
  if (fuseau === FUSEAU) return decalageParisMs(instant);
  const m = murDansFuseau(instant, fuseau);
  return Date.UTC(m[0], m[1] - 1, m[2], m[3], m[4], m[5]) - instant;
}

/** Instant réel où l'heure murale donnée a lieu dans le fuseau. */
function instantDepuisHeureLocale(mur, fuseau) {
  const estimation = Date.UTC(mur[0], mur[1] - 1, mur[2], mur[3], mur[4], mur[5]);
  const premier = estimation - decalageMs(estimation, fuseau);
  const second = estimation - decalageMs(premier, fuseau);
  return second;
}

function cleJourDansFuseau(instant, fuseau) {
  return dateMur(murDansFuseau(instant, fuseau));
}

function cleJourParis(date) {
  return cleJourDansFuseau(date.getTime(), FUSEAU);
}

function dateMur(mur) {
  return `${mur[0]}-${pad(mur[1])}-${pad(mur[2])}`;
}

function heureParis(date) {
  const m = murDansFuseau(date.getTime(), FUSEAU);
  return `${pad(m[3])}:${pad(m[4])}`;
}

function minuitParis(jour) {
  const [an, mois, j] = jour.split("-").map(Number);
  return instantDepuisHeureLocale([an, mois, j, 0, 0, 0], FUSEAU);
}

function ajouterJours(jour, n) {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function joursEntre(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / JOUR_MS);
}

function jourSemaine(jour) {
  return new Date(`${jour}T12:00:00Z`).getUTCDay();
}

function dateValide(jour) {
  const d = new Date(`${jour}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
