import {
  formatDateFr,
  isoFromDate,
  normalizeDateInput,
  sanitizeUnavailabilityPayload,
  validateUnavailabilityPayload,
} from "../shared/booking-utils.js";

const API_BASE = document
  .querySelector('meta[name="miaoucratie-api-base"]')
  ?.getAttribute("content")
  ?.trim() || "";

const ENDPOINTS = {
  login: `${API_BASE}/admin/login`,
  periods: `${API_BASE}/admin/unavailabilities`,
};

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
  } else {
    showLogin();
  }
}

function bindEvents() {
  loginForm?.addEventListener("submit", handleLogin);
  unavailabilityForm?.addEventListener("submit", handleSavePeriod);
  refreshButton?.addEventListener("click", () => loadPeriods(true));
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
  periodList.innerHTML = "";

  if (!periods.length) {
    periodCount.textContent = "0 période enregistrée";
    periodList.innerHTML = '<p class="empty-state">Aucune indisponibilité enregistrée pour le moment.</p>';
    return;
  }

  periodCount.textContent = `${periods.length} période${periods.length > 1 ? "s" : ""} enregistrée${periods.length > 1 ? "s" : ""}`;

  periods.forEach((period) => {
    const card = document.createElement("article");
    card.className = "period-card";

    const dates = document.createElement("p");
    dates.className = "period-card__dates";
    dates.textContent = `${formatDateFr(period.startDate)} → ${formatDateFr(period.endDate)}`;

    const comment = document.createElement("p");
    comment.className = "period-card__comment";
    comment.textContent = period.comment || "Aucun commentaire";

    const actions = document.createElement("div");
    actions.className = "period-card__actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "button button--secondary";
    editButton.textContent = "Modifier";
    editButton.addEventListener("click", () => populatePeriodForm(period));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "button button--ghost";
    deleteButton.textContent = "Supprimer";
    deleteButton.addEventListener("click", () => handleDeletePeriod(period));

    actions.append(editButton, deleteButton);
    card.append(dates, comment, actions);
    periodList.append(card);
  });
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
