export const FREQUENCE_OPTIONS = Object.freeze([
  "1 visite par jour",
  "2 visites par jour",
  "autre",
]);

export const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_FR_REGEX = /^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function safeText(value = "", maxLength = 2000) {
  return normalizeWhitespace(String(value)).slice(0, maxLength);
}

export function safeMultilineText(value = "", maxLength = 4000) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export function parseIsoDateParts(value = "") {
  if (!DATE_ISO_REGEX.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, date };
}

export function isoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeDateInput(value = "") {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return isoFromDate(value);
  }

  const raw = safeText(value, 32);

  if (!raw) {
    return "";
  }

  if (parseIsoDateParts(raw)) {
    return raw;
  }

  const frMatch = raw.match(DATE_FR_REGEX);
  if (frMatch) {
    const [, day, month, year] = frMatch;
    const isoValue = `${year}-${month}-${day}`;
    return parseIsoDateParts(isoValue) ? isoValue : "";
  }

  return "";
}

export function isIsoDate(value = "") {
  return Boolean(parseIsoDateParts(normalizeDateInput(value)));
}

export function toDate(value) {
  const normalized = normalizeDateInput(value);
  return parseIsoDateParts(normalized)?.date ?? null;
}

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateRangeOverlaps(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

export function mergeRanges(ranges = []) {
  const validRanges = ranges
    .filter((range) => isIsoDate(range.startDate) && isIsoDate(range.endDate))
    .map((range) => ({
      ...range,
      startDate: normalizeDateInput(range.startDate),
      endDate: normalizeDateInput(range.endDate),
      comment: normalizeWhitespace(range.comment || ""),
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (!validRanges.length) {
    return [];
  }

  const merged = [validRanges[0]];

  for (const current of validRanges.slice(1)) {
    const last = merged[merged.length - 1];
    const lastEnd = toDate(last.endDate);

    if (!lastEnd) {
      continue;
    }

    const lastEndPlusOne = new Date(lastEnd);
    lastEndPlusOne.setUTCDate(lastEndPlusOne.getUTCDate() + 1);

    if (current.startDate <= isoFromDate(lastEndPlusOne)) {
      if (current.endDate > last.endDate) {
        last.endDate = current.endDate;
      }
      last.comment = normalizeWhitespace([last.comment, current.comment].filter(Boolean).join(" · "));
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/* Décalage ISO en UTC */
export function shiftIsoDay(isoDate, step) {
  const date = toDate(isoDate);

  if (!date) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + step);
  return isoFromDate(date);
}

/* Parties d'une date ISO */
export function partsIso(iso) {
  const [annee, mois, jour] = iso.split("-").map(Number);
  return { annee, mois, jour };
}

/* Jours d'une période */
export function nombreDeJours(start, end) {
  const a = partsIso(start);
  const b = partsIso(end);
  const depart = Date.UTC(a.annee, a.mois - 1, a.jour);
  const arrivee = Date.UTC(b.annee, b.mois - 1, b.jour);
  return Math.round((arrivee - depart) / 86400000) + 1;
}

/* Jours de plusieurs morceaux */
export function compterJours(segments) {
  return segments.reduce((total, segment) => total + nombreDeJours(segment.startDate, segment.endDate), 0);
}

/* Jours hors couverture */
export function complementSegments(start, end, couverts) {
  const trous = [];
  let curseur = start;

  for (const segment of couverts) {
    if (segment.startDate > curseur) {
      trous.push({ startDate: curseur, endDate: shiftIsoDay(segment.startDate, -1) });
    }
    curseur = shiftIsoDay(segment.endDate, 1);
  }

  if (curseur && curseur <= end) {
    trous.push({ startDate: curseur, endDate: end });
  }

  return trous;
}

/* Morceaux couverts */
export function availableSegments(startDate, endDate, unavailableRanges = []) {
  const start = normalizeDateInput(startDate);
  const end = normalizeDateInput(endDate);

  if (!isIsoDate(start) || !isIsoDate(end) || end < start) {
    return [];
  }

  const blocking = mergeRanges(unavailableRanges).filter((range) =>
    dateRangeOverlaps(start, end, range.startDate, range.endDate)
  );

  const segments = [];
  let cursor = start;

  for (const range of blocking) {
    if (cursor > end) {
      break;
    }

    if (range.startDate > cursor) {
      segments.push({ startDate: cursor, endDate: shiftIsoDay(range.startDate, -1) });
    }

    if (range.endDate >= cursor) {
      cursor = shiftIsoDay(range.endDate, 1);
    }
  }

  if (cursor && cursor <= end) {
    segments.push({ startDate: cursor, endDate: end });
  }

  return segments;
}

export function sanitizeReservationPayload(payload = {}) {
  const catCount = Number.parseInt(String(payload.nombreChats ?? payload.nombre_chats ?? "").trim(), 10);
  const frequencyRaw = normalizeWhitespace(payload.frequence ?? payload.frequency ?? "");
  const frequency = frequencyRaw === "Autre besoin à préciser" ? "autre" : frequencyRaw;

  return {
    nom: safeText(payload.nom, 100),
    prenom: safeText(payload.prenom, 100),
    telephone: safeText(payload.telephone ?? payload.phone ?? "", 30),
    whatsapp: safeText(payload.whatsapp ?? payload.whatsapp_number ?? "", 30),
    email: safeText(payload.email ?? payload.contact_email ?? "", 160).toLowerCase(),
    commune: safeText(payload.commune, 150),
    communeCode: safeText(payload.communeCode || payload.commune_code || "", 10),
    communeCodePostal: safeText(payload.communeCodePostal || payload.commune_code_postal || "", 10),
    adresse: safeText(payload.adresse ?? "", 200),
    nombreChats: Number.isFinite(catCount) ? catCount : NaN,
    dateDebut: normalizeDateInput(payload.dateDebut ?? payload.date_debut ?? ""),
    dateFin: normalizeDateInput(payload.dateFin ?? payload.date_fin ?? ""),
    frequence: frequency,
    autreFrequence: safeText(payload.autreFrequence ?? payload.frequence_autre ?? "", 160),
    observations: safeMultilineText(payload.observations ?? "", 1500),
    startedAt: Number.parseInt(String(payload.startedAt ?? payload.started_at ?? ""), 10),
    honeypot: safeText(payload.website ?? payload.honeypot ?? "", 255),
  };
}

export function sanitizeUnavailabilityPayload(payload = {}) {
  return {
    id: payload.id ? Number.parseInt(String(payload.id), 10) : null,
    startDate: normalizeDateInput(payload.startDate ?? payload.start_date ?? ""),
    endDate: normalizeDateInput(payload.endDate ?? payload.end_date ?? ""),
    comment: safeText(payload.comment ?? "", 160),
  };
}

/* Messages des dates */
const MESSAGES_DATES = Object.freeze({
  debutInvalide: "Merci de choisir une date de début valide.",
  debutPassee: "Les dates passées ne sont pas disponibles.",
  finInvalide: "Merci de choisir une date de fin valide.",
  finAvantDebut: "La date de fin doit être postérieure ou égale à la date de début.",
});

/* Premier jour réservable */
function dateMinimale(options = {}) {
  return options.minDate || todayIso(options.now ? new Date(options.now) : new Date());
}

/* Dates en cours de saisie */
export function validerDatesEnCours(dateDebut = "", dateFin = "", options = {}) {
  const errors = {};
  const saisi = (valeur) => Boolean(safeText(valeur ?? "", 32));
  const debut = normalizeDateInput(dateDebut ?? "");
  const fin = normalizeDateInput(dateFin ?? "");

  if (saisi(dateDebut) && !debut) {
    errors.dateDebut = MESSAGES_DATES.debutInvalide;
  } else if (debut && debut < dateMinimale(options)) {
    errors.dateDebut = MESSAGES_DATES.debutPassee;
  } else if (saisi(dateFin) && !fin) {
    errors.dateFin = MESSAGES_DATES.finInvalide;
  } else if (debut && fin && fin < debut) {
    errors.dateFin = MESSAGES_DATES.finAvantDebut;
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

export function validateReservationPayload(payload = {}, unavailableRanges = [], options = {}) {
  const errors = {};
  const sanitized = sanitizeReservationPayload(payload);
  const minDate = dateMinimale(options);

  if (!sanitized.nom) {
    errors.nom = "Merci de renseigner votre nom.";
  }

  if (!sanitized.prenom) {
    errors.prenom = "Merci de renseigner votre prénom.";
  }

  if (!sanitized.telephone) {
    errors.telephone = "Merci de renseigner votre téléphone de contact.";
  } else if (sanitized.telephone.replace(/[^\d+]/g, "").length < 10) {
    errors.telephone = "Merci de renseigner un numéro de téléphone valide.";
  }

  if (sanitized.whatsapp && sanitized.whatsapp.replace(/[^\d+]/g, "").length < 10) {
    errors.whatsapp = "Merci de renseigner un numéro WhatsApp valide ou de laisser ce champ vide.";
  }

  if (!sanitized.email) {
    errors.email = "Merci de renseigner votre e-mail de contact.";
  } else if (!EMAIL_REGEX.test(sanitized.email)) {
    errors.email = "Merci de renseigner une adresse e-mail valide.";
  }

  if (!sanitized.commune) {
    errors.commune = "Merci de renseigner votre commune.";
  }

  if (!Number.isInteger(sanitized.nombreChats) || sanitized.nombreChats < 1) {
    errors.nombreChats = "Merci d’indiquer un nombre de chats valide (minimum 1).";
  }

  if (!isIsoDate(sanitized.dateDebut)) {
    errors.dateDebut = MESSAGES_DATES.debutInvalide;
  } else if (sanitized.dateDebut < minDate) {
    errors.dateDebut = MESSAGES_DATES.debutPassee;
  }

  if (!isIsoDate(sanitized.dateFin)) {
    errors.dateFin = MESSAGES_DATES.finInvalide;
  }

  if (isIsoDate(sanitized.dateDebut) && isIsoDate(sanitized.dateFin) && sanitized.dateFin < sanitized.dateDebut) {
    errors.dateFin = MESSAGES_DATES.finAvantDebut;
  }

  if (!FREQUENCE_OPTIONS.includes(sanitized.frequence)) {
    errors.frequence = "Merci de sélectionner une fréquence de visites.";
  }

  if (sanitized.frequence === "autre" && !sanitized.autreFrequence) {
    errors.autreFrequence = "Merci de préciser votre besoin complémentaire.";
  }

  if (
    isIsoDate(sanitized.dateDebut) &&
    isIsoDate(sanitized.dateFin) &&
    sanitized.dateFin >= sanitized.dateDebut &&
    availableSegments(sanitized.dateDebut, sanitized.dateFin, unavailableRanges).length === 0
  ) {
    errors.dateRange = "Je ne prends pas de réservation sur ces dates.";
  }

  if (sanitized.honeypot) {
    errors.honeypot = "Envoi bloqué.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}

export function validateUnavailabilityPayload(payload = {}) {
  const errors = {};
  const sanitized = sanitizeUnavailabilityPayload(payload);

  if (!isIsoDate(sanitized.startDate)) {
    errors.startDate = MESSAGES_DATES.debutInvalide;
  }

  if (!isIsoDate(sanitized.endDate)) {
    errors.endDate = MESSAGES_DATES.finInvalide;
  }

  if (isIsoDate(sanitized.startDate) && isIsoDate(sanitized.endDate) && sanitized.endDate < sanitized.startDate) {
    errors.endDate = MESSAGES_DATES.finAvantDebut;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized,
  };
}

export function formatDateFr(value) {
  const normalized = normalizeDateInput(value);
  if (!isIsoDate(normalized)) {
    return "";
  }

  const parts = parseIsoDateParts(normalized);
  if (!parts) {
    return "";
  }

  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
}

/* Adresse complète */
export function adresseComplete({ adresse = "", commune = "", communeCodePostal = "" } = {}) {
  const rue = normalizeWhitespace(adresse);
  if (!rue) {
    return "";
  }

  const nomCommune = normalizeWhitespace(String(commune).replace(/\s*\(\d{5}\)\s*$/, ""));
  const lieu = [normalizeWhitespace(communeCodePostal), nomCommune].filter(Boolean).join(" ");
  return lieu ? `${rue}, ${lieu}` : rue;
}

/* À venir / terminé */
export function separerPassees(elements = [], aujourdhui = todayIso(), { debut = "startDate", fin = "endDate" } = {}) {
  const aVenir = [];
  const passees = [];

  for (const element of elements) {
    (String(element?.[fin] ?? "") >= aujourdhui ? aVenir : passees).push(element);
  }

  aVenir.sort((a, b) => String(a[debut]).localeCompare(String(b[debut])));
  passees.sort((a, b) => String(b[debut]).localeCompare(String(a[debut])));
  return { aVenir, passees };
}

/* Demandes récentes */
export function demandesRecentes(demandes = [], maintenant = new Date(), jours = 30) {
  const limite = maintenant.getTime() - jours * 86400000;
  const recue = (demande) => dateHeureD1(demande?.soumiseLe).getTime();

  return demandes
    .filter((demande) => !(recue(demande) < limite))
    .sort((a, b) => (recue(b) || 0) - (recue(a) || 0));
}

/* Date D1 en UTC */
export function dateHeureD1(valeur = "") {
  const texte = String(valeur ?? "");
  return new Date(texte.replace(" ", "T") + (texte.endsWith("Z") ? "" : "Z"));
}
