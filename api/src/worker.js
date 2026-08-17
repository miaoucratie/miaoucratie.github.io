import {
  sanitizeReservationPayload,
  sanitizeUnavailabilityPayload,
  validateReservationPayload,
  validateUnavailabilityPayload,
} from "../../shared/booking-utils.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

/** Envois du formulaire public tolerés par quart d'heure et par IP. */
const QUOTA_DEMANDES = 4;

/**
 * Echecs de connexion admin tolérés par quart d'heure et par IP.
 *
 * Plus large que le quota public : se tromper de mot de passe puis se
 * corriger est normal, essayer dix mots de passe en un quart d'heure ne l'est
 * pas. Une connexion réussie ne consomme rien.
 */
const QUOTA_CONNEXIONS_ADMIN = 10;

/** Demandes remontées à l'administration, de la plus récente à la plus ancienne. */
const DEMANDES_AFFICHEES = 60;

/**
 * Etats d'une demande de reservation.
 *
 * Le Worker enregistre la demande, mais c'est le navigateur du visiteur qui
 * envoie l'e-mail de notification, et cet envoi peut echouer sans que
 * personne ne le sache. `notification_echouee` est pose par le navigateur
 * quand il constate cet echec : la demande apparait alors en tete de la liste
 * d'administration. Seul l'echec est signalable — un signalement forge ne peut
 * donc que rendre une demande plus visible, jamais la faire disparaitre.
 */
const STATUT_RECUE = "received";
const STATUT_NOTIFICATION_ECHOUEE = "notification_echouee";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request, env),
        });
      }

      assertOriginAllowed(request, env);

      if (url.pathname === "/public/unavailabilities" && request.method === "GET") {
        const ranges = await listUnavailabilities(env);
        return jsonResponse({ ranges }, 200, request, env);
      }

      if (url.pathname === "/public/reservations" && request.method === "POST") {
        return await handlePublicReservation(request, env);
      }

      const notificationMatch = url.pathname.match(
        /^\/public\/reservations\/([0-9a-f-]{36})\/notification-echouee$/i
      );

      if (notificationMatch && request.method === "POST") {
        return await handleNotificationEchouee(request, env, notificationMatch[1]);
      }

      if (url.pathname === "/admin/login" && request.method === "POST") {
        return await handleAdminLogin(request, env);
      }

      if (url.pathname === "/admin/reservations" && request.method === "GET") {
        await assertAdmin(request, env);
        const demandes = await listReservations(env);
        return jsonResponse({ demandes }, 200, request, env);
      }

      if (url.pathname === "/admin/unavailabilities" && request.method === "GET") {
        await assertAdmin(request, env);
        const ranges = await listUnavailabilities(env, { includePast: true });
        return jsonResponse({ ranges }, 200, request, env);
      }

      if (url.pathname === "/admin/unavailabilities" && request.method === "POST") {
        await assertAdmin(request, env);
        return await handleCreateUnavailability(request, env);
      }

      const updateMatch = url.pathname.match(/^\/admin\/unavailabilities\/(\d+)$/);

      if (updateMatch && request.method === "PUT") {
        await assertAdmin(request, env);
        return await handleUpdateUnavailability(request, env, Number(updateMatch[1]));
      }

      if (updateMatch && request.method === "DELETE") {
        await assertAdmin(request, env);
        return await handleDeleteUnavailability(request, env, Number(updateMatch[1]));
      }

      return jsonResponse({ message: "Route introuvable." }, 404, request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(
          {
            message: error.message,
            ...(error.errors ? { errors: error.errors } : {}),
          },
          error.status,
          request,
          env
        );
      }

      return jsonResponse(
        { message: "Une erreur inattendue est survenue côté serveur." },
        500,
        request,
        env
      );
    }
  },
};

async function handlePublicReservation(request, env) {
  const payload = sanitizeReservationPayload(await parseJson(request));
  const unavailableRanges = await listUnavailabilities(env, { includePast: false });
  const validation = validateReservationPayload(payload, unavailableRanges);

  if (!validation.isValid) {
    throw new HttpError(400, "Le formulaire contient des erreurs.", validation.errors);
  }

  if (!payload.startedAt || Date.now() - Number(payload.startedAt) < 3500) {
    throw new HttpError(
      400,
      "Le formulaire a été envoyé trop vite. Merci de vérifier vos informations et de réessayer."
    );
  }

  const ipHash = await hashIp(request);
  const submissionsCount = await countRecentSubmissions(env, ipHash);

  if (submissionsCount >= QUOTA_DEMANDES) {
    throw new HttpError(
      429,
      "Trop d’envois en peu de temps. Merci de patienter quelques minutes avant de réessayer."
    );
  }

  const reservationId = crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO reservation_requests (
        id, nom, prenom, telephone, whatsapp, email, commune, commune_code, commune_code_postal, nombre_chats,
        date_debut, date_fin, frequence, frequence_autre, observations, ip_hash, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      reservationId,
      validation.sanitized.nom,
      validation.sanitized.prenom,
      validation.sanitized.telephone,
      validation.sanitized.whatsapp,
      validation.sanitized.email,
      validation.sanitized.commune,
      validation.sanitized.communeCode,
      validation.sanitized.communeCodePostal,
      validation.sanitized.nombreChats,
      validation.sanitized.dateDebut,
      validation.sanitized.dateFin,
      validation.sanitized.frequence,
      validation.sanitized.autreFrequence,
      validation.sanitized.observations,
      ipHash,
      STATUT_RECUE
    )
    .run();

  return jsonResponse(
    {
      message: "Votre demande a bien été enregistrée.",
      reservationId,
    },
    200,
    request,
    env
  );
}

/**
 * Signale que la notification par e-mail d'une demande n'est pas partie.
 *
 * Route publique, volontairement : c'est le navigateur du visiteur qui
 * constate l'echec, et il n'a aucun jeton. Elle ne peut que faire passer une
 * demande de « recue » a « notification echouee », donc la rendre plus
 * visible dans l'administration. Une demande deja traitee n'est pas touchee.
 */
async function handleNotificationEchouee(request, env, reservationId) {
  await env.DB.prepare(
    "UPDATE reservation_requests SET status = ? WHERE id = ? AND status = ?"
  )
    .bind(STATUT_NOTIFICATION_ECHOUEE, reservationId, STATUT_RECUE)
    .run();

  return jsonResponse({ message: "Signalement enregistré." }, 200, request, env);
}

async function handleAdminLogin(request, env) {
  const payload = await parseJson(request);
  const password = String(payload?.password || "").trim();

  if (!password) {
    throw new HttpError(400, "Merci de renseigner le mot de passe d’administration.");
  }

  // Le quota se lit avant de comparer quoi que ce soit : au-dela, la reponse
  // ne depend plus du mot de passe propose, elle ne renseigne donc plus.
  const ipHash = await hashIp(request);

  if ((await countRecentLoginFailures(env, ipHash)) >= QUOTA_CONNEXIONS_ADMIN) {
    throw new HttpError(
      429,
      "Trop de tentatives de connexion. Merci de patienter un quart d’heure."
    );
  }

  if (!timingSafeEqual(password, String(env.ADMIN_PASSWORD ?? ""))) {
    await recordLoginFailure(env, ipHash);
    throw new HttpError(401, "Mot de passe invalide.");
  }

  const token = await signAdminToken(env);
  return jsonResponse(
    {
      token,
      expiresInSeconds: 60 * 60 * 12,
    },
    200,
    request,
    env
  );
}

async function handleCreateUnavailability(request, env) {
  const payload = sanitizeUnavailabilityPayload(await parseJson(request));
  const validation = validateUnavailabilityPayload(payload);

  if (!validation.isValid) {
    throw new HttpError(400, "Les dates saisies sont invalides.", validation.errors);
  }

  const result = await env.DB.prepare(
    "INSERT INTO unavailability_periods (start_date, end_date, comment) VALUES (?, ?, ?)"
  )
    .bind(validation.sanitized.startDate, validation.sanitized.endDate, validation.sanitized.comment || "")
    .run();

  const period = await env.DB.prepare(
    "SELECT id, start_date AS startDate, end_date AS endDate, comment FROM unavailability_periods WHERE id = ?"
  )
    .bind(result.meta.last_row_id)
    .first();

  return jsonResponse(
    {
      message: "Indisponibilité ajoutée.",
      period,
    },
    201,
    request,
    env
  );
}

async function handleUpdateUnavailability(request, env, id) {
  const existing = await env.DB.prepare(
    "SELECT id FROM unavailability_periods WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!existing) {
    throw new HttpError(404, "Indisponibilité introuvable.");
  }

  const payload = sanitizeUnavailabilityPayload(await parseJson(request));
  const validation = validateUnavailabilityPayload(payload);

  if (!validation.isValid) {
    throw new HttpError(400, "Les dates saisies sont invalides.", validation.errors);
  }

  await env.DB.prepare(
    `
      UPDATE unavailability_periods
      SET start_date = ?, end_date = ?, comment = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  )
    .bind(validation.sanitized.startDate, validation.sanitized.endDate, validation.sanitized.comment || "", id)
    .run();

  const period = await env.DB.prepare(
    "SELECT id, start_date AS startDate, end_date AS endDate, comment FROM unavailability_periods WHERE id = ?"
  )
    .bind(id)
    .first();

  return jsonResponse(
    {
      message: "Indisponibilité mise à jour.",
      period,
    },
    200,
    request,
    env
  );
}

async function handleDeleteUnavailability(request, env, id) {
  const existing = await env.DB.prepare(
    "SELECT id FROM unavailability_periods WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!existing) {
    throw new HttpError(404, "Indisponibilité introuvable.");
  }

  await env.DB.prepare("DELETE FROM unavailability_periods WHERE id = ?")
    .bind(id)
    .run();

  return jsonResponse(
    { message: "Indisponibilité supprimée." },
    200,
    request,
    env
  );
}

async function listUnavailabilities(env, options = {}) {
  const includePast = Boolean(options.includePast);
  const query = includePast
    ? "SELECT id, start_date AS startDate, end_date AS endDate, comment FROM unavailability_periods ORDER BY start_date ASC, end_date ASC"
    : "SELECT id, start_date AS startDate, end_date AS endDate, comment FROM unavailability_periods WHERE end_date >= date('now') ORDER BY start_date ASC, end_date ASC";

  const result = await env.DB.prepare(query).all();
  return result.results || [];
}

/**
 * Demandes remontees a l'administration.
 *
 * Jusqu'ici rien ne lisait cette table : une demande enregistree dont l'e-mail
 * de notification n'etait pas parti n'existait nulle part de consultable. Les
 * demandes signalees comme non notifiees passent en tete, ce sont celles qui
 * n'ont peut-etre jamais ete vues.
 */
async function listReservations(env) {
  const result = await env.DB.prepare(
    `
      SELECT
        id, submitted_at AS soumiseLe, status AS statut,
        nom, prenom, telephone, whatsapp, email,
        commune, commune_code_postal AS communeCodePostal, nombre_chats AS nombreChats,
        date_debut AS dateDebut, date_fin AS dateFin,
        frequence, frequence_autre AS frequenceAutre, observations
      FROM reservation_requests
      ORDER BY (status = ?) DESC, submitted_at DESC
      LIMIT ?
    `
  )
    .bind(STATUT_NOTIFICATION_ECHOUEE, DEMANDES_AFFICHEES)
    .all();

  return result.results || [];
}

async function countRecentSubmissions(env, ipHash) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM reservation_requests WHERE ip_hash = ? AND submitted_at >= datetime('now', '-15 minutes')"
  )
    .bind(ipHash)
    .first();

  return Number(row?.count || 0);
}

async function countRecentLoginFailures(env, ipHash) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM admin_login_attempts WHERE ip_hash = ? AND attempted_at >= datetime('now', '-15 minutes')"
  )
    .bind(ipHash)
    .first();

  return Number(row?.count || 0);
}

async function recordLoginFailure(env, ipHash) {
  await env.DB.prepare("INSERT INTO admin_login_attempts (ip_hash) VALUES (?)")
    .bind(ipHash)
    .run();
}

/** Empreinte de l'IP appelante : elle sert de cle de quota, jamais d'identite. */
function hashIp(request) {
  return hashString(
    request.headers.get("CF-Connecting-IP")
      || request.headers.get("x-forwarded-for")
      || "unknown"
  );
}


async function parseJson(request) {
  try {
    return await request.json();
  } catch (error) {
    throw new HttpError(400, "Le corps de la requête doit être un JSON valide.");
  }
}

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function assertOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = getAllowedOrigins(env);

  if (!origin || !allowedOrigins.length || allowedOrigins.includes("*")) {
    return;
  }

  if (!allowedOrigins.includes(origin)) {
    throw new HttpError(403, "Origine non autorisée.");
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = getAllowedOrigins(env);
  const accessControlOrigin =
    !origin || !allowedOrigins.length
      ? "*"
      : allowedOrigins.includes("*")
        ? "*"
        : allowedOrigins.includes(origin)
          ? origin
          : allowedOrigins[0];

  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": accessControlOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request, env),
  });
}

class HttpError extends Error {
  constructor(status, message, errors = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.errors = errors;
  }
}

async function signAdminToken(env) {
  const payload = {
    scope: "admin",
    exp: Date.now() + 1000 * 60 * 60 * 12,
  };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSign(payloadPart, env.ADMIN_TOKEN_SECRET);
  return `${payloadPart}.${signature}`;
}

async function assertAdmin(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    throw new HttpError(401, "Authentification requise.");
  }

  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) {
    throw new HttpError(401, "Jeton invalide.");
  }

  const isValidSignature = await hmacVerify(payloadPart, signature, env.ADMIN_TOKEN_SECRET);
  if (!isValidSignature) {
    throw new HttpError(401, "Jeton invalide.");
  }

  const payload = JSON.parse(base64UrlDecode(payloadPart));

  if (!payload?.exp || Number(payload.exp) < Date.now()) {
    throw new HttpError(401, "Session expirée. Merci de vous reconnecter.");
  }
}

async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(signatureBuffer);
}

async function hmacVerify(value, signature, secret) {
  const expected = await hmacSign(value, secret);
  return timingSafeEqual(expected, signature);
}

async function hashString(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a = "", b = "") {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function base64UrlEncode(input) {
  const bytes =
    input instanceof ArrayBuffer ? new Uint8Array(input) : new TextEncoder().encode(String(input));

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
