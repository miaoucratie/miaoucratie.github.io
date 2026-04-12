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

export function rangeCollidesWithUnavailable(startDate, endDate, unavailableRanges = []) {
  const normalizedStart = normalizeDateInput(startDate);
  const normalizedEnd = normalizeDateInput(endDate);

  if (!isIsoDate(normalizedStart) || !isIsoDate(normalizedEnd)) {
    return false;
  }

  return unavailableRanges.some((range) => {
    const rangeStart = normalizeDateInput(range.startDate);
    const rangeEnd = normalizeDateInput(range.endDate);

    return (
      isIsoDate(rangeStart) &&
      isIsoDate(rangeEnd) &&
      dateRangeOverlaps(normalizedStart, normalizedEnd, rangeStart, rangeEnd)
    );
  });
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
    nombreChats: Number.isFinite(catCount) ? catCount : NaN,
    dateDebut: normalizeDateInput(payload.dateDebut ?? payload.date_debut ?? ""),
    dateFin: normalizeDateInput(payload.dateFin ?? payload.date_fin ?? ""),
    frequence: frequency,
    autreFrequence: safeText(payload.autreFrequence ?? payload.frequence_autre ?? "", 160),
    observations: safeMultilineText(payload.observations ?? "", 2000),
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

export function validateReservationPayload(payload = {}, unavailableRanges = [], options = {}) {
  const errors = {};
  const sanitized = sanitizeReservationPayload(payload);
  const minDate = options.minDate || todayIso(options.now ? new Date(options.now) : new Date());

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
    errors.dateDebut = "Merci de choisir une date de début valide.";
  } else if (sanitized.dateDebut < minDate) {
    errors.dateDebut = "Les dates passées ne sont pas disponibles.";
  }

  if (!isIsoDate(sanitized.dateFin)) {
    errors.dateFin = "Merci de choisir une date de fin valide.";
  }

  if (isIsoDate(sanitized.dateDebut) && isIsoDate(sanitized.dateFin) && sanitized.dateFin < sanitized.dateDebut) {
    errors.dateFin = "La date de fin doit être postérieure ou égale à la date de début.";
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
    rangeCollidesWithUnavailable(sanitized.dateDebut, sanitized.dateFin, unavailableRanges)
  ) {
    errors.dateRange = "Cette période n’est pas disponible. Merci de choisir d’autres dates.";
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
    errors.startDate = "Merci de choisir une date de début valide.";
  }

  if (!isIsoDate(sanitized.endDate)) {
    errors.endDate = "Merci de choisir une date de fin valide.";
  }

  if (isIsoDate(sanitized.startDate) && isIsoDate(sanitized.endDate) && sanitized.endDate < sanitized.startDate) {
    errors.endDate = "La date de fin doit être postérieure ou égale à la date de début.";
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

export function buildReservationSubject(payload) {
  const sanitized = sanitizeReservationPayload(payload);
  return `Nouvelle demande de réservation – ${sanitized.prenom} ${sanitized.nom} – ${sanitized.dateDebut} au ${sanitized.dateFin}`;
}
