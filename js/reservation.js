import {
  availableSegments,
  adresseComplete,
  buildReservationSubject,
  isIsoDate,
  mergeRanges,
  normalizeDateInput,
  normalizeWhitespace,
  sanitizeReservationPayload,
  todayIso,
  validateReservationPayload,
} from "../shared/booking-utils.js";


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
  notificationEchouee: (id) => `${API_BASE}/public/reservations/${id}/notification-echouee`,
};

const DRAFT_KEY = "miaoucratie:reservation:draft:v1";
const COMMUNE_ENDPOINT = "https://geo.api.gouv.fr/communes";
const ADRESSE_ENDPOINT = "https://data.geopf.fr/geocodage/search";
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
  isFlatpickrAvailable: Boolean(window.flatpickr),
};

const form = document.getElementById("reservation-form");
const feedback = document.getElementById("reservation-feedback");
const successPanel = document.getElementById("success-panel");
const newRequestButton = document.getElementById("new-request-button");
const submitButton = document.getElementById("submit-button");
const availabilityNote = document.getElementById("availability-note");
const periodeRecap = document.getElementById("periode-recap");
const periodePhrase = document.getElementById("periode-phrase");
const periodeBarre = document.getElementById("periode-barre");
const periodeBornes = document.getElementById("periode-bornes");
const periodeLegende = document.getElementById("periode-legende");
const relaisBloc = document.getElementById("relais");
const relaisTexte = document.getElementById("relais-texte");
const submitNote = document.getElementById("submit-note");
const dateRangeError = document.getElementById("dateRange-error");
const startedAtField = document.getElementById("started_at");
const frequencyField = document.getElementById("frequence");
const otherFrequencyWrapper = document.getElementById("autre-frequence-wrapper");
const otherFrequencyInput = document.getElementById("autreFrequence");
const communeInput = document.getElementById("commune");
const communeCodeInput = document.getElementById("commune_code");
const communeCodePostalInput = document.getElementById("commune_code_postal");
const communeSuggestions = document.getElementById("commune-suggestions");
const adresseInput = document.getElementById("adresse");
const adresseSuggestions = document.getElementById("adresse-suggestions");
const startDateInput = document.getElementById("dateDebut");
const endDateInput = document.getElementById("dateFin");

init();

/** Événement de mesure */
function mesurer(nom, parametres = {}) {
  if (typeof gtag === "function") {
    gtag("event", nom, parametres);
  }
}

const ETAPES = ["coordonnees", "garde", "observations"];
const etapesCommencees = new Set();

/* Suivi des étapes */
function mesurerEtape(field) {
  const carte = field.closest(".step-card");
  const etape = ETAPES[[...form.querySelectorAll(".step-card")].indexOf(carte)];

  if (!etape || etapesCommencees.has(etape)) {
    return;
  }

  etapesCommencees.add(etape);
  mesurer("formulaire_etape", { etape });
}

function init() {
  if (!form) {
    return;
  }

  form.addEventListener("submit", handleSubmit);
  startedAtField.value = String(Date.now());

  initDynamicFields();
  initDatePickers();
  restoreDraft();
  attachFieldListeners();
  loadUnavailableRanges();

  newRequestButton?.addEventListener("click", resetForNewRequest);

  submitButton.disabled = !submitNote.hidden;
  form.setAttribute("data-actif", "");
}

function initDynamicFields() {
  toggleOtherFrequency(frequencyField.value);
  frequencyField.addEventListener("change", () => {
    toggleOtherFrequency(frequencyField.value);
    clearFieldError("frequence");
    saveDraft();
  });

  initCommuneAutocomplete();
  initAdresseAutocomplete();
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
    onDayCreate(dObj, dStr, instance, dayElement) {
      markUnavailableDay(dayElement, dayElement.dateObj);
    },
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
    onDayCreate(dObj, dStr, instance, dayElement) {
      markUnavailableDay(dayElement, dayElement.dateObj);
    },
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


/* Suggestions */
function brancherSuggestions({ champ, liste, longueurMin, chercher, auSaisie }) {
  if (!champ || !liste) {
    return;
  }

  const conteneur = champ.closest("[data-autocomplete]");
  let minuterie = null;
  let controleur = null;

  const fermer = () => {
    liste.innerHTML = "";
    liste.hidden = true;
    liste.classList.remove("is-open");
    champ.setAttribute("aria-expanded", "false");
  };

  const afficher = (options = []) => {
    liste.innerHTML = "";

    if (!options.length) {
      fermer();
      return;
    }

    for (const { principal, detail, choisir } of options) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "autocomplete__option";
      option.setAttribute("role", "option");

      const ligne1 = document.createElement("span");
      ligne1.className = "autocomplete__option-main";
      ligne1.textContent = principal;

      const ligne2 = document.createElement("small");
      ligne2.className = "autocomplete__option-meta";
      ligne2.textContent = detail;

      option.append(ligne1, ligne2);
      option.addEventListener("click", () => {
        choisir();
        fermer();
        saveDraft();
      });

      liste.append(option);
    }

    liste.hidden = false;
    liste.classList.add("is-open");
    champ.setAttribute("aria-expanded", "true");
  };

  champ.addEventListener("input", () => {
    auSaisie?.();
    saveDraft();

    window.clearTimeout(minuterie);

    const requete = champ.value.trim();
    if (requete.length < longueurMin) {
      fermer();
      return;
    }

    minuterie = window.setTimeout(async () => {
      controleur?.abort();
      controleur = new AbortController();

      try {
        afficher(await chercher(requete, controleur.signal));
      } catch (error) {
        if (error.name !== "AbortError") {
          fermer();
        }
      }
    }, 220);
  });

  champ.addEventListener("focus", () => {
    if (champ.value.trim().length >= longueurMin && liste.childElementCount > 0) {
      liste.hidden = false;
      liste.classList.add("is-open");
      champ.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (event) => {
    if (!conteneur?.contains(event.target)) {
      fermer();
    }
  });

  champ.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      fermer();
    }
  });
}

function initCommuneAutocomplete() {
  brancherSuggestions({
    champ: communeInput,
    liste: communeSuggestions,
    longueurMin: 2,
    chercher: chercherCommunes,
    auSaisie: () => {
      communeCodeInput.value = "";
      communeCodePostalInput.value = "";
      clearFieldError("commune");
    },
  });
}

/* Rues de la commune */
function initAdresseAutocomplete() {
  brancherSuggestions({
    champ: adresseInput,
    liste: adresseSuggestions,
    longueurMin: 3,
    chercher: chercherAdresses,
  });
}

async function chercherCommunes(query, signal) {
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

  let communes;

  try {
    const response = await fetch(`${COMMUNE_ENDPOINT}?${params.toString()}`, {
      signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Impossible de récupérer les communes.");
    }

    communes = await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    communes = getFallbackCommunes(query);
  }

  return (Array.isArray(communes) ? communes : []).map((commune) => {
    const postalCode = Array.isArray(commune.codesPostaux) && commune.codesPostaux.length
      ? commune.codesPostaux[0]
      : "";

    return {
      principal: commune.nom || "",
      detail: postalCode || "Commune",
      choisir: () => {
        communeInput.value = postalCode ? `${commune.nom} (${postalCode})` : commune.nom;
        communeCodeInput.value = commune.code || "";
        communeCodePostalInput.value = postalCode;
      },
    };
  });
}

async function chercherAdresses(query, signal) {
  const commune = communeInput.value.trim();
  const params = new URLSearchParams({ autocomplete: "1", limit: "6" });

  if (communeCodeInput.value) {
    params.set("q", query);
    params.set("citycode", communeCodeInput.value);
  } else {
    params.set("q", commune ? `${query} ${commune}` : query);
  }

  const response = await fetch(`${ADRESSE_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return [];
  }

  const { features = [] } = await response.json();

  return features.map(({ properties = {} }) => ({
    principal: properties.name || "",
    detail: [properties.postcode, properties.city].filter(Boolean).join(" "),
    choisir: () => {
      adresseInput.value = properties.name || "";
    },
  }));
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

async function loadUnavailableRanges() {
  availabilityNote.textContent = "Vérification des disponibilités en cours…";

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

    if (!state.unavailableRanges.length) {
      availabilityNote.textContent = "Aucune indisponibilité n’est enregistrée pour le moment.";
    } else if (state.isFlatpickrAvailable) {
      availabilityNote.textContent = "Les dates grisées dans le calendrier sont celles où je ne suis pas disponible.";
    } else {
      availabilityNote.textContent = "Choisissez vos dates, je vous dis aussitôt ce que je peux assurer.";
    }
  } catch (error) {
    state.availabilityLoaded = false;
    availabilityNote.textContent = "Les disponibilités n’ont pas pu être chargées pour le moment. Votre demande sera revérifiée côté serveur.";
  }
}

/* Jours indisponibles */
function applyUnavailableRangesToPickers() {
  state.startPicker?.redraw?.();
  state.endPicker?.redraw?.();
}

function markUnavailableDay(dayElement, date) {
  const iso = isoFromLocalDate(date);
  const indisponible = state.unavailableRanges.some(
    (range) => iso >= range.startDate && iso <= range.endDate
  );

  dayElement.classList.toggle("jour-indisponible", indisponible);

  if (indisponible) {
    dayElement.setAttribute("aria-description", "Je ne suis pas disponible ce jour-là");
  } else {
    dayElement.removeAttribute("aria-description");
  }
}

/* Date locale */
function isoFromLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const mois = `${date.getMonth() + 1}`.padStart(2, "0");
  const jour = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${mois}-${jour}`;
}

function attachFieldListeners() {
  const interactiveFields = form.querySelectorAll("input, select, textarea");

  interactiveFields.forEach((field) => {
    if (field.name === "website") {
      return;
    }

    field.addEventListener("input", () => {
      const key = toFieldKey(field.name || field.id);

      mesurerEtape(field);

      if (key) {
        clearFieldError(key);
      }

      if (key === "dateDebut" || key === "dateFin") {
        clearFieldError("dateRange");
      }

      saveDraft();
    });

    field.addEventListener("change", () => {
      mesurerEtape(field);
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
    adresse: "adresse",
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
    adresse: formData.get("adresse"),
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
    renderAvailability("", "");
    return true;
  }

  if (start && !isIsoDate(start)) {
    setFieldError("dateDebut", "Merci de choisir une date de début valide.");
    renderAvailability("", "");
    return false;
  }

  if (start && start < TODAY_ISO) {
    setFieldError("dateDebut", "Les dates passées ne sont pas disponibles.");
    renderAvailability("", "");
    return false;
  }

  if (!end) {
    renderAvailability("", "");
    return true;
  }

  if (!isIsoDate(end)) {
    setFieldError("dateFin", "Merci de choisir une date de fin valide.");
    renderAvailability("", "");
    return false;
  }

  if (start && end < start) {
    setFieldError("dateFin", "La date de fin doit être postérieure ou égale à la date de début.");
    renderAvailability("", "");
    return false;
  }

  return renderAvailability(start, end);
}

/* ------------------------------------------------------------------ */
/* Recapitulatif de la periode choisie                                 */
/* ------------------------------------------------------------------ */

/** Seuil du relais */
const JOURS_AVANT_RELAIS_EN_TETE = 2;

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Récapitulatif */
function renderAvailability(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start || !state.availabilityLoaded) {
    periodeRecap.hidden = true;
    relaisBloc.hidden = true;
    setSubmitBlocked(false);
    return true;
  }

  const couverts = availableSegments(start, end, state.unavailableRanges);
  const decouverts = complementSegments(start, end, couverts);
  const joursCouverts = compterJours(couverts);
  const joursTotal = nombreDeJours(start, end);

  periodePhrase.textContent = typographie(
    phraseDisponibilite(start, end, couverts, decouverts, joursCouverts, joursTotal)
  );
  dessinerBarre(start, end, couverts, decouverts);

  periodeBornes.innerHTML = "";
  periodeBornes.append(borne(start), borne(end));

  periodeLegende.hidden = joursCouverts === 0 || joursCouverts === joursTotal;
  periodeRecap.hidden = false;

  if (joursCouverts === joursTotal) {
    relaisBloc.hidden = true;
    setSubmitBlocked(false);
    return true;
  }

  relaisTexte.textContent = typographie(texteRelais(joursCouverts, decouverts, end));
  relaisBloc.hidden = false;
  setSubmitBlocked(joursCouverts === 0);
  mesurerRelais(start, end, joursCouverts);

  return joursCouverts > 0;
}

let dernierRelaisMesure = "";

/* Suivi du relais */
function mesurerRelais(start, end, joursCouverts) {
  const periode = `${start}_${end}`;

  if (periode === dernierRelaisMesure) {
    return;
  }

  dernierRelaisMesure = periode;
  mesurer("relais_affiche", { envoi_ferme: joursCouverts === 0 });
}

/** Envoi bloqué */
function setSubmitBlocked(bloque) {
  submitButton.disabled = bloque;
  submitNote.hidden = !bloque;
}

function phraseDisponibilite(start, end, couverts, decouverts, joursCouverts, joursTotal) {
  if (joursCouverts === joursTotal) {
    return `Je suis disponible ${formaterSegment({ startDate: start, endDate: end })}, sur toute la période.`;
  }

  if (joursCouverts === 0) {
    return `Je ne prends pas de réservation ${formaterSegment({ startDate: start, endDate: end })}.`;
  }

  const morceaux = enumerer(couverts.map(formaterSegment));
  const cequejefais = joursCouverts <= JOURS_AVANT_RELAIS_EN_TETE
    ? `Sur cette période, je ne peux assurer que ${morceaux}.`
    : `Je peux assurer ${morceaux}${couverts.length === 1 ? " inclus" : ""}.`;

  return `${cequejefais} ${phraseAbsence(start, end, decouverts)}`;
}

/** Jours non couverts */
function phraseAbsence(start, end, decouverts) {
  if (decouverts.length === 1) {
    const seul = decouverts[0];

    if (seul.endDate === end) {
      return `À partir du ${formaterJour(seul.startDate)}, je ne suis pas disponible.`;
    }

    if (seul.startDate === start) {
      return `Jusqu’au ${formaterJour(seul.endDate)}, je ne suis pas disponible.`;
    }
  }

  return `${majuscule(enumerer(decouverts.map(formaterSegment)))}, je ne suis pas disponible.`;
}

const ENSEIGNE_TIERS = "La Maison Koala";
const COMMUNE_TIERS = "Argentré-du-Plessis";

function texteRelais(joursCouverts, decouverts, end) {
  const confiance = "Elle a toute ma confiance.";

  if (joursCouverts === 0) {
    return `Pour ces dates, contactez Éva. ${confiance}`;
  }

  if (joursCouverts <= JOURS_AVANT_RELAIS_EN_TETE) {
    return `Pour une garde d’un seul tenant, contactez Éva. ${confiance} Si vous préférez que je prenne ces jours-là, envoyez-moi votre demande, on se relaiera.`;
  }

  const enFinDeSejour = decouverts.length === 1 && decouverts[0].endDate === end;
  const quels = enFinDeSejour ? "Pour les jours suivants" : "Pour les jours que je ne couvre pas";

  return `${quels}, Éva peut prendre le relais. ${confiance}`;
}

/* Barre à l'échelle */
function dessinerBarre(start, end, couverts, decouverts) {
  const morceaux = [
    ...couverts.map((segment) => ({ ...segment, couvert: true })),
    ...decouverts.map((segment) => ({ ...segment, couvert: false })),
  ].sort((a, b) => a.startDate.localeCompare(b.startDate));

  periodeBarre.innerHTML = "";

  for (const morceau of morceaux) {
    const part = document.createElement("span");
    part.className = morceau.couvert ? "periode__seg--oui" : "periode__seg--non";
    part.style.flexGrow = String(nombreDeJours(morceau.startDate, morceau.endDate));
    periodeBarre.append(part);
  }
}

function borne(iso) {
  const element = document.createElement("span");
  element.textContent = formaterJourCourt(iso);
  return element;
}

/* ------------------------------------------------------------------ */
/* Dates en toutes lettres                                             */
/* ------------------------------------------------------------------ */

/** Jours hors couverture */
function complementSegments(start, end, couverts) {
  const trous = [];
  let curseur = start;

  for (const segment of couverts) {
    if (segment.startDate > curseur) {
      trous.push({ startDate: curseur, endDate: decalerJour(segment.startDate, -1) });
    }
    curseur = decalerJour(segment.endDate, 1);
  }

  if (curseur && curseur <= end) {
    trous.push({ startDate: curseur, endDate: end });
  }

  return trous;
}

function partsIso(iso) {
  const [annee, mois, jour] = iso.split("-").map(Number);
  return { annee, mois, jour };
}

function decalerJour(iso, pas) {
  const { annee, mois, jour } = partsIso(iso);
  const date = new Date(Date.UTC(annee, mois - 1, jour + pas));
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const j = `${date.getUTCDate()}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${m}-${j}`;
}

function nombreDeJours(start, end) {
  const a = partsIso(start);
  const b = partsIso(end);
  const depart = Date.UTC(a.annee, a.mois - 1, a.jour);
  const arrivee = Date.UTC(b.annee, b.mois - 1, b.jour);
  return Math.round((arrivee - depart) / 86400000) + 1;
}

function compterJours(segments) {
  return segments.reduce((total, segment) => total + nombreDeJours(segment.startDate, segment.endDate), 0);
}

/** Quantième */
function quantieme(iso) {
  const { jour } = partsIso(iso);
  return jour === 1 ? "1er" : String(jour);
}

/** Jour en lettres */
function formaterJour(iso) {
  const { annee, mois } = partsIso(iso);
  const anneeCourante = Number(TODAY_ISO.slice(0, 4));
  return `${quantieme(iso)} ${MOIS[mois - 1]}${annee === anneeCourante ? "" : ` ${annee}`}`;
}

/* Abréviations des mois */
const MOIS_COURTS = [
  "janv.", "févr.", "mars", "avril", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

/** Version courte */
function formaterJourCourt(iso) {
  const { mois } = partsIso(iso);
  return `${quantieme(iso)} ${MOIS_COURTS[mois - 1]}`;
}

/** Plage de dates */
function formaterSegment(segment) {
  const { startDate, endDate } = segment;
  const jours = nombreDeJours(startDate, endDate);
  const memeMois = startDate.slice(0, 7) === endDate.slice(0, 7);
  const debut = memeMois ? quantieme(startDate) : formaterJour(startDate);

  if (jours === 1) {
    return `le ${formaterJour(startDate)}`;
  }

  if (jours === 2) {
    return `les ${debut} et ${formaterJour(endDate)}`;
  }

  return `du ${debut} au ${formaterJour(endDate)}`;
}

/** Énumération */
function enumerer(morceaux) {
  if (morceaux.length <= 1) {
    return morceaux[0] || "";
  }

  if (morceaux.length === 2) {
    return `${morceaux[0]}, puis ${morceaux[1]}`;
  }

  return `${morceaux.slice(0, -1).join(", ")}, puis ${morceaux[morceaux.length - 1]}`;
}

function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/* Insécables */
function typographie(texte) {
  const lierMotsCourts = (t) => t.replace(/(\s|^)(\S)\s/g, "$1$2 ");
  return lierMotsCourts(lierMotsCourts(texte)).replace(/ (\S+)$/, " $1");
}

async function handleSubmit(event) {
  event.preventDefault();
  hideAlert();
  clearAllErrors();

  const payload = getFormPayload();
  const validation = validateReservationPayload(payload, state.unavailableRanges);

  mesurer("formulaire_envoi_tente");

  if (!validation.isValid) {
  mesurer("formulaire_erreurs", { champs: Object.keys(validation.errors).join(",") });
  applyErrors(validation.errors);
  focusFirstError(validation.errors);
  return;
  }

  const hCaptchaResponse = getHCaptchaResponse();

  if (isHCaptchaExpected() && !hCaptchaResponse) {
  mesurer("formulaire_erreurs", { champs: "antispam" });
  showAlert(
    "error",
    "Merci de valider la vérification anti-spam avant d’envoyer votre demande."
  );
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
      mesurer("formulaire_erreurs", { champs: `serveur_${response.status}` });
      showAlert("error", message);
      focusFirstError(result?.errors || {});
      return;
    }

    // Notification
    let notificationEnvoyee = true;

    try {
      await sendWeb3FormsNotification(
        validation.sanitized,
        result?.reservationId || "",
        hCaptchaResponse
      );
    } catch (notificationError) {
      notificationEnvoyee = false;
      console.warn("Demande enregistrée mais notification non partie", notificationError);
      await signalerNotificationEchouee(result?.reservationId || "");
    }

    if (typeof gtag === "function") {
      gtag("event", "generate_lead", {
        form_name: "reservation",
      });
    }

    sessionStorage.removeItem(DRAFT_KEY);
    form.hidden = true;
    afficherPanneauSucces(notificationEnvoyee);
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

function isHCaptchaExpected() {
  return Boolean(document.querySelector(".h-captcha"));
}

function getHCaptchaResponse() {
  return document
    .querySelector('textarea[name="h-captcha-response"]')
    ?.value
    ?.trim() || "";
}

function resetHCaptcha() {
  try {
    if (window.hcaptcha && typeof window.hcaptcha.reset === "function") {
      window.hcaptcha.reset();
    }
  } catch (error) {
    console.warn("Unable to reset hCaptcha", error);
  }
}

/** Écran de confirmation */
function afficherPanneauSucces(notificationEnvoyee) {
  const relance = document.getElementById("success-relance");
  const titre = document.getElementById("success-title");
  const eyebrow = document.getElementById("success-eyebrow");
  const message = document.getElementById("success-message");

  if (relance) {
    relance.hidden = notificationEnvoyee;
  }

  if (!notificationEnvoyee) {
    if (eyebrow) eyebrow.textContent = "Demande enregistrée";
    if (titre) titre.textContent = "Votre demande est bien enregistrée.";
    if (message) message.textContent = "Elle porte vos dates et vos coordonnées.";
  }

  successPanel.hidden = false;
  successPanel.setAttribute("aria-hidden", "false");
  successPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Marque non notifiée */
async function signalerNotificationEchouee(reservationId) {
  if (!reservationId) {
    return;
  }

  try {
    await fetch(ENDPOINTS.notificationEchouee(reservationId), {
      method: "POST",
      headers: { Accept: "application/json" },
      keepalive: true,
    });
  } catch (error) {
    console.warn("Signalement de la notification échouée impossible", error);
  }
}

async function sendWeb3FormsNotification(payload, reservationId = "", hCaptchaResponse = "") {
  if (!WEB3FORMS_ACCESS_KEY) {
    throw new Error("La configuration d’envoi d’e-mail est incomplète. Merci de me contacter directement.");
  }

  if (isHCaptchaExpected() && !hCaptchaResponse) {
    throw new Error("La vérification anti-spam est incomplète.");
  }

  try {
    const response = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildWeb3FormsPayload(payload, reservationId, hCaptchaResponse)),
    });

    const result = await safeJson(response);

    if (!response.ok || result?.success === false) {
      console.error("Web3Forms notification failed", {
        status: response.status,
        result,
      });

      const detail =
        result?.message ||
        result?.body?.message ||
        "Erreur inconnue côté Web3Forms.";

      throw new Error(
        `Notification Web3Forms échouée : ${detail}`
      );
    }

    return result;
  } finally {
    resetHCaptcha();
  }
}

function buildWeb3FormsPayload(payload, reservationId = "", hCaptchaResponse = "") {
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
    "h-captcha-response": hCaptchaResponse,
    subject: buildReservationSubject(payload),
    from_name: "Miaoucratie Webform",
    nom: payload.nom,
    prenom: payload.prenom,
    email: payload.email,
    telephone: payload.telephone,
    whatsapp: payload.whatsapp || "Non renseigné",
    commune: payload.commune,
    commune_code_postal: payload.communeCodePostal || "",
    nombre_chats: String(payload.nombreChats),
    date_debut: payload.dateDebut,
    date_fin: payload.dateFin,
    frequence: frequenceLabel,
    observations: payload.observations || "",
    submitted_at: submittedAt,
    reservation_id: reservationId,
    adresse: payload.adresse || "",
    adresse_complete: adresseComplete(payload),
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
    "adresse",
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
  let draft = null;

  try {
    draft = safeParseJson(sessionStorage.getItem(DRAFT_KEY));
  } catch (error) {
    return;
  }

  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return;
  }

  try {
    appliquerBrouillon(draft);
  } catch (error) {
    console.warn("Brouillon ignoré", error);
  }

  validateDatesLive();
}

/* Brouillon */
function appliquerBrouillon(draft) {
  const texte = (valeur) => (typeof valeur === "string" || typeof valeur === "number" ? String(valeur) : "");
  const remplir = (champ, valeur) => {
    if (champ) {
      champ.value = valeur;
    }
  };

  remplir(form.querySelector("#nom"), texte(draft.nom));
  remplir(form.querySelector("#prenom"), texte(draft.prenom));
  remplir(form.querySelector("#telephone"), texte(draft.telephone));
  remplir(form.querySelector("#email"), texte(draft.email));
  remplir(form.querySelector("#whatsapp"), texte(draft.whatsapp));
  remplir(communeInput, texte(draft.commune));
  remplir(communeCodeInput, texte(draft.communeCode));
  remplir(communeCodePostalInput, texte(draft.communeCodePostal));
  remplir(form.querySelector("#adresse"), texte(draft.adresse));
  remplir(form.querySelector("#nombreChats"), Number.isFinite(draft.nombreChats) ? String(draft.nombreChats) : "");
  remplir(frequencyField, texte(draft.frequence));
  toggleOtherFrequency(frequencyField.value);
  remplir(otherFrequencyInput, texte(draft.autreFrequence));
  remplir(form.querySelector("#observations"), texte(draft.observations));

  if (Number.isSafeInteger(draft.startedAt) && draft.startedAt > 0) {
    startedAtField.value = String(draft.startedAt);
  }

  const debut = normalizeDateInput(texte(draft.dateDebut));
  const debutValide = isIsoDate(debut) && debut >= TODAY_ISO;

  if (debutValide) {
    state.startPicker?.setDate(debut, false, "Y-m-d");
    syncPickerIsoValue(state.startPicker, debut);
    state.endPicker?.set("minDate", debut);
  }

  const fin = normalizeDateInput(texte(draft.dateFin));

  if (isIsoDate(fin) && fin >= (debutValide ? debut : TODAY_ISO)) {
    state.endPicker?.setDate(fin, false, "Y-m-d");
    syncPickerIsoValue(state.endPicker, fin);
  }
}


function resetForNewRequest() {
  successPanel.hidden = true;
  // Remise à zéro
  const relance = document.getElementById("success-relance");
  if (relance) relance.hidden = true;
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
