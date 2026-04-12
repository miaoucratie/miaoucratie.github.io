const FREQUENCE_OPTIONS = Object.freeze([
  "1 visite par jour",
  "2 visites par jour",
  "autre",
]);

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FR_REGEX = /^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function safeText(value = "", maxLength = 2000) {
  return normalizeWhitespace(String(value)).slice(0, maxLength);
}

function safeMultilineText(value = "", maxLength = 4000) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function sanitizeReservationPayload(payload = {}) {
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

function parseIsoDateParts(value = "") {
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

function normalizeDateInput(value = "") {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return isoFromDate(value);
  }

  const raw = safeText(value, 32);

  if (!raw) {
    return "";
  }

  const isoParts = parseIsoDateParts(raw);
  if (isoParts) {
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

function isIsoDate(value = "") {
  return Boolean(parseIsoDateParts(value));
}

function toDate(value) {
  const normalized = normalizeDateInput(value);
  return parseIsoDateParts(normalized)?.date ?? null;
}

function isoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIso(now = new Date()) {
  return isoFromDate(now);
}

function dateRangeOverlaps(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

function mergeRanges(ranges = []) {
  const validRanges = ranges
    .filter((range) => isIsoDate(range.startDate) && isIsoDate(range.endDate))
    .map((range) => ({
      ...range,
      startDate: range.startDate,
      endDate: range.endDate,
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
    const currentStart = toDate(current.startDate);

    if (!lastEnd || !currentStart) {
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

function rangeCollidesWithUnavailable(startDate, endDate, unavailableRanges = []) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return false;
  }
  return unavailableRanges.some((range) =>
    isIsoDate(range.startDate) &&
    isIsoDate(range.endDate) &&
    dateRangeOverlaps(startDate, endDate, range.startDate, range.endDate)
  );
}

function validateReservationPayload(payload = {}, unavailableRanges = [], options = {}) {
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

function buildReservationSubject(payload = {}) {
  const sanitized = sanitizeReservationPayload(payload);
  return `Nouvelle demande de réservation – ${sanitized.prenom} ${sanitized.nom} – ${sanitized.dateDebut} au ${sanitized.dateFin}`;
}


const API_BASE = document
  .querySelector('meta[name="miaoucratie-api-base"]')
  ?.getAttribute("content")
  ?.trim() || "";

const WEB3FORMS_ACCESS_KEY = document
  .querySelector('meta[name="web3forms-access-key"]')
  ?.getAttribute("content")
  ?.trim() || "";

const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

const ENDPOINTS = {
  unavailable: `${API_BASE}/public/unavailabilities`,
  reservation: `${API_BASE}/public/reservations`,
};

const DRAFT_KEY = "miaoucratie:reservation:draft:v1";
const COMMUNE_ENDPOINT = "https://geo.api.gouv.fr/communes";
const TODAY_ISO = todayIso(new Date());


const LOCAL_COMMUNE_FALLBACK = [
  { nom: "Domagné", code: "35096", codesPostaux: ["35113"] },
  { nom: "Châteaubourg", code: "35068", codesPostaux: ["35220"] },
  { nom: "Châteaugiron", code: "35069", codesPostaux: ["35410"] },
  { nom: "Servon-sur-Vilaine", code: "35327", codesPostaux: ["35530"] },
  { nom: "Vitré", code: "35360", codesPostaux: ["35500"] },
  { nom: "Janzé", code: "35136", codesPostaux: ["35150"] },
  { nom: "La Bouëxière", code: "35031", codesPostaux: ["35340"] },
  { nom: "Noyal-sur-Vilaine", code: "35207", codesPostaux: ["35530"] },
  { nom: "Cesson-Sévigné", code: "35051", codesPostaux: ["35510"] },
  { nom: "Thorigné-Fouillard", code: "35334", codesPostaux: ["35235"] }
];


const state = {
  unavailableRanges: [],
  availabilityLoaded: false,
  startPicker: null,
  endPicker: null,
  communeAbortController: null,
  communeTimer: null,
  isFlatpickrAvailable: Boolean(window.flatpickr),
};

const form = document.getElementById("reservation-form");
const feedback = document.getElementById("reservation-feedback");
const successPanel = document.getElementById("success-panel");
const newRequestButton = document.getElementById("new-request-button");
const submitButton = document.getElementById("submit-button");
const availabilityNote = document.getElementById("availability-note");
const dateRangeError = document.getElementById("dateRange-error");
const startedAtField = document.getElementById("started_at");
const frequencyField = document.getElementById("frequence");
const otherFrequencyWrapper = document.getElementById("autre-frequence-wrapper");
const otherFrequencyInput = document.getElementById("autreFrequence");
const menuButton = document.querySelector("[data-menu-toggle]");
const menu = document.querySelector("[data-menu]");
const communeInput = document.getElementById("commune");
const communeCodeInput = document.getElementById("commune_code");
const communeCodePostalInput = document.getElementById("commune_code_postal");
const communeSuggestions = document.getElementById("commune-suggestions");
const startDateInput = document.getElementById("dateDebut");
const endDateInput = document.getElementById("dateFin");

init();

function init() {
  if (!form) {
    return;
  }

  startedAtField.value = String(Date.now());

  initMenu();
  initDynamicFields();
  initDatePickers();
  restoreDraft();
  attachFieldListeners();
  loadUnavailableRanges();

  form.addEventListener("submit", handleSubmit);
  newRequestButton?.addEventListener("click", resetForNewRequest);
}

function initMenu() {
  if (!menuButton || !menu) {
    return;
  }

  menuButton.addEventListener("click", () => {
    const open = menu.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (event) => {
    if (!menu.classList.contains("is-open")) {
      return;
    }
    if (menu.contains(event.target) || menuButton.contains(event.target)) {
      return;
    }
    menu.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
  });
}

function initDynamicFields() {
  toggleOtherFrequency(frequencyField.value);
  frequencyField.addEventListener("change", () => {
    toggleOtherFrequency(frequencyField.value);
    clearFieldError("frequence");
    saveDraft();
  });

  initCommuneAutocomplete();
}

function toggleOtherFrequency(value) {
  const shouldShow = value === "autre";
  otherFrequencyWrapper.hidden = !shouldShow;
  otherFrequencyInput.required = shouldShow;

  if (!shouldShow) {
    otherFrequencyInput.value = "";
    clearFieldError("autreFrequence");
  }
}

function initDatePickers() {
  if (state.isFlatpickrAvailable) {
    initFlatpickr();
    return;
  }

  initNativeDateFallback();
}

function initFlatpickr() {
  const flatpickrLocale = window.flatpickr?.l10ns?.fr || "fr";

  state.startPicker = window.flatpickr("#dateDebut", {
    locale: flatpickrLocale,
    altInput: true,
    altFormat: "d/m/Y",
    dateFormat: "Y-m-d",
    allowInput: false,
    disableMobile: true,
    minDate: "today",
    onReady(selectedDates, dateString, instance) {
      bindAltDateInput(instance, "dateDebut");
      syncPickerIsoValue(instance, dateString || instance.input?.value || "");
    },
    onValueUpdate(selectedDates, dateString, instance) {
      syncPickerIsoValue(instance, dateString);
    },
    onChange(selectedDates, dateString, instance) {
      syncPickerIsoValue(instance, dateString);
      clearFieldError("dateDebut");
      clearFieldError("dateFin");
      clearFieldError("dateRange");

      if (dateString) {
        state.endPicker?.set("minDate", dateString);
      } else {
        state.endPicker?.set("minDate", "today");
      }

      validateDatesLive();
      saveDraft();
    },
  });

  state.endPicker = window.flatpickr("#dateFin", {
    locale: flatpickrLocale,
    altInput: true,
    altFormat: "d/m/Y",
    dateFormat: "Y-m-d",
    allowInput: false,
    disableMobile: true,
    minDate: "today",
    onReady(selectedDates, dateString, instance) {
      bindAltDateInput(instance, "dateFin");
      syncPickerIsoValue(instance, dateString || instance.input?.value || "");
    },
    onValueUpdate(selectedDates, dateString, instance) {
      syncPickerIsoValue(instance, dateString);
    },
    onChange(selectedDates, dateString, instance) {
      syncPickerIsoValue(instance, dateString);
      clearFieldError("dateDebut");
      clearFieldError("dateFin");
      clearFieldError("dateRange");
      validateDatesLive();
      saveDraft();
    },
  });
}


function initNativeDateFallback() {
  startDateInput.type = "date";
  endDateInput.type = "date";
  startDateInput.min = TODAY_ISO;
  endDateInput.min = TODAY_ISO;

  state.startPicker = createNativePicker(startDateInput, "dateDebut");
  state.endPicker = createNativePicker(endDateInput, "dateFin");

  startDateInput.addEventListener("change", () => {
    startDateInput.dataset.isoValue = normalizeDateInput(startDateInput.value);
    clearFieldError("dateDebut");
    clearFieldError("dateFin");
    clearFieldError("dateRange");
    endDateInput.min = startDateInput.value || TODAY_ISO;
    validateDatesLive();
    saveDraft();
  });

  endDateInput.addEventListener("change", () => {
    endDateInput.dataset.isoValue = normalizeDateInput(endDateInput.value);
    clearFieldError("dateDebut");
    clearFieldError("dateFin");
    clearFieldError("dateRange");
    validateDatesLive();
    saveDraft();
  });

  availabilityNote.textContent = "Le calendrier simplifié est actif. Les chevauchements restent revérifiés côté application.";
}

function createNativePicker(input, fieldName) {
  return {
    input,
    altInput: input,
    set(option, value) {
      if (option === "minDate") {
        input.min = value === "today" ? TODAY_ISO : value;
      }
      if (option === "disable") {
        input.dataset.disabledRanges = JSON.stringify(value || []);
      }
    },
    setDate(value) {
      const normalized = normalizeDateInput(value || "");
      input.value = normalized || "";
      input.dataset.isoValue = normalized || "";
    },
    clear() {
      input.value = "";
      input.dataset.isoValue = "";
    },
  };
}


function bindAltDateInput(instance, fieldName) {
  if (!instance.altInput) {
    return;
  }

  const altInput = instance.altInput;
  const label = form.querySelector(`[data-field="${fieldName}"] label`);
  altInput.id = `${fieldName}-display`;
  altInput.setAttribute("autocomplete", "off");
  altInput.setAttribute("aria-describedby", `${fieldName}-error`);
  altInput.dataset.fieldProxy = fieldName;

  if (label) {
    label.setAttribute("for", altInput.id);
  }

  altInput.addEventListener("focus", () => clearFieldError(fieldName));
}

function syncPickerIsoValue(instance, rawValue = "") {
  if (!instance) {
    return "";
  }

  const normalized = normalizeDateInput(rawValue);

  if (instance.input) {
    instance.input.dataset.isoValue = normalized;
    if (normalized) {
      instance.input.value = normalized;
    }
  }

  if (instance.altInput) {
    instance.altInput.dataset.isoValue = normalized;
  }

  return normalized;
}


function initCommuneAutocomplete() {
  if (!communeInput || !communeSuggestions) {
    return;
  }

  communeInput.addEventListener("input", () => {
    communeCodeInput.value = "";
    communeCodePostalInput.value = "";
    clearFieldError("commune");
    saveDraft();

    window.clearTimeout(state.communeTimer);

    const query = communeInput.value.trim();
    if (query.length < 2) {
      hideCommuneSuggestions();
      return;
    }

    state.communeTimer = window.setTimeout(() => {
      fetchCommuneSuggestions(query);
    }, 220);
  });

  communeInput.addEventListener("focus", () => {
    const query = communeInput.value.trim();
    if (query.length >= 2 && communeSuggestions.childElementCount > 0) {
      communeSuggestions.hidden = false;
      communeSuggestions.classList.add("is-open");
      communeInput.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-autocomplete]")) {
      hideCommuneSuggestions();
    }
  });

  communeInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideCommuneSuggestions();
    }
  });
}

async function fetchCommuneSuggestions(query) {
  if (state.communeAbortController) {
    state.communeAbortController.abort();
  }

  state.communeAbortController = new AbortController();

  const params = new URLSearchParams({
    fields: "nom,code,codesPostaux,departement",
    limit: "10",
    format: "json",
  });

  if (/^\d{5}$/.test(query)) {
    params.set("codePostal", query);
  } else {
    params.set("nom", query);
    params.set("boost", "population");
  }

  try {
    const response = await fetch(`${COMMUNE_ENDPOINT}?${params.toString()}`, {
      signal: state.communeAbortController.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Impossible de récupérer les communes.");
    }

    const suggestions = await response.json();
    renderCommuneSuggestions(suggestions);
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }
    const fallback = getFallbackCommunes(query);
    if (fallback.length) {
      renderCommuneSuggestions(fallback);
      return;
    }
    hideCommuneSuggestions();
  }
}

function getFallbackCommunes(query) {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const digitsQuery = normalizedQuery.replace(/\s+/g, "");
  if (normalizedQuery.length < 2) {
    return [];
  }

  return LOCAL_COMMUNE_FALLBACK.filter((commune) => {
    const name = String(commune.nom || "").toLowerCase();
    const postal = Array.isArray(commune.codesPostaux) && commune.codesPostaux.length
      ? commune.codesPostaux[0]
      : "";
    return name.includes(normalizedQuery) || String(postal).includes(digitsQuery);
  }).slice(0, 8);
}

function renderCommuneSuggestions(suggestions = []) {
  communeSuggestions.innerHTML = "";

  if (!Array.isArray(suggestions) || !suggestions.length) {
    hideCommuneSuggestions();
    return;
  }

  for (const commune of suggestions) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "autocomplete__option";
    option.setAttribute("role", "option");

    const postalCode = Array.isArray(commune.codesPostaux) && commune.codesPostaux.length
      ? commune.codesPostaux[0]
      : "";
    const line1 = document.createElement("span");
    line1.className = "autocomplete__option-main";
    line1.textContent = commune.nom || "";

    const line2 = document.createElement("small");
    line2.className = "autocomplete__option-meta";
    line2.textContent = postalCode || "Commune";

    option.append(line1, line2);

    option.addEventListener("click", () => {
      communeInput.value = postalCode ? `${commune.nom} (${postalCode})` : commune.nom;
      communeCodeInput.value = commune.code || "";
      communeCodePostalInput.value = postalCode;
      hideCommuneSuggestions();
      saveDraft();
    });

    communeSuggestions.append(option);
  }

  communeSuggestions.hidden = false;
  communeSuggestions.classList.add("is-open");
  communeInput.setAttribute("aria-expanded", "true");
}

function hideCommuneSuggestions() {
  communeSuggestions.innerHTML = "";
  communeSuggestions.hidden = true;
  communeSuggestions.classList.remove("is-open");
  communeInput.setAttribute("aria-expanded", "false");
}

async function loadUnavailableRanges() {
  if (!state.isFlatpickrAvailable) {
    availabilityNote.textContent = "Vérification des disponibilités en cours…";
  } else {
    availabilityNote.textContent = "Vérification des disponibilités en cours…";
  }

  try {
    const response = await fetch(ENDPOINTS.unavailable, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Impossible de charger les disponibilités.");
    }

    const payload = await response.json();
    state.unavailableRanges = mergeRanges(payload.ranges || []);
    state.availabilityLoaded = true;
    applyUnavailableRangesToPickers();
    validateDatesLive();

    availabilityNote.textContent = state.unavailableRanges.length
      ? "Les dates grisées dans le calendrier sont indisponibles et ne peuvent pas être sélectionnées."
      : "Aucune indisponibilité bloquante n’est enregistrée pour le moment.";
  } catch (error) {
    state.availabilityLoaded = false;
    availabilityNote.textContent = "Les disponibilités n’ont pas pu être chargées pour le moment. Votre demande sera revérifiée côté serveur.";
  }
}

function applyUnavailableRangesToPickers() {
  const disabledRanges = state.unavailableRanges.map((range) => ({
    from: range.startDate,
    to: range.endDate,
  }));

  state.startPicker?.set("disable", disabledRanges);
  state.endPicker?.set("disable", disabledRanges);
}

function attachFieldListeners() {
  const interactiveFields = form.querySelectorAll("input, select, textarea");

  interactiveFields.forEach((field) => {
    if (field.name === "website") {
      return;
    }

    field.addEventListener("input", () => {
      const key = toFieldKey(field.name || field.id);
      if (key) {
        clearFieldError(key);
      }
      clearFieldError("dateRange");
      saveDraft();
    });

    field.addEventListener("change", () => {
      saveDraft();
    });
  });
}

function toFieldKey(fieldName) {
  const map = {
    nom: "nom",
    prenom: "prenom",
    telephone: "telephone",
    whatsapp: "whatsapp",
    email: "email",
    commune: "commune",
    commune_code: "communeCode",
    commune_code_postal: "communeCodePostal",
    nombre_chats: "nombreChats",
    frequence: "frequence",
    frequence_autre: "autreFrequence",
    date_debut: "dateDebut",
    date_fin: "dateFin",
    observations: "observations",
  };

  return map[fieldName] || fieldName || "";
}

function getPickerDateValue(fieldId) {
  const picker = fieldId === "dateDebut" ? state.startPicker : state.endPicker;
  const candidates = [
    picker?.input?.dataset?.isoValue,
    picker?.input?.value,
    picker?.altInput?.dataset?.isoValue,
    picker?.altInput?.value,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalized = normalizeDateInput(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}


function getDateFieldValue(fieldId, fieldName) {
  const pickerValue = getPickerDateValue(fieldId);
  if (pickerValue) {
    return pickerValue;
  }

  const input = document.getElementById(fieldId);
  const picker = fieldId === "dateDebut" ? state.startPicker : state.endPicker;
  const proxyInput = picker?.altInput;
  const candidateValues = [
    input?.dataset?.isoValue,
    input?.value,
    form?.elements?.[fieldName]?.value,
    proxyInput?.dataset?.isoValue,
    proxyInput?.value,
  ].filter(Boolean);

  for (const candidate of candidateValues) {
    const normalized = normalizeDateInput(candidate);
    if (normalized) {
      return normalized;
    }
  }

  if (input?.valueAsDate instanceof Date && Number.isFinite(input.valueAsDate.getTime())) {
    return `${input.valueAsDate.getFullYear()}-${String(input.valueAsDate.getMonth() + 1).padStart(2, "0")}-${String(input.valueAsDate.getDate()).padStart(2, "0")}`;
  }

  return "";
}


function getFormPayload() {
  const formData = new FormData(form);
  return {
    nom: formData.get("nom"),
    prenom: formData.get("prenom"),
    telephone: formData.get("telephone"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    commune: formData.get("commune"),
    commune_code: formData.get("commune_code"),
    commune_code_postal: formData.get("commune_code_postal"),
    nombre_chats: formData.get("nombre_chats"),
    frequence: formData.get("frequence"),
    frequence_autre: formData.get("frequence_autre"),
    date_debut: getDateFieldValue("dateDebut", "date_debut"),
    date_fin: getDateFieldValue("dateFin", "date_fin"),
    observations: formData.get("observations"),
    started_at: formData.get("started_at"),
    website: formData.get("website"),
  };
}

function validateDatesLive() {
  clearFieldError("dateDebut");
  clearFieldError("dateFin");
  clearFieldError("dateRange");

  const start = getDateFieldValue("dateDebut", "date_debut");
  const end = getDateFieldValue("dateFin", "date_fin");

  if (!start && !end) {
    return true;
  }

  if (start && !isIsoDate(start)) {
    setFieldError("dateDebut", "Merci de choisir une date de début valide.");
    return false;
  }

  if (start && start < TODAY_ISO) {
    setFieldError("dateDebut", "Les dates passées ne sont pas disponibles.");
    return false;
  }

  if (!end) {
    return true;
  }

  if (!isIsoDate(end)) {
    setFieldError("dateFin", "Merci de choisir une date de fin valide.");
    return false;
  }

  if (start && end < start) {
    setFieldError("dateFin", "La date de fin doit être postérieure ou égale à la date de début.");
    return false;
  }

  if (start && rangeCollidesWithUnavailable(start, end, state.unavailableRanges)) {
    setFieldError("dateRange", "Cette période n’est pas disponible. Merci de choisir d’autres dates.");
    return false;
  }

  return true;
}

async function handleSubmit(event) {
  event.preventDefault();
  hideAlert();
  clearAllErrors();

  const payload = getFormPayload();
  const validation = validateReservationPayload(payload, state.unavailableRanges);

  if (!validation.isValid) {
    applyErrors(validation.errors);
    focusFirstError(validation.errors);
    return;
  }

  setButtonLoading(submitButton, true);

  try {
    const response = await fetch(ENDPOINTS.reservation, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(validation.sanitized),
    });

    const result = await safeJson(response);

    if (!response.ok) {
      if (result?.errors) {
        applyErrors(result.errors);
      }

      const message = result?.message || "Une erreur est survenue pendant l’envoi. Merci de réessayer.";
      showAlert("error", message);
      focusFirstError(result?.errors || {});
      return;
    }

    await sendWeb3FormsNotification(validation.sanitized, result?.reservationId || "");

    sessionStorage.removeItem(DRAFT_KEY);
    form.hidden = true;
    successPanel.hidden = false;
    successPanel.setAttribute("aria-hidden", "false");
    successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showAlert(
      "error",
      error?.message ||
        "Une erreur réseau est survenue. Merci de réessayer sans recharger la page."
    );
  } finally {
    setButtonLoading(submitButton, false);
  }
}


async function sendWeb3FormsNotification(payload, reservationId = "") {
  if (!WEB3FORMS_ACCESS_KEY) {
    throw new Error("La configuration d’envoi d’e-mail est incomplète. Merci de me contacter directement.");
  }

  const response = await fetch(WEB3FORMS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildWeb3FormsPayload(payload, reservationId)),
  });

  const result = await safeJson(response);

  if (!response.ok || result?.success === false) {
    throw new Error(
      "Votre demande a bien été enregistrée, mais la notification e-mail n’a pas pu être envoyée. Merci de réessayer ou de me contacter directement."
    );
  }

  return result;
}

function buildWeb3FormsPayload(payload, reservationId = "") {
  const submittedAt = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date());

  const frequenceLabel =
    payload.frequence === "autre"
      ? `Autre besoin à préciser${payload.autreFrequence ? ` : ${payload.autreFrequence}` : ""}`
      : payload.frequence;

  const message = [
    "Nouvelle demande de réservation Miaoucratie",
    "",
    `Nom : ${payload.nom}`,
    `Prénom : ${payload.prenom}`,
    `Téléphone : ${payload.telephone}`,
    `WhatsApp : ${payload.whatsapp || "Non renseigné"}`,
    `E-mail : ${payload.email}`,
    `Commune : ${payload.commune}`,
    `Code commune : ${payload.communeCode || "Non renseigné"}`,
    `Code postal : ${payload.communeCodePostal || "Non renseigné"}`,
    `Nombre de chats : ${payload.nombreChats}`,
    `Date de début : ${payload.dateDebut}`,
    `Date de fin : ${payload.dateFin}`,
    `Fréquence de visites : ${frequenceLabel}`,
    `Observations : ${payload.observations || "Aucune"}`,
    `Date et heure de soumission : ${submittedAt}`,
    reservationId ? `Référence interne : ${reservationId}` : "",
    "",
    "Il s’agit bien d’une demande de réservation, et non d’une confirmation automatique.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: buildReservationSubject(payload),
    from_name: "Miaoucratie — Demande de réservation",
    name: `${payload.prenom} ${payload.nom}`.trim(),
    email: payload.email,
    replyto: payload.email,
    phone: payload.telephone,
    botcheck: "",
    message,
    nom: payload.nom,
    prenom: payload.prenom,
    telephone: payload.telephone,
    whatsapp: payload.whatsapp || "Non renseigné",
    commune: payload.commune,
    commune_code: payload.communeCode || "",
    commune_code_postal: payload.communeCodePostal || "",
    nombre_chats: String(payload.nombreChats),
    date_debut: payload.dateDebut,
    date_fin: payload.dateFin,
    frequence: frequenceLabel,
    observations: payload.observations || "",
    submitted_at: submittedAt,
    reservation_id: reservationId,
  };
}

async function safeJson(response) {
  const raw = await response.text();

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}

function applyErrors(errors = {}) {
  Object.entries(errors).forEach(([key, message]) => setFieldError(key, message));
}

function clearAllErrors() {
  [
    "nom",
    "prenom",
    "telephone",
    "whatsapp",
    "email",
    "commune",
    "nombreChats",
    "frequence",
    "autreFrequence",
    "dateDebut",
    "dateFin",
    "dateRange",
    "observations",
  ].forEach((fieldName) => clearFieldError(fieldName));
}

function setFieldError(fieldName, message = "") {
  if (fieldName === "dateRange") {
    dateRangeError.textContent = message;
    return;
  }

  const errorElement = document.getElementById(`${fieldName}-error`);
  const field = form.querySelector(`[data-field="${fieldName}"]`);

  if (errorElement) {
    errorElement.textContent = message;
  }

  if (field) {
    field.querySelectorAll("input, select, textarea").forEach((input) => {
      input.setAttribute("aria-invalid", message ? "true" : "false");
    });
  }

  if (fieldName === "dateDebut" && state.startPicker?.altInput) {
    state.startPicker.altInput.setAttribute("aria-invalid", message ? "true" : "false");
  }

  if (fieldName === "dateFin" && state.endPicker?.altInput) {
    state.endPicker.altInput.setAttribute("aria-invalid", message ? "true" : "false");
  }
}

function clearFieldError(fieldName) {
  setFieldError(fieldName, "");
}

function focusFirstError(errors = {}) {
  const order = [
    "nom",
    "prenom",
    "telephone",
    "email",
    "whatsapp",
    "commune",
    "nombreChats",
    "frequence",
    "autreFrequence",
    "dateDebut",
    "dateFin",
    "dateRange",
  ];

  const first = order.find((fieldName) => errors[fieldName]);
  if (!first) {
    return;
  }

  if (first === "dateRange" || first === "dateDebut") {
    state.startPicker?.altInput?.focus();
    return;
  }

  if (first === "dateFin") {
    state.endPicker?.altInput?.focus();
    return;
  }

  const field = form.querySelector(`[data-field="${first}"] input, [data-field="${first}"] select, [data-field="${first}"] textarea`);
  field?.focus();
}

function showAlert(type, message) {
  feedback.hidden = false;
  feedback.className = `alert alert--${type}`;
  feedback.textContent = message;
}

function hideAlert() {
  feedback.hidden = true;
  feedback.className = "alert";
  feedback.textContent = "";
}

function setButtonLoading(button, isLoading) {
  button.classList.toggle("is-loading", isLoading);
  button.disabled = isLoading;
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function saveDraft() {
  if (form.hidden) {
    return;
  }

  const payload = sanitizeReservationPayload(getFormPayload());
  const draft = {
    ...payload,
    communeCode: communeCodeInput.value,
    communeCodePostal: communeCodePostalInput.value,
  };

  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function restoreDraft() {
  const draft = safeParseJson(sessionStorage.getItem(DRAFT_KEY));
  if (!draft) {
    return;
  }

  form.querySelector("#nom").value = draft.nom || "";
  form.querySelector("#prenom").value = draft.prenom || "";
  form.querySelector("#telephone").value = draft.telephone || "";
  form.querySelector("#email").value = draft.email || "";
  form.querySelector("#whatsapp").value = draft.whatsapp || "";
  communeInput.value = draft.commune || "";
  communeCodeInput.value = draft.communeCode || "";
  communeCodePostalInput.value = draft.communeCodePostal || "";
  form.querySelector("#nombreChats").value = Number.isFinite(draft.nombreChats) ? draft.nombreChats : "";
  frequencyField.value = draft.frequence || "";
  toggleOtherFrequency(frequencyField.value);
  otherFrequencyInput.value = draft.autreFrequence || "";
  form.querySelector("#observations").value = draft.observations || "";

  if (draft.startedAt) {
    startedAtField.value = String(draft.startedAt);
  }

  if (draft.dateDebut) {
    state.startPicker?.setDate(draft.dateDebut, false, "Y-m-d");
    syncPickerIsoValue(state.startPicker, draft.dateDebut);
    state.endPicker?.set("minDate", draft.dateDebut);
  }

  if (draft.dateFin) {
    state.endPicker?.setDate(draft.dateFin, false, "Y-m-d");
    syncPickerIsoValue(state.endPicker, draft.dateFin);
  }

  validateDatesLive();
}


function resetForNewRequest() {
  successPanel.hidden = true;
  form.hidden = false;
  form.reset();
  state.startPicker?.clear();
  state.endPicker?.clear();
  syncPickerIsoValue(state.startPicker, "");
  syncPickerIsoValue(state.endPicker, "");
  state.endPicker?.set("minDate", TODAY_ISO);
  toggleOtherFrequency("");
  clearAllErrors();
  hideAlert();
  startedAtField.value = String(Date.now());
  communeCodeInput.value = "";
  communeCodePostalInput.value = "";
  sessionStorage.removeItem(DRAFT_KEY);
  loadUnavailableRanges();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}


function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}
