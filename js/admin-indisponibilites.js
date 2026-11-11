import {
  dateHeureD1,
  demandesRecentes,
  formatDateFr,
  isoFromDate,
  normalizeDateInput,
  sanitizeUnavailabilityPayload,
  separerPassees,
  toDate,
  todayIso,
  validateUnavailabilityPayload,
} from "../shared/booking-utils.js";

const API_BASE = document
  .querySelector('meta[name="miaoucratie-api-base"]')
  ?.getAttribute("content")
  ?.trim() || "";

const ENDPOINTS = {
  login: `${API_BASE}/admin/login`,
  periods: `${API_BASE}/admin/unavailabilities`,
  demandes: `${API_BASE}/admin/reservations`,
};

/** Statut non notifié */
const STATUT_NOTIFICATION_ECHOUEE = "notification_echouee";

/** Demandes récentes */
const JOURS_DEMANDES = 30;

/** Format de date */
const FORMAT_JOUR = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const SESSION_KEY = "miaoucratie:reservation:admin-token:v1";

const loginPanel = document.getElementById("login-panel");
const managementPanel = document.getElementById("management-panel");
const loginForm = document.getElementById("admin-login-form");
const loginButton = document.getElementById("admin-login-button");
const loginFeedback = document.getElementById("admin-login-feedback");
const adminFeedback = document.getElementById("admin-feedback");
const unavailabilityForm = document.getElementById("unavailability-form");
const savePeriodButton = document.getElementById("save-period-button");
const refreshButton = document.getElementById("refresh-periods-button");
const logoutButton = document.getElementById("logout-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const periodList = document.getElementById("period-list");
const periodCount = document.getElementById("period-count");
const periodArchive = document.getElementById("period-archive");
const demandeList = document.getElementById("demande-list");
const demandeCount = document.getElementById("demande-count");
const formTitle = document.getElementById("admin-form-title");

const state = {
  token: sessionStorage.getItem(SESSION_KEY) || "",
  editingId: null,
};

init();

function init() {
  bindEvents();

  if (state.token) {
    showManagement();
    loadPeriods();
    loadDemandes();
  } else {
    showLogin();
  }
}

function bindEvents() {
  loginForm?.addEventListener("submit", handleLogin);
  unavailabilityForm?.addEventListener("submit", handleSavePeriod);
  refreshButton?.addEventListener("click", () => {
    loadPeriods(true);
    loadDemandes();
  });
  logoutButton?.addEventListener("click", logout);
  cancelEditButton?.addEventListener("click", resetPeriodForm);

  ["startDate", "endDate", "comment"].forEach((fieldId) => {
    document.getElementById(fieldId)?.addEventListener("input", () => {
      clearFormError(fieldId);
      hideAdminFeedback();
    });
  });
}

function showLogin() {
  loginPanel.hidden = false;
  managementPanel.hidden = true;
}

function showManagement() {
  loginPanel.hidden = true;
  managementPanel.hidden = false;
}

function getAdminDateFieldValue(fieldId) {
  const input = document.getElementById(fieldId);
  const raw = input?.value || "";

  if (raw) {
    const normalized = normalizeDateInput(raw);
    if (normalized) {
      return normalized;
    }
  }

  if (input?.valueAsDate instanceof Date && Number.isFinite(input.valueAsDate.getTime())) {
    return isoFromDate(
      new Date(Date.UTC(
        input.valueAsDate.getFullYear(),
        input.valueAsDate.getMonth(),
        input.valueAsDate.getDate()
      ))
    );
  }

  return "";
}


async function handleLogin(event) {
  event.preventDefault();
  clearLoginError();
  hideLoginFeedback();
  setButtonLoading(loginButton, true);

  const passwordInput = document.getElementById("admin-password");
  const password = passwordInput.value.trim();

  if (!password) {
    setLoginError("Merci de renseigner votre mot de passe.");
    setButtonLoading(loginButton, false);
    return;
  }

  try {
    const response = await fetch(ENDPOINTS.login, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ password }),
    });

    const result = await safeJson(response);

    if (!response.ok || !result?.token) {
      const message = result?.message || "Connexion impossible. Merci de vérifier votre mot de passe.";
      setLoginError(message);
      return;
    }

    state.token = result.token;
    sessionStorage.setItem(SESSION_KEY, result.token);
    passwordInput.value = "";
    showManagement();
    showAdminFeedback("success", "Connexion réussie.");
    loadPeriods();
    loadDemandes();
  } catch (error) {
    setLoginError("Une erreur réseau est survenue. Merci de réessayer.");
  } finally {
    setButtonLoading(loginButton, false);
  }
}

async function loadPeriods(silent = false) {
  if (!state.token) {
    showLogin();
    return;
  }

  if (!silent) {
    showAdminFeedback("success", "Chargement des indisponibilités…");
  }

  try {
    const response = await fetch(ENDPOINTS.periods, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.token}`,
      },
    });

    const result = await safeJson(response);

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok) {
      throw new Error(result?.message || "Impossible de charger les indisponibilités.");
    }

    const periods = Array.isArray(result?.ranges) ? result.ranges : [];
    renderPeriods(periods);

    if (!silent) {
      showAdminFeedback("success", "Indisponibilités chargées.");
    }
  } catch (error) {
    showAdminFeedback("error", error.message || "Une erreur est survenue pendant le chargement.");
  }
}

function renderPeriods(periods = []) {
  const { aVenir, passees } = separerPassees(periods, todayIso());
  const pluriel = aVenir.length > 1 ? "s" : "";

  periodCount.textContent = periods.length
    ? `${aVenir.length} période${pluriel} à venir`
    : "0 période enregistrée";

  remplirListe(
    periodList,
    aVenir.map(creerCartePeriode),
    periods.length ? "Aucune indisponibilité à venir." : "Aucune indisponibilité enregistrée pour le moment."
  );
  remplirArchive(periodArchive, passees.map(creerCartePeriode));
}

function creerCartePeriode(period) {
  const card = element("article", "period-card");
  const actions = element("div", "period-card__actions");

  actions.append(
    bouton("Modifier", "button--secondary", () => populatePeriodForm(period)),
    bouton("Supprimer", "button--ghost", () => handleDeletePeriod(period))
  );
  card.append(
    element("p", "period-card__dates", formatPeriode(period.startDate, period.endDate)),
    element("p", "period-card__comment", period.comment || "Aucun commentaire"),
    actions
  );
  return card;
}

/** Demandes reçues */
async function loadDemandes() {
  if (!state.token || !demandeList) {
    return;
  }

  try {
    const response = await fetch(ENDPOINTS.demandes, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.token}`,
      },
    });

    const result = await safeJson(response);

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok) {
      throw new Error(result?.message || "Impossible de charger les demandes.");
    }

    renderDemandes(Array.isArray(result?.demandes) ? result.demandes : []);
  } catch (error) {
    remplirListe(demandeList, [], error.message || "Chargement des demandes impossible.");
  }
}

function renderDemandes(demandes = []) {
  const recentes = demandesRecentes(demandes, new Date(), JOURS_DEMANDES);
  const enAlerte = recentes.filter((d) => d.statut === STATUT_NOTIFICATION_ECHOUEE).length;
  const pluriel = recentes.length > 1 ? "s" : "";

  demandeCount.textContent = `${recentes.length} demande${pluriel} reçue${pluriel} en ${JOURS_DEMANDES}\u00a0jours${
    enAlerte ? ` · ${enAlerte} sans e-\u2060mail de notification` : ""
  }`;

  remplirListe(
    demandeList,
    recentes.map(creerCarteDemande),
    `Aucune demande reçue ces ${JOURS_DEMANDES}\u00a0derniers jours.`
  );
}

function creerCarteDemande(demande) {
  const card = element("article", "period-card demande-card");

  if (demande.statut === STATUT_NOTIFICATION_ECHOUEE) {
    card.append(element(
      "p",
      "demande-card__alerte",
      "⚠ L’e-mail de notification n’est pas parti : cette demande n’a peut-être jamais été vue."
    ));
  }

  const tete = element("div", "demande-card__tete");
  tete.append(
    element("h4", "demande-card__nom", `${demande.prenom || ""} ${demande.nom || ""}`.trim()),
    element("p", "period-card__dates", formatPeriode(demande.dateDebut, demande.dateFin)),
    element("p", "demande-card__recue", `Reçue le ${formatDateHeure(demande.soumiseLe).replace(" à ", " à\u00a0")}`)
  );
  card.append(tete);

  const chats = Number(demande.nombreChats) || 0;
  const infos = element("dl", "demande-card__infos");
  ajouterInfo(infos, "Commune", demande.commune);
  ajouterInfo(infos, "Chats", String(chats));
  ajouterInfo(
    infos,
    "Visites",
    demande.frequence === "autre" ? demande.frequenceAutre || "autre besoin" : demande.frequence,
    "double"
  );
  ajouterInfo(infos, "Adresse", demande.adresse, "large");
  ajouterInfo(infos, "Contact", liensContact(demande), "large");
  ajouterInfo(infos, "Observations", demande.observations, "large");
  card.append(infos);

  return card;
}

/* largeur : large | double */
function ajouterInfo(liste, intitule, valeur, largeur = "") {
  const vide = valeur instanceof Node ? !valeur.childNodes.length : !valeur;
  if (vide) {
    return;
  }

  const ligne = element("div", `demande-card__info${largeur ? ` demande-card__info--${largeur}` : ""}`);
  const dd = element("dd");
  dd.append(valeur);
  ligne.append(element("dt", "", intitule), dd);
  liste.append(ligne);
}

function liensContact(demande) {
  const contact = element("span", "demande-card__contact");

  [
    demande.telephone && { texte: demande.telephone, href: `tel:${demande.telephone.replace(/\s+/g, "")}` },
    demande.whatsapp && { texte: `WhatsApp ${demande.whatsapp}`, href: `https://wa.me/${demande.whatsapp.replace(/\D/g, "")}` },
    demande.email && { texte: demande.email, href: `mailto:${demande.email}` },
  ].filter(Boolean).forEach((lien) => {
    const a = element("a", "", lien.texte);
    a.href = lien.href;
    contact.append(a);
  });

  return contact;
}

/* Liste et message vide */
function remplirListe(liste, cartes, messageVide) {
  liste.replaceChildren(...(cartes.length ? cartes : [element("p", "empty-state", messageVide)]));
}

/* Périodes terminées */
function remplirArchive(archive, cartes) {
  archive.hidden = !cartes.length;
  archive.querySelector("[data-nombre]").textContent = `(${cartes.length})`;
  archive.querySelector(".period-list").replaceChildren(...cartes);
}

function element(tag, className = "", texte) {
  const noeud = document.createElement(tag);
  if (className) {
    noeud.className = className;
  }
  if (texte !== undefined) {
    noeud.textContent = texte;
  }
  return noeud;
}

function bouton(texte, variante, onClick) {
  const noeud = element("button", `button ${variante}`, texte);
  noeud.type = "button";
  noeud.addEventListener("click", onClick);
  return noeud;
}

/* Insécables */
function formatJour(valeur) {
  const date = toDate(valeur);
  return (date ? FORMAT_JOUR.format(date) : String(valeur || "")).replace(/ /g, "\u00a0");
}

function formatPeriode(debut, fin) {
  return `${formatJour(debut)}\u00a0→ ${formatJour(fin)}`;
}

/** Date D1 lisible */
function formatDateHeure(valeur = "") {
  const date = dateHeureD1(valeur);

  if (!Number.isFinite(date.getTime())) {
    return valeur || "date inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
}

function populatePeriodForm(period) {
  state.editingId = Number(period.id);
  document.getElementById("period-id").value = String(period.id);
  document.getElementById("startDate").value = period.startDate;
  document.getElementById("endDate").value = period.endDate;
  document.getElementById("comment").value = period.comment || "";
  formTitle.textContent = "Modifier une indisponibilité";
  cancelEditButton.hidden = false;
  hideAdminFeedback();
  clearFormErrors();
  document.getElementById("startDate").focus();
}

function resetPeriodForm() {
  state.editingId = null;
  unavailabilityForm.reset();
  document.getElementById("period-id").value = "";
  formTitle.textContent = "Ajouter une indisponibilité";
  cancelEditButton.hidden = true;
  clearFormErrors();
}

async function handleSavePeriod(event) {
  event.preventDefault();
  clearFormErrors();
  hideAdminFeedback();

  const payload = sanitizeUnavailabilityPayload({
    id: document.getElementById("period-id").value,
    startDate: getAdminDateFieldValue("startDate"),
    endDate: getAdminDateFieldValue("endDate"),
    comment: document.getElementById("comment").value,
  });

  const validation = validateUnavailabilityPayload(payload);

  if (!validation.isValid) {
    applyFormErrors(validation.errors);
    focusFirstFormError(validation.errors);
    return;
  }

  const isEditing = Boolean(state.editingId);
  setButtonLoading(savePeriodButton, true);

  try {
    const response = await fetch(
      isEditing ? `${ENDPOINTS.periods}/${state.editingId}` : ENDPOINTS.periods,
      {
        method: isEditing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify(validation.sanitized),
      }
    );

    const result = await safeJson(response);

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok) {
      if (result?.errors) {
        applyFormErrors(result.errors);
      }
      throw new Error(result?.message || "Enregistrement impossible.");
    }

    resetPeriodForm();
    showAdminFeedback("success", isEditing ? "Indisponibilité mise à jour." : "Indisponibilité ajoutée.");
    await loadPeriods(true);
  } catch (error) {
    showAdminFeedback("error", error.message || "Une erreur est survenue pendant l’enregistrement.");
  } finally {
    setButtonLoading(savePeriodButton, false);
  }
}

async function handleDeletePeriod(period) {
  if (!window.confirm(`Supprimer l’indisponibilité du ${formatDateFr(period.startDate)} au ${formatDateFr(period.endDate)} ?`)) {
    return;
  }

  hideAdminFeedback();

  try {
    const response = await fetch(`${ENDPOINTS.periods}/${period.id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.token}`,
      },
    });

    const result = await safeJson(response);

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok) {
      throw new Error(result?.message || "Suppression impossible.");
    }

    if (state.editingId === Number(period.id)) {
      resetPeriodForm();
    }

    showAdminFeedback("success", "Indisponibilité supprimée.");
    await loadPeriods(true);
  } catch (error) {
    showAdminFeedback("error", error.message || "Une erreur est survenue pendant la suppression.");
  }
}

function logout() {
  state.token = "";
  sessionStorage.removeItem(SESSION_KEY);
  resetPeriodForm();
  renderPeriods([]);
  renderDemandes([]);
  hideAdminFeedback();
  showLogin();
}

function setButtonLoading(button, isLoading) {
  button.classList.toggle("is-loading", isLoading);
  button.disabled = isLoading;
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function showAdminFeedback(type, message) {
  adminFeedback.hidden = false;
  adminFeedback.className = `alert alert--${type}`;
  adminFeedback.textContent = message;
}

function hideAdminFeedback() {
  adminFeedback.hidden = true;
  adminFeedback.className = "alert";
  adminFeedback.textContent = "";
}

function setLoginError(message) {
  const errorEl = document.getElementById("admin-password-error");
  document.getElementById("admin-password").setAttribute("aria-invalid", "true");
  errorEl.textContent = message;
}

function clearLoginError() {
  const errorEl = document.getElementById("admin-password-error");
  document.getElementById("admin-password").setAttribute("aria-invalid", "false");
  errorEl.textContent = "";
}

function hideLoginFeedback() {
  loginFeedback.hidden = true;
  loginFeedback.className = "alert";
  loginFeedback.textContent = "";
}

function applyFormErrors(errors = {}) {
  Object.entries(errors).forEach(([fieldName, message]) => {
    const errorEl = document.getElementById(`${fieldName}-error`);
    const input = document.getElementById(fieldName);
    if (errorEl) {
      errorEl.textContent = message;
    }
    if (input) {
      input.setAttribute("aria-invalid", "true");
    }
  });
}

function clearFormError(fieldName) {
  const errorEl = document.getElementById(`${fieldName}-error`);
  const input = document.getElementById(fieldName);
  if (errorEl) {
    errorEl.textContent = "";
  }
  if (input) {
    input.setAttribute("aria-invalid", "false");
  }
}

function clearFormErrors() {
  ["startDate", "endDate", "comment"].forEach(clearFormError);
}

function focusFirstFormError(errors = {}) {
  const order = ["startDate", "endDate", "comment"];
  const first = order.find((fieldName) => errors[fieldName]);
  if (first) {
    document.getElementById(first)?.focus();
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}
