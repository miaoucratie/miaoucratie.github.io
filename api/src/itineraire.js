/**
 * Itinéraire de la tournée de l'appli Indisponibilités.
 *
 * Distances routières réelles uniquement : si une adresse n'est pas trouvée ou
 * si le trajet ne peut pas être calculé, on renvoie une erreur claire, jamais
 * une distance estimée à vol d'oiseau.
 *
 * Services gratuits et sans clé : la Base adresse nationale (IGN) pour situer
 * les adresses, Nominatim (OpenStreetMap) en secours, OSRM pour les trajets
 * en voiture.
 */

const BAN = "https://data.geopf.fr/geocodage/search";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OSRM = "https://router.project-osrm.org";
// Nominatim et OSRM refusent une requête sans identifiant d'application ;
// Cloudflare n'en envoie aucun par défaut.
const ENTETES = {
  "User-Agent": "MiaoucratieIndisponibilites/1.0 (contact via miaoucratie.fr)",
  Accept: "application/json",
};
const DELAI_MS = 12000;
// Nominatim accepte au plus une requête par seconde.
const INTERVALLE_NOMINATIM_MS = 1000;
const FRAICHEUR_ADRESSE_MS = 24 * 60 * 60 * 1000;
const ADRESSES_EN_CACHE = 500;

export const ETAPES_MAX = 10;

export class ErreurAdresse extends Error {
  constructor(adresse, message) {
    super(message);
    this.name = "ErreurAdresse";
    this.adresse = adresse;
  }
}

export class ErreurTrajet extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurTrajet";
  }
}

const positions = new Map();
let derniereRequeteNominatim = 0;

/** Vide le cache des adresses : réservé aux tests. */
export function viderCacheItineraire() {
  positions.clear();
  derniereRequeteNominatim = 0;
}

/**
 * Vérifie la liste d'étapes reçue. Renvoie un message d'erreur, ou null si
 * la liste est utilisable.
 */
export function erreurEtapes(adresses) {
  if (!Array.isArray(adresses) || adresses.length === 0) {
    return "Au moins une étape est requise.";
  }
  if (!adresses.every((a) => typeof a === "string" && a.trim())) {
    return "Adresses d'étape invalides.";
  }
  if (adresses.length > ETAPES_MAX) {
    return `Maximum ${ETAPES_MAX} étapes par tournée.`;
  }
  return null;
}

/** Distance et durée de la boucle départ → étapes dans l'ordre donné → départ. */
export async function boucle(depart, adresses, outils = {}) {
  const points = await situerTout([depart, ...adresses, depart], outils);
  const trajet = await trajetRoutier(points, outils);
  return { totalDistanceKm: trajet.distanceKm, totalDurationMin: trajet.dureeMin };
}

/**
 * Ordre de passage qui rend la boucle la plus courte. Recherche exacte, pas
 * une approximation : avec dix étapes au plus, toutes les possibilités sont
 * comparées.
 */
export async function meilleurOrdre(depart, adresses, outils = {}) {
  const points = await situerTout([depart, ...adresses, depart], outils);
  const matrice = await matriceRoutiere(points, outils);
  const { ordre, distance } = plusCourteBoucle(matrice);
  return {
    homeAddress: depart,
    orderedAddresses: ordre.map((i) => adresses[i - 1]),
    totalDistanceKm: distance,
  };
}

/**
 * Plus court chemin qui part du point 0, passe une fois par chaque étape
 * (1 à n-2) et finit au point n-1. Programmation dynamique sur les
 * sous-ensembles d'étapes : résultat exact, en quelques milliers d'opérations
 * pour dix étapes.
 */
export function plusCourteBoucle(matrice) {
  const n = matrice.length - 2;
  if (n < 1) {
    throw new ErreurTrajet("Au moins une étape est nécessaire pour optimiser une tournée.");
  }

  const arrivee = matrice.length - 1;
  const tailles = 1 << n;
  const cout = Array.from({ length: tailles }, () => new Float64Array(n).fill(Infinity));
  const precedent = Array.from({ length: tailles }, () => new Int8Array(n).fill(-1));

  for (let j = 0; j < n; j += 1) {
    cout[1 << j][j] = matrice[0][j + 1];
  }

  for (let ensemble = 1; ensemble < tailles; ensemble += 1) {
    for (let j = 0; j < n; j += 1) {
      if (!(ensemble & (1 << j))) continue;
      const base = cout[ensemble][j];
      if (base === Infinity) continue;
      for (let k = 0; k < n; k += 1) {
        if (ensemble & (1 << k)) continue;
        const suivant = ensemble | (1 << k);
        const total = base + matrice[j + 1][k + 1];
        if (total < cout[suivant][k]) {
          cout[suivant][k] = total;
          precedent[suivant][k] = j;
        }
      }
    }
  }

  const complet = tailles - 1;
  let meilleur = Infinity;
  let dernier = -1;
  for (let j = 0; j < n; j += 1) {
    const total = cout[complet][j] + matrice[j + 1][arrivee];
    if (total < meilleur) {
      meilleur = total;
      dernier = j;
    }
  }

  if (dernier < 0 || !Number.isFinite(meilleur)) {
    throw new ErreurTrajet("Aucun itinéraire routier trouvé pour cette tournée.");
  }

  const ordre = [];
  let ensemble = complet;
  let j = dernier;
  while (j >= 0) {
    ordre.unshift(j + 1);
    const avant = precedent[ensemble][j];
    ensemble &= ~(1 << j);
    j = avant;
  }

  return { ordre, distance: meilleur };
}

/* ------------------------------------------------------------------------ */
/* Adresses                                                                  */
/* ------------------------------------------------------------------------ */

async function situerTout(adresses, outils) {
  // Une à une : Nominatim n'accepte qu'une requête par seconde.
  const points = [];
  for (const adresse of adresses) {
    points.push(await situer(adresse, outils));
  }
  return points;
}

function cleAdresse(adresse) {
  return adresse.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

/**
 * Réécritures de la même adresse, de la plus précise à la moins précise.
 * Nominatim trouve mal certaines adresses françaises avec un numéro suivi de
 * « Rés », « Bât »… Chaque essai interroge le vrai service : ce n'est pas une
 * estimation de distance.
 */
export function variantesAdresse(adresse) {
  const variantes = [adresse];
  const sansNumero = adresse.replace(
    /^\s*\d+\s*(rés\.?|résidence|bât\.?|bâtiment|apt\.?|appartement)?\s*/i,
    ""
  );
  if (sansNumero !== adresse && sansNumero.trim()) {
    variantes.push(sansNumero.trim());
  }
  const morceaux = adresse.split(",").map((s) => s.trim()).filter(Boolean);
  if (morceaux.length >= 2) {
    variantes.push(morceaux.slice(-2).join(", "));
  }
  return variantes;
}

async function situer(adresse, { lire = fetch, attendre = pause } = {}) {
  const cle = cleAdresse(adresse);
  const connu = positions.get(cle);
  if (connu && connu.expire > Date.now()) return connu.point;
  if (connu) positions.delete(cle);

  const retenir = (point) => {
    if (positions.size >= ADRESSES_EN_CACHE) {
      positions.delete(positions.keys().next().value);
    }
    positions.set(cle, { point, expire: Date.now() + FRAICHEUR_ADRESSE_MS });
    return point;
  };

  let injoignable = false;
  try {
    const point = await interrogerBan(adresse, lire);
    if (point) return retenir(point);
  } catch {
    injoignable = true;
  }

  const codePostal = codePostalDe(adresse);
  for (const variante of variantesAdresse(adresse)) {
    try {
      const point = await interrogerNominatim(variante, codePostal, lire, attendre);
      if (point) return retenir(point);
    } catch {
      injoignable = true;
    }
  }

  throw new ErreurAdresse(
    adresse,
    injoignable ? "Service de géocodage injoignable." : "Adresse introuvable."
  );
}

function codePostalDe(adresse) {
  return adresse.match(/\b(\d{5})\b/)?.[1] ?? null;
}

/** Mots d'une adresse, sans accents ni mots de liaison ou de type de voie. */
const MOTS_VIDES = new Set([
  "rue", "allee", "all", "chemin", "chem", "avenue", "av", "boulevard", "bd",
  "place", "pl", "route", "rte", "impasse", "imp", "residence", "res", "hameau",
  "ham", "lieu", "dit", "la", "le", "les", "de", "du", "des", "d", "l", "et",
]);

function motsSignificatifs(texte) {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot && !MOTS_VIDES.has(mot) && !/^\d+[a-z]?$/.test(mot));
}

/**
 * Base adresse nationale : précise au numéro près sur les adresses françaises,
 * là où Nominatim retombe souvent sur le centre du bourg. Une réponse n'est
 * gardée que si elle correspond vraiment à l'adresse demandée :
 * - un numéro trouvé doit avoir le même code postal ;
 * - une rue trouvée doit avoir tous ses mots dans l'adresse demandée, sinon la
 *   base propose volontiers une rue voisine au nom approchant.
 */
async function interrogerBan(adresse, lire) {
  const url = new URL(BAN);
  url.searchParams.set("q", adresse);
  url.searchParams.set("limit", "1");

  const reponse = await lire(url.toString(), {
    headers: ENTETES,
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!reponse.ok) throw new Error("BAN injoignable");

  const resultat = (await reponse.json())?.features?.[0];
  if (!resultat) return null;

  const { type, score, postcode, street, name } = resultat.properties || {};
  const codePostal = codePostalDe(adresse);
  if (codePostal && postcode !== codePostal) return null;

  let retenu = false;
  if (type === "housenumber") {
    retenu = score >= (codePostal ? 0.35 : 0.6);
  } else if (type === "street" || type === "locality") {
    const demandes = new Set(motsSignificatifs(adresse));
    const trouves = motsSignificatifs(street || name || "");
    retenu = score >= 0.4 && trouves.length > 0 && trouves.every((mot) => demandes.has(mot));
  }
  if (!retenu) return null;

  const [lon, lat] = resultat.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function interrogerNominatim(requete, codePostal, lire, attendre) {
  const ecart = Date.now() - derniereRequeteNominatim;
  if (ecart < INTERVALLE_NOMINATIM_MS) {
    await attendre(INTERVALLE_NOMINATIM_MS - ecart);
  }

  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set("q", requete);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  try {
    const reponse = await lire(url.toString(), {
      headers: ENTETES,
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!reponse.ok) return null;

    const resultats = await reponse.json();
    if (!Array.isArray(resultats) || resultats.length === 0) return null;
    // Une commune homonyme dans un autre département est écartée : le code
    // postal trouvé doit être celui demandé.
    const trouve = resultats[0].address?.postcode;
    if (codePostal && trouve && trouve !== codePostal) return null;

    const lat = Number(resultats[0].lat);
    const lon = Number(resultats[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } finally {
    derniereRequeteNominatim = Date.now();
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------------ */
/* Trajets                                                                   */
/* ------------------------------------------------------------------------ */

async function interrogerOsrm(chemin, lire, messageVide) {
  let reponse;
  try {
    reponse = await lire(`${OSRM}${chemin}`, {
      headers: ENTETES,
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch {
    throw new ErreurTrajet("Service de calcul d'itinéraire injoignable.");
  }
  if (!reponse.ok) {
    throw new ErreurTrajet("Service de calcul d'itinéraire injoignable.");
  }

  const donnees = await reponse.json().catch(() => null);
  if (!donnees || donnees.code !== "Ok") {
    throw new ErreurTrajet(messageVide);
  }
  return donnees;
}

function coordonnees(points) {
  return points.map((p) => `${p.lon},${p.lat}`).join(";");
}

/** Un seul trajet continu qui passe par tous les points, dans l'ordre. */
async function trajetRoutier(points, { lire = fetch } = {}) {
  const donnees = await interrogerOsrm(
    `/route/v1/driving/${coordonnees(points)}?overview=false`,
    lire,
    "Aucun itinéraire routier trouvé pour cette tournée."
  );
  const trajet = donnees.routes?.[0];
  if (!trajet) {
    throw new ErreurTrajet("Aucun itinéraire routier trouvé pour cette tournée.");
  }
  return { distanceKm: trajet.distance / 1000, dureeMin: trajet.duration / 60 };
}

/** Distances routières entre chaque paire de points, en kilomètres. */
async function matriceRoutiere(points, { lire = fetch } = {}) {
  const donnees = await interrogerOsrm(
    `/table/v1/driving/${coordonnees(points)}?annotations=distance`,
    lire,
    "Aucun itinéraire routier trouvé pour cette tournée."
  );
  if (!Array.isArray(donnees.distances)) {
    throw new ErreurTrajet("Aucun itinéraire routier trouvé pour cette tournée.");
  }

  const matrice = donnees.distances.map((ligne) =>
    ligne.map((metres) => (metres == null ? NaN : metres / 1000))
  );
  if (matrice.some((ligne) => ligne.some((km) => !Number.isFinite(km)))) {
    throw new ErreurTrajet("Aucun itinéraire routier trouvé pour cette tournée.");
  }
  return matrice;
}
