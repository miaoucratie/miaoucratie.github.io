// Tests de l'API

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { baseD1 } from './base-de-test.js';

const ORIGINE = 'https://miaoucratie.fr';
const SECRET = 'secret-de-test';
const MOT_DE_PASSE = 'mot-de-passe-de-test';
const ID = '11111111-2222-3333-4444-555555555555';

// Clés de test Cloudflare
const CLE_PASSE = '1x0000000000000000000000000000000AA';
const CLE_ECHOUE = '2x0000000000000000000000000000000AA';
const CLE_DEJA_UTILISE = '3x0000000000000000000000000000000AA';
const JETON = 'XXXX.DUMMY.TOKEN.XXXX';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const HOTE = 'example.com';

function siteverifySimule(corps) {
  if (corps.secret === CLE_PASSE) {
    return {
      success: true, challenge_ts: '2026-11-13T10:00:00.000Z', hostname: HOTE, action: 'reservation', 'error-codes': [],
    };
  }
  if (corps.secret === CLE_DEJA_UTILISE) return { success: false, 'error-codes': ['timeout-or-duplicate'] };
  if (corps.secret === CLE_ECHOUE) return { success: false, 'error-codes': ['invalid-input-response'] };
  return { success: false, 'error-codes': ['invalid-input-secret'] };
}

// Journal du serveur
const journal = [];
const logOrigine = console.log;
console.log = (...elements) => journal.push(elements.join(' '));
after(() => { console.log = logOrigine; });

// Aucun appel réseau réel
const fetchOrigine = globalThis.fetch;
const reseauInterdit = async (url, options) => {
  if (url === SITEVERIFY) return Response.json(siteverifySimule(JSON.parse(options.body)));
  throw new Error(`appel réseau interdit : ${url}`);
};
globalThis.fetch = reseauInterdit;
after(() => { globalThis.fetch = fetchOrigine; });

async function avecReseau(simulation, action) {
  globalThis.fetch = simulation;
  try {
    return await action();
  } finally {
    globalThis.fetch = reseauInterdit;
  }
}

const env = (extra = {}) => ({
  DB: baseD1(),
  ALLOWED_ORIGINS: ORIGINE,
  ADMIN_PASSWORD: MOT_DE_PASSE,
  ADMIN_TOKEN_SECRET: SECRET,
  TURNSTILE_SECRET_KEY: CLE_PASSE,
  TURNSTILE_HOSTNAME: HOTE,
  ...extra,
});

function contexte() {
  const attentes = [];
  return { attentes, waitUntil(promesse) { attentes.push(promesse); } };
}

const appeler = async (chemin, options = {}) => {
  const {
    methode = 'GET', corps, entetes = {}, origine = ORIGINE, environnement = env(), ctx = contexte(),
  } = options;
  const request = new Request(`https://api.test${chemin}`, {
    method: methode,
    headers: {
      ...(origine ? { Origin: origine } : {}),
      ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...entetes,
    },
    ...(corps !== undefined ? { body: typeof corps === 'string' ? corps : JSON.stringify(corps) } : {}),
  });
  const reponse = await worker.fetch(request, environnement, ctx);
  await Promise.all(ctx.attentes);
  return reponse;
};

async function empreinte(valeur) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valeur));
  return [...new Uint8Array(digest)].map((octet) => octet.toString(16).padStart(2, '0')).join('');
}

const EMPREINTE_SANS_IP = await empreinte('unknown');

const lignes = (environnement, sql, ...valeurs) =>
  environnement.DB.sqlite.prepare(sql).all(...valeurs).map((ligne) => ({ ...ligne }));

const demandesEnBase = (environnement) =>
  lignes(environnement, 'SELECT * FROM reservation_requests ORDER BY submitted_at, id');

function ajouterIndisponibilite(environnement, startDate, endDate, comment = '') {
  environnement.DB.sqlite
    .prepare('INSERT INTO unavailability_periods (start_date, end_date, comment) VALUES (?, ?, ?)')
    .run(startDate, endDate, comment);
}

const LIGNE_DEMANDE = {
  id: ID, nom: 'Martin', prenom: 'Claire', telephone: '0612345678', whatsapp: '',
  email: 'claire@example.fr', commune: 'Domagné (35113)', commune_code: '35099',
  commune_code_postal: '35113', adresse: '12 rue des Lilas', nombre_chats: 2,
  date_debut: '2099-06-01', date_fin: '2099-06-10', frequence: 'autre',
  frequence_autre: '2 visites le samedi', observations: 'Deux chats\ntrès câlins',
  ip_hash: 'empreinte', status: 'received', submitted_at: '2026-11-09 17:08:15',
};

function ajouterDemande(environnement, champs = {}) {
  const ligne = { ...LIGNE_DEMANDE, ...champs };
  const colonnes = Object.keys(ligne);
  environnement.DB.sqlite
    .prepare(`INSERT INTO reservation_requests (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`)
    .run(...Object.values(ligne));
  return ligne;
}

function ajouterEnvoisRecents(environnement, nombre, ipHash = EMPREINTE_SANS_IP, decalage = '-1 minutes') {
  for (let rang = 0; rang < nombre; rang += 1) {
    environnement.DB.sqlite
      .prepare(`INSERT INTO reservation_requests (id, nom, prenom, commune, nombre_chats, date_debut, date_fin,
        frequence, ip_hash, status, submitted_at) VALUES (?, 'N', 'P', 'Vitré', 1, '2099-01-01', '2099-01-02',
        '1 visite par jour', ?, 'received', datetime('now', ?))`)
      .run(`envoi-${rang}`, ipHash, decalage);
  }
}

function ajouterEchecsConnexion(environnement, nombre, ipHash = EMPREINTE_SANS_IP, decalage = '-1 minutes') {
  for (let rang = 0; rang < nombre; rang += 1) {
    environnement.DB.sqlite
      .prepare("INSERT INTO admin_login_attempts (ip_hash, attempted_at) VALUES (?, datetime('now', ?))")
      .run(ipHash, decalage);
  }
}

async function jetonValide(environnement = env()) {
  const reponse = await appeler('/admin/login', {
    methode: 'POST', corps: { password: MOT_DE_PASSE }, environnement,
  });
  assert.equal(reponse.status, 200, 'la connexion admin devrait reussir');
  return (await reponse.json()).token;
}

async function signerJeton(charge, secret = SECRET) {
  const encoder = new TextEncoder();
  const b64url = (buffer) => Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const partieCharge = b64url(encoder.encode(JSON.stringify(charge)));
  const cle = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cle, encoder.encode(partieCharge));
  return `${partieCharge}.${b64url(signature)}`;
}

const demandeValide = (extra = {}) => ({
  nom: 'Dupont', prenom: 'Marie', telephone: '0612345678',
  email: 'marie@example.com', commune: 'Domagné', nombreChats: 2,
  dateDebut: '2099-06-01', dateFin: '2099-06-10',
  frequence: '1 visite par jour',
  startedAt: Date.now() - 10_000,
  turnstileToken: JETON,
  ...extra,
});

describe('liste publique des indisponibilites', () => {
  test('dates seules', async () => {
    const environnement = env();
    ajouterIndisponibilite(environnement, '2099-06-01', '2099-06-05', 'vacances');
    const reponse = await appeler('/public/unavailabilities', { environnement });
    assert.equal(reponse.status, 200);
    assert.deepEqual((await reponse.json()).ranges, [{ id: 1, startDate: '2099-06-01', endDate: '2099-06-05' }]);

    const requetes = environnement.DB.requetes.filter((sql) => sql.includes('unavailability_periods'));
    assert.equal(requetes.length, 1);
    assert.ok(!requetes[0].includes('comment'));
  });

  test('periodes passees', async () => {
    const environnement = env();
    ajouterIndisponibilite(environnement, '2000-01-01', '2000-01-05');
    ajouterIndisponibilite(environnement, '2099-06-01', '2099-06-05');
    const { ranges } = await (await appeler('/public/unavailabilities', { environnement })).json();
    assert.deepEqual(ranges.map((r) => r.startDate), ['2099-06-01']);
  });

  test('commentaire en administration', async () => {
    const environnement = env();
    ajouterIndisponibilite(environnement, '2099-06-01', '2099-06-05', 'vacances');
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/unavailabilities', {
      environnement, entetes: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 200);
    assert.equal((await reponse.json()).ranges[0].comment, 'vacances');
  });
});

describe('indisponibilites cote administration', () => {
  test('ajout, modification et suppression', async () => {
    const environnement = env();
    const jeton = await jetonValide(environnement);
    const entetes = { Authorization: `Bearer ${jeton}` };

    const ajout = await appeler('/admin/unavailabilities', {
      methode: 'POST', corps: { startDate: '2099-07-01', endDate: '2099-07-03', comment: 'congé' },
      environnement, entetes,
    });
    assert.equal(ajout.status, 201);
    const { period } = await ajout.json();
    assert.deepEqual(period, { id: 1, startDate: '2099-07-01', endDate: '2099-07-03', comment: 'congé' });

    const modification = await appeler('/admin/unavailabilities/1', {
      methode: 'PUT', corps: { startDate: '2099-07-02', endDate: '2099-07-04', comment: '' },
      environnement, entetes,
    });
    assert.equal(modification.status, 200);
    assert.deepEqual(
      lignes(environnement, 'SELECT start_date, end_date, comment FROM unavailability_periods'),
      [{ start_date: '2099-07-02', end_date: '2099-07-04', comment: '' }]
    );

    const suppression = await appeler('/admin/unavailabilities/1', { methode: 'DELETE', environnement, entetes });
    assert.equal(suppression.status, 200);
    assert.equal(lignes(environnement, 'SELECT id FROM unavailability_periods').length, 0);
  });

  test('periode absente', async () => {
    const environnement = env();
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/unavailabilities/7', {
      methode: 'DELETE', environnement, entetes: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 404);
  });
});

describe('origines', () => {
  test('origine connue', async () => {
    const reponse = await appeler('/public/unavailabilities');
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get('Access-Control-Allow-Origin'), ORIGINE);
  });

  test('origine inconnue', async () => {
    const reponse = await appeler('/public/unavailabilities', { origine: 'https://autre-site.fr' });
    assert.equal(reponse.status, 403);
    assert.match((await reponse.json()).message, /Origine non autorisée/);
  });

  test('origine inconnue, en-tete de reponse', async () => {
    const reponse = await appeler('/public/unavailabilities', { origine: 'https://autre-site.fr' });
    assert.notEqual(reponse.headers.get('Access-Control-Allow-Origin'), 'https://autre-site.fr');
  });

  test('sans origine', async () => {
    const reponse = await appeler('/public/unavailabilities', { origine: null });
    assert.equal(reponse.status, 200);
  });

  test('liste ouverte', async () => {
    const reponse = await appeler('/public/unavailabilities', {
      origine: 'https://nimporte-ou.fr', environnement: env({ ALLOWED_ORIGINS: '*' }),
    });
    assert.equal(reponse.status, 200);
  });

  test('liste a plusieurs origines', async () => {
    const environnement = env({ ALLOWED_ORIGINS: ' https://a.fr , https://b.fr ' });
    assert.equal((await appeler('/public/unavailabilities', { origine: 'https://b.fr', environnement })).status, 200);
    assert.equal((await appeler('/public/unavailabilities', { origine: 'https://c.fr', environnement })).status, 403);
  });

  test('prevol OPTIONS', async () => {
    const reponse = await appeler('/admin/unavailabilities', { methode: 'OPTIONS' });
    assert.equal(reponse.status, 204);
    assert.match(reponse.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.equal(reponse.headers.get('Vary'), 'Origin');
  });
});

describe('connexion administrateur', () => {
  test('mot de passe absent', async () => {
    const reponse = await appeler('/admin/login', { methode: 'POST', corps: {} });
    assert.equal(reponse.status, 400);
  });

  test('mot de passe vide', async () => {
    assert.equal((await appeler('/admin/login', { methode: 'POST', corps: { password: '   ' } })).status, 400);
  });

  test('mauvais mot de passe', async () => {
    const reponse = await appeler('/admin/login', { methode: 'POST', corps: { password: 'pas-le-bon' } });
    assert.equal(reponse.status, 401);
  });

  test('bon mot de passe', async () => {
    const environnement = env();
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/unavailabilities', {
      environnement, entetes: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 200);
  });

  test('corps illisible', async () => {
    const reponse = await appeler('/admin/login', { methode: 'POST', corps: 'ceci n est pas du json' });
    assert.equal(reponse.status, 400);
  });
});

describe('jeton administrateur', () => {
  const routesProtegees = [
    ['GET', '/admin/unavailabilities'],
    ['POST', '/admin/unavailabilities'],
    ['PUT', '/admin/unavailabilities/1'],
    ['DELETE', '/admin/unavailabilities/1'],
    ['GET', '/admin/reservations'],
  ];

  for (const [methode, chemin] of routesProtegees) {
    test(`${methode} ${chemin} sans jeton`, async () => {
      const reponse = await appeler(chemin, { methode, corps: methode === 'GET' ? undefined : {} });
      assert.equal(reponse.status, 401);
    });
  }

  test('en-tete sans prefixe', async () => {
    const jeton = await jetonValide();
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: jeton } });
    assert.equal(reponse.status, 401);
  });

  test('jeton sans separateur', async () => {
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: 'Bearer jetonsanspoint' } });
    assert.equal(reponse.status, 401);
  });

  test('signature differente', async () => {
    const jeton = await jetonValide();
    const [charge] = jeton.split('.');
    const reponse = await appeler('/admin/unavailabilities', {
      entetes: { Authorization: `Bearer ${charge}.signature-inventee` },
    });
    assert.equal(reponse.status, 401);
  });

  test('autre secret', async () => {
    const jeton = await signerJeton({ scope: 'admin', exp: Date.now() + 60_000 }, 'mauvais-secret');
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 401);
  });

  test('jeton expire', async () => {
    const jeton = await signerJeton({ scope: 'admin', exp: Date.now() - 1000 });
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 401);
    assert.match((await reponse.json()).message, /Session expirée/);
  });

  test('jeton sans expiration', async () => {
    const jeton = await signerJeton({ scope: 'admin' });
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 401);
  });

  test('charge modifiee', async () => {
    const jetonLong = await signerJeton({ scope: 'admin', exp: Date.now() + 10_000_000 });
    const [charge, signature] = jetonLong.split('.');
    const autreCharge = (await signerJeton({ scope: 'admin', exp: Date.now() + 99_000_000 })).split('.')[0];
    assert.notEqual(charge, autreCharge);
    const reponse = await appeler('/admin/unavailabilities', {
      entetes: { Authorization: `Bearer ${autreCharge}.${signature}` },
    });
    assert.equal(reponse.status, 401);
  });
});

describe('envois du formulaire', () => {
  test('sous la limite', async () => {
    const environnement = env();
    ajouterEnvoisRecents(environnement, 3);
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 200);
    assert.equal(demandesEnBase(environnement).length, 4, 'la demande aurait du etre enregistree');
  });

  test('limite atteinte', async () => {
    const environnement = env();
    ajouterEnvoisRecents(environnement, 4);
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 429);
    assert.equal(demandesEnBase(environnement).length, 4);
  });

  test('envois anciens', async () => {
    const environnement = env();
    ajouterEnvoisRecents(environnement, 4, EMPREINTE_SANS_IP, '-16 minutes');
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 200);
  });

  test('autre adresse', async () => {
    const environnement = env();
    ajouterEnvoisRecents(environnement, 4, await empreinte('198.51.100.1'));
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
      entetes: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    assert.equal(reponse.status, 200);
  });

  test('enregistrement de la demande', async () => {
    const environnement = env();
    const reponse = await appeler('/public/reservations', {
      methode: 'POST',
      corps: demandeValide({ adresse: '12 rue des Lilas', frequence: 'Autre besoin à préciser', autreFrequence: 'le samedi' }),
      environnement,
    });
    const { reservationId } = await reponse.json();
    const [ligne] = demandesEnBase(environnement);
    assert.equal(ligne.id, reservationId);
    assert.deepEqual(
      {
        nom: ligne.nom, prenom: ligne.prenom, telephone: ligne.telephone, whatsapp: ligne.whatsapp,
        email: ligne.email, commune: ligne.commune, adresse: ligne.adresse, nombre_chats: ligne.nombre_chats,
        date_debut: ligne.date_debut, date_fin: ligne.date_fin, frequence: ligne.frequence,
        frequence_autre: ligne.frequence_autre, status: ligne.status,
      },
      {
        nom: 'Dupont', prenom: 'Marie', telephone: '0612345678', whatsapp: '', email: 'marie@example.com',
        commune: 'Domagné', adresse: '12 rue des Lilas', nombre_chats: 2, date_debut: '2099-06-01',
        date_fin: '2099-06-10', frequence: 'autre', frequence_autre: 'le samedi', status: 'notification_echouee',
      }
    );
  });

  test('adresse du visiteur', async () => {
    const environnement = env();
    await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
      entetes: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    const [ligne] = demandesEnBase(environnement);
    assert.ok(!Object.values(ligne).map(String).includes('203.0.113.42'));
    assert.equal(ligne.ip_hash, await empreinte('203.0.113.42'));
  });
});

describe('controles de la demande', () => {
  test('sans horodatage', async () => {
    const environnement = env();
    const corps = demandeValide();
    delete corps.startedAt;
    const reponse = await appeler('/public/reservations', { methode: 'POST', corps, environnement });
    assert.equal(reponse.status, 400);
    assert.equal(demandesEnBase(environnement).length, 0);
  });

  test('envoi rapide', async () => {
    const environnement = env();
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide({ startedAt: Date.now() - 500 }), environnement,
    });
    assert.equal(reponse.status, 400);
    assert.match((await reponse.json()).message, /trop vite/);
    assert.equal(demandesEnBase(environnement).length, 0);
  });

  test('champ annexe rempli', async () => {
    const environnement = env();
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide({ website: 'http://spam.example' }), environnement,
    });
    assert.equal(reponse.status, 400);
    assert.equal(demandesEnBase(environnement).length, 0);
  });

  test('champs invalides', async () => {
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide({ email: 'pas-une-adresse', nom: '' }),
    });
    assert.equal(reponse.status, 400);
    const { errors } = await reponse.json();
    assert.ok(errors.email, 'l e-mail aurait du etre signale');
    assert.ok(errors.nom, 'le nom aurait du etre signale');
  });

  test('periode entierement indisponible', async () => {
    const environnement = env();
    ajouterIndisponibilite(environnement, '2099-05-25', '2099-06-30');
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 400);
    assert.ok((await reponse.json()).errors.dateRange);
    assert.equal(demandesEnBase(environnement).length, 0);
  });

  test('periode en partie disponible', async () => {
    const environnement = env();
    ajouterIndisponibilite(environnement, '2099-06-05', '2099-06-20');
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 200);
    assert.equal(demandesEnBase(environnement).length, 1, 'la demande aurait du etre enregistree');
  });
});

describe('echecs de connexion', () => {
  const tentatives = (environnement) => lignes(environnement, 'SELECT ip_hash FROM admin_login_attempts');

  test('echec enregistre', async () => {
    const environnement = env();
    await appeler('/admin/login', { methode: 'POST', corps: { password: 'pas-le-bon' }, environnement });
    assert.deepEqual(tentatives(environnement), [{ ip_hash: EMPREINTE_SANS_IP }]);
  });

  test('connexion reussie', async () => {
    const environnement = env();
    await appeler('/admin/login', { methode: 'POST', corps: { password: MOT_DE_PASSE }, environnement });
    assert.equal(tentatives(environnement).length, 0);
  });

  test('sous la limite', async () => {
    const environnement = env();
    ajouterEchecsConnexion(environnement, 9);
    const reponse = await appeler('/admin/login', {
      methode: 'POST', corps: { password: 'pas-le-bon' }, environnement,
    });
    assert.equal(reponse.status, 401);
    assert.equal(tentatives(environnement).length, 10);
  });

  test('limite atteinte', async () => {
    const environnement = env();
    ajouterEchecsConnexion(environnement, 10);
    const reponse = await appeler('/admin/login', {
      methode: 'POST', corps: { password: 'pas-le-bon' }, environnement,
    });
    assert.equal(reponse.status, 429);
    assert.equal(tentatives(environnement).length, 10);
  });

  test('limite atteinte, bon mot de passe', async () => {
    const environnement = env();
    ajouterEchecsConnexion(environnement, 12);
    const reponse = await appeler('/admin/login', {
      methode: 'POST', corps: { password: MOT_DE_PASSE }, environnement,
    });
    assert.equal(reponse.status, 429);
  });

  test('echecs anciens', async () => {
    const environnement = env();
    ajouterEchecsConnexion(environnement, 10, EMPREINTE_SANS_IP, '-16 minutes');
    const reponse = await appeler('/admin/login', {
      methode: 'POST', corps: { password: MOT_DE_PASSE }, environnement,
    });
    assert.equal(reponse.status, 200);
  });

  test('adresse du visiteur', async () => {
    const environnement = env();
    await appeler('/admin/login', {
      methode: 'POST', corps: { password: 'pas-le-bon' }, environnement,
      entetes: { 'CF-Connecting-IP': '203.0.113.7' },
    });
    assert.deepEqual(tentatives(environnement), [{ ip_hash: await empreinte('203.0.113.7') }]);
  });
});

describe('liste des demandes', () => {
  const lire = async (environnement) => {
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/reservations', {
      entetes: { Authorization: `Bearer ${jeton}` }, environnement,
    });
    assert.equal(reponse.status, 200);
    return (await reponse.json()).demandes;
  };

  test('contenu', async () => {
    const environnement = env();
    ajouterDemande(environnement);
    assert.deepEqual(await lire(environnement), [{
      id: ID, soumiseLe: '2026-11-09 17:08:15', statut: 'received',
      nom: 'Martin', prenom: 'Claire', telephone: '0612345678', whatsapp: '', email: 'claire@example.fr',
      commune: 'Domagné (35113)', communeCodePostal: '35113', adresse: '12 rue des Lilas', nombreChats: 2,
      dateDebut: '2099-06-01', dateFin: '2099-06-10', frequence: 'autre', frequenceAutre: '2 visites le samedi',
      observations: 'Deux chats\ntrès câlins',
      joursCouverts: [{ startDate: '2099-06-01', endDate: '2099-06-10' }],
    }]);
  });

  test('jours couverts', async () => {
    const environnement = env();
    ajouterDemande(environnement);
    ajouterIndisponibilite(environnement, '2099-06-06', '2099-06-30');
    const [demande] = await lire(environnement);
    assert.deepEqual(demande.joursCouverts, [{ startDate: '2099-06-01', endDate: '2099-06-05' }]);
  });

  test('ordre', async () => {
    const environnement = env();
    ajouterDemande(environnement, { id: 'a', submitted_at: '2026-11-01 10:00:00' });
    ajouterDemande(environnement, { id: 'b', submitted_at: '2026-11-03 10:00:00' });
    ajouterDemande(environnement, { id: 'c', submitted_at: '2026-11-02 10:00:00', status: 'notification_echouee' });
    assert.deepEqual((await lire(environnement)).map((d) => d.id), ['c', 'b', 'a']);
  });

  test('longueur', async () => {
    const environnement = env();
    for (let rang = 0; rang < 61; rang += 1) ajouterDemande(environnement, { id: `d${rang}` });
    assert.equal((await lire(environnement)).length, 60);
  });
});

describe('ancienne route de signalement', () => {
  test('route retirée', async () => {
    const environnement = env({ MAKE_WEBHOOK_URL: 'https://relais.test/abc' });
    ajouterDemande(environnement);
    const avant = demandesEnBase(environnement);
    for (const methode of ['POST', 'GET']) {
      const reponse = await appeler(`/public/reservations/${ID}/notification-echouee`, { methode, environnement });
      assert.equal(reponse.status, 404, methode);
    }
    assert.deepEqual(demandesEnBase(environnement), avant);
  });
});

describe('routage', () => {
  test('une route inconnue rend 404', async () => {
    assert.equal((await appeler('/nawak')).status, 404);
  });

  test('la bonne route avec la mauvaise methode rend 404', async () => {
    assert.equal((await appeler('/public/reservations')).status, 404);
  });

  test('un identifiant non numerique ne correspond a aucune route admin', async () => {
    const environnement = env();
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/unavailabilities/abc', {
      methode: 'DELETE', environnement, entetes: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 404);
  });

  test('toute reponse porte les entetes CORS, y compris les erreurs', async () => {
    for (const reponse of [await appeler('/nawak'), await appeler('/admin/unavailabilities')]) {
      assert.ok(reponse.headers.get('Access-Control-Allow-Origin'), 'entete CORS absent');
      assert.equal(reponse.headers.get('Cache-Control'), 'no-store');
    }
  });
});

describe('agenda et itinéraire de l appli', () => {
  test('agenda sans jeton', async () => {
    const reponse = await appeler('/admin/calendar?date=2026-11-09', {
      environnement: env({ AGENDA_ICAL_URL: 'https://agenda.test/prive.ics' }),
    });
    assert.equal(reponse.status, 401);
  });

  test('sans adresse d agenda configurée, l erreur le dit', async () => {
    const environnement = env();
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/calendar?date=2026-11-09', {
      environnement, entetes: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 500);
    assert.equal((await reponse.json()).message, 'Agenda non configuré.');
  });

  test('itinéraire sans jeton', async () => {
    for (const calcul of ['loop', 'optimize']) {
      const reponse = await appeler(`/admin/routing/${calcul}`, {
        methode: 'POST', corps: { addresses: ['Vitré'] },
        environnement: env({ ADRESSE_DEPART: 'Domagné' }),
      });
      assert.equal(reponse.status, 401, calcul);
    }
  });

  test('trop d étapes', async () => {
    const environnement = env({ ADRESSE_DEPART: 'Domagné' });
    const jeton = await jetonValide(environnement);
    let appels = 0;
    const reponse = await avecReseau(
      async () => { appels += 1; throw new Error('aucun appel attendu'); },
      () => appeler('/admin/routing/optimize', {
        methode: 'POST', corps: { addresses: Array(11).fill('Vitré') },
        environnement, entetes: { Authorization: `Bearer ${jeton}` },
      }),
    );
    assert.equal(reponse.status, 400);
    assert.equal((await reponse.json()).message, 'Maximum 10 étapes par tournée.');
    assert.equal(appels, 0);
  });

  test('sans adresse de départ configurée, l erreur le dit', async () => {
    const environnement = env();
    const jeton = await jetonValide(environnement);
    const reponse = await appeler('/admin/routing/loop', {
      methode: 'POST', corps: { addresses: ['Vitré'] },
      environnement, entetes: { Authorization: `Bearer ${jeton}` },
    });
    assert.equal(reponse.status, 500);
    assert.equal((await reponse.json()).message, 'Adresse de départ non configurée.');
  });
});

describe('état public de l agenda', () => {
  test('agenda non configuré', async () => {
    const reponse = await appeler('/public/agenda-etat');
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { ok: false, raison: 'NON_CONFIGURE' });
  });
});

describe('demande avec jeton', () => {
  const RELAIS = 'https://relais.test/abc';
  const MESSAGE = "La vérification anti-robot n'a pas abouti. Merci de réessayer.";

  const envJeton = (extra = {}) => env({ MAKE_WEBHOOK_URL: RELAIS, ...extra });

  function reseau({ siteverify, relais } = {}) {
    const appels = { siteverify: [], relais: [] };
    const simulation = async (url, options) => {
      if (url === SITEVERIFY) {
        const corps = JSON.parse(options.body);
        appels.siteverify.push({ corps, options });
        return siteverify ? siteverify(corps) : Response.json(siteverifySimule(corps));
      }
      if (url === RELAIS) {
        appels.relais.push(JSON.parse(options.body));
        return relais ? relais() : new Response('relayee');
      }
      throw new Error(`appel réseau inattendu : ${url}`);
    };
    return { appels, simulation };
  }

  async function envoyer(environnement, corps, options = {}) {
    const { appels, simulation } = reseau(options);
    const reponse = await avecReseau(simulation, () => appeler('/public/reservations', {
      methode: 'POST', corps, environnement, entetes: options.entetes,
    }));
    return { reponse, appels };
  }

  const statuts = (environnement) => demandesEnBase(environnement).map((d) => d.status);

  test('sans jeton', async () => {
    for (const jeton of [undefined, null, '']) {
      const environnement = envJeton();
      const corps = demandeValide({ turnstileToken: jeton });
      if (jeton === undefined) delete corps.turnstileToken;
      const { reponse, appels } = await envoyer(environnement, corps);
      assert.equal(reponse.status, 400, String(jeton));
      assert.equal((await reponse.json()).message, MESSAGE, String(jeton));
      assert.equal(demandesEnBase(environnement).length, 0, String(jeton));
      assert.equal(appels.siteverify.length, 0, String(jeton));
      assert.equal(appels.relais.length, 0, String(jeton));
    }
  });

  test('mauvaise action', async () => {
    for (const action of ['autre', '', undefined]) {
      const environnement = envJeton();
      const siteverify = async (corps) => Response.json({ ...siteverifySimule(corps), action });
      const { reponse, appels } = await envoyer(environnement, demandeValide(), { siteverify });
      assert.equal(reponse.status, 400, String(action));
      assert.equal((await reponse.json()).message, MESSAGE, String(action));
      assert.equal(demandesEnBase(environnement).length, 0, String(action));
      assert.equal(appels.relais.length, 0, String(action));
    }
  });

  test('jeton valide', async () => {
    const environnement = envJeton();
    const { reponse, appels } = await envoyer(
      environnement,
      demandeValide({ turnstileToken: JETON, adresse: '12 rue des Lilas' }),
      { entetes: { 'CF-Connecting-IP': '203.0.113.42' } },
    );
    assert.equal(reponse.status, 200);
    const { reservationId } = await reponse.json();
    assert.deepEqual(statuts(environnement), ['relayee']);

    assert.equal(appels.siteverify.length, 1);
    assert.deepEqual(appels.siteverify[0].corps, { secret: CLE_PASSE, response: JETON, remoteip: '203.0.113.42' });
    assert.ok(appels.siteverify[0].options.signal instanceof AbortSignal);

    assert.equal(appels.relais.length, 1);
    const relai = appels.relais[0];
    assert.equal(relai.reservation_id, reservationId);
    assert.deepEqual(
      [relai.nom, relai.prenom, relai.email, relai.telephone, relai.commune, relai.adresse, relai.frequence],
      ['Dupont', 'Marie', 'marie@example.com', '0612345678', 'Domagné', '12 rue des Lilas', '1 visite par jour'],
    );
  });

  test('réponse avant le relais', { timeout: 2000 }, async () => {
    const environnement = envJeton();
    let liberer;
    const attente = new Promise((r) => { liberer = () => r(new Response('relayee')); });
    const { simulation, appels } = reseau({ relais: () => attente });
    const ctx = contexte();
    globalThis.fetch = simulation;
    try {
      const request = new Request('https://api.test/public/reservations', {
        method: 'POST', headers: { Origin: ORIGINE, 'Content-Type': 'application/json' },
        body: JSON.stringify(demandeValide({ turnstileToken: JETON })),
      });
      const reponse = await worker.fetch(request, environnement, ctx);
      assert.equal(reponse.status, 200);
      assert.equal(ctx.attentes.length, 1);
      assert.deepEqual(statuts(environnement), ['notification_echouee']);

      liberer();
      await Promise.all(ctx.attentes);
      assert.deepEqual(statuts(environnement), ['relayee']);
      assert.equal(appels.relais.length, 1);
    } finally {
      globalThis.fetch = reseauInterdit;
    }
  });

  test('relais en échec', async () => {
    const cas = [
      ['refus', envJeton(), { relais: async () => new Response('Queue is full.', { status: 400 }) }],
      ['mis en file', envJeton(), { relais: async () => new Response('Accepted') }],
      ['injoignable', envJeton(), { relais: async () => { throw new Error('délai dépassé'); } }],
      ['non configuré', envJeton({ MAKE_WEBHOOK_URL: undefined }), {}],
    ];
    for (const [nom, environnement, options] of cas) {
      const { reponse } = await envoyer(environnement, demandeValide({ turnstileToken: JETON }), options);
      assert.equal(reponse.status, 200, nom);
      assert.deepEqual(statuts(environnement), ['notification_echouee'], nom);
    }
  });

  test('vérification négative', async () => {
    const cas = [
      ['cle 2', envJeton({ TURNSTILE_SECRET_KEY: CLE_ECHOUE }), {}],
      ['cle 3', envJeton({ TURNSTILE_SECRET_KEY: CLE_DEJA_UTILISE }), {}],
      ['domaine', envJeton({ TURNSTILE_HOSTNAME: 'miaoucratie.fr' }), {}],
      ['injoignable', envJeton(), { siteverify: async () => { throw new Error('délai dépassé'); } }],
      ['erreur', envJeton(), { siteverify: async () => new Response('erreur', { status: 500 }) }],
      ['illisible', envJeton(), { siteverify: async () => new Response('pas du json') }],
      ['succes texte', envJeton(), { siteverify: async () => Response.json({ success: 'true', hostname: 'example.com' }) }],
    ];
    for (const [nom, environnement, options] of cas) {
      const { reponse, appels } = await envoyer(environnement, demandeValide({ turnstileToken: JETON }), options);
      assert.equal(reponse.status, 400, nom);
      assert.equal((await reponse.json()).message, MESSAGE, nom);
      assert.equal(demandesEnBase(environnement).length, 0, nom);
      assert.equal(appels.relais.length, 0, nom);
    }
  });

  test('configuration ou jeton incomplets', async () => {
    const cas = [
      ['secret absent', envJeton({ TURNSTILE_SECRET_KEY: undefined }), JETON],
      ['domaine absent', envJeton({ TURNSTILE_HOSTNAME: undefined }), JETON],
      ['jeton nombre', envJeton(), 12345],
      ['jeton objet', envJeton(), { a: 1 }],
      ['jeton texte long', envJeton(), 'x'.repeat(2049)],
    ];
    for (const [nom, environnement, jeton] of cas) {
      const { reponse, appels } = await envoyer(environnement, demandeValide({ turnstileToken: jeton }));
      assert.equal(reponse.status, 400, nom);
      assert.equal(appels.siteverify.length, 0, nom);
      assert.equal((await reponse.json()).message, MESSAGE, nom);
      assert.equal(demandesEnBase(environnement).length, 0, nom);
    }
  });

  test('jeton long', async () => {
    const environnement = envJeton();
    const { reponse, appels } = await envoyer(environnement, demandeValide({ turnstileToken: 'x'.repeat(2048) }));
    assert.equal(reponse.status, 200);
    assert.equal(appels.siteverify.length, 1);
  });

  test('ordre des vérifications', async () => {
    const environnement = envJeton({ TURNSTILE_SECRET_KEY: CLE_ECHOUE });
    const { reponse, appels } = await envoyer(
      environnement, demandeValide({ turnstileToken: JETON, website: 'http://spam.example', startedAt: Date.now() }),
    );
    assert.equal(reponse.status, 400);
    assert.equal((await reponse.json()).message, MESSAGE);
    assert.equal(appels.siteverify.length, 1);
  });

  test('jeton valide, demande invalide', async () => {
    const environnement = envJeton();
    const { reponse, appels } = await envoyer(environnement, demandeValide({ turnstileToken: JETON, website: 'x' }));
    assert.equal(reponse.status, 400);
    assert.notEqual((await reponse.json()).message, MESSAGE);
    assert.equal(demandesEnBase(environnement).length, 0);
    assert.equal(appels.relais.length, 0);
  });

  test('vérification négative puis envoi', async () => {
    const environnement = envJeton({ TURNSTILE_SECRET_KEY: CLE_ECHOUE });
    for (let rang = 0; rang < 5; rang += 1) {
      await envoyer(environnement, demandeValide({ turnstileToken: JETON }));
    }
    environnement.TURNSTILE_SECRET_KEY = CLE_PASSE;
    const { reponse } = await envoyer(environnement, demandeValide());
    assert.equal(reponse.status, 200);
  });

  test('limite atteinte avec jeton', async () => {
    const environnement = envJeton();
    ajouterEnvoisRecents(environnement, 4);
    const { reponse, appels } = await envoyer(environnement, demandeValide({ turnstileToken: JETON }));
    assert.equal(reponse.status, 429);
    assert.equal(demandesEnBase(environnement).length, 4);
    assert.equal(appels.relais.length, 0);
  });

  test('statut modifié pendant le relais', { timeout: 2000 }, async () => {
    const environnement = envJeton();
    let liberer;
    const attente = new Promise((r) => { liberer = () => r(new Response('relayee')); });
    const { simulation } = reseau({ relais: () => attente });
    const ctx = contexte();
    globalThis.fetch = simulation;
    try {
      const request = new Request('https://api.test/public/reservations', {
        method: 'POST', headers: { Origin: ORIGINE, 'Content-Type': 'application/json' },
        body: JSON.stringify(demandeValide({ turnstileToken: JETON })),
      });
      await worker.fetch(request, environnement, ctx);
      environnement.DB.sqlite.prepare("UPDATE reservation_requests SET status = 'traitee'").run();
      liberer();
      await Promise.all(ctx.attentes);
      assert.deepEqual(statuts(environnement), ['traitee']);
    } finally {
      globalThis.fetch = reseauInterdit;
    }
  });

  test('journal', async () => {
    journal.length = 0;
    await envoyer(envJeton(), demandeValide({ turnstileToken: JETON }), { entetes: { 'CF-Connecting-IP': '203.0.113.42' } });
    await envoyer(envJeton({ TURNSTILE_SECRET_KEY: CLE_ECHOUE }), demandeValide({ turnstileToken: JETON }));
    await envoyer(envJeton({ TURNSTILE_HOSTNAME: 'miaoucratie.fr' }), demandeValide({ turnstileToken: JETON }));
    await envoyer(envJeton(), demandeValide(), {
      siteverify: async (corps) => Response.json({ ...siteverifySimule(corps), action: 'autre' }),
    });
    await envoyer(envJeton(), demandeValide({ turnstileToken: '' }));

    assert.deepEqual(journal.map((ligne) => JSON.parse(ligne)), [
      { turnstile: 'succes', codes: [] },
      { turnstile: 'echec', codes: ['invalid-input-response'] },
      { turnstile: 'echec', codes: ['hostname'], hostname: 'example.com' },
      { turnstile: 'echec', codes: ['action'], action: 'autre' },
      { turnstile: 'echec', codes: ['jeton-absent'] },
    ]);
    const tout = journal.join('\n');
    for (const interdit of [JETON, '203.0.113.42', 'Dupont', 'marie@example.com', '0612345678', CLE_PASSE]) {
      assert.ok(!tout.includes(interdit), interdit);
    }
  });
});

describe('adresse du visiteur', () => {
  test('en-tete X-Forwarded-For', async () => {
    const environnement = env();
    ajouterEnvoisRecents(environnement, 4);
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
      entetes: { 'X-Forwarded-For': '198.51.100.9' },
    });
    assert.equal(reponse.status, 429);
  });
});
