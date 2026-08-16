/**
 * Tests des gardes de l'API de reservation.
 *
 * Les regles metier sont couvertes par shared/booking-utils.test.js. Ce qui
 * n'etait couvert par rien, c'est ce qui entoure ces regles : qui a le droit
 * d'appeler, avec quel jeton, depuis quelle origine, et combien de fois.
 *
 * Le Worker tourne sur Cloudflare mais n'utilise que des interfaces standard —
 * Request, Response, crypto.subtle. Il s'execute donc tel quel sous Node, sans
 * wrangler ni conteneur. Seul D1 est remplace, par la base factice ci-dessous.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const ORIGINE = 'https://miaoucratie.fr';
const SECRET = 'secret-de-test';
const MOT_DE_PASSE = 'mot-de-passe-de-test';

/**
 * Base factice : elle repond au sous-ensemble de D1 que le Worker utilise, en
 * s'orientant sur le SQL recu. Les insertions sont conservees pour verifier ce
 * qui aurait ete ecrit.
 */
function fausseBase({ indisponibilites = [], envoisRecents = 0 } = {}) {
  const insertions = [];

  const base = {
    insertions,
    prepare(sql) {
      let valeurs = [];
      const api = {
        bind(...v) { valeurs = v; return api; },
        async all() {
          if (sql.includes('unavailability_periods')) return { results: indisponibilites };
          return { results: [] };
        },
        async first() {
          if (sql.includes('COUNT(*)')) return { count: envoisRecents };
          if (sql.includes('unavailability_periods')) return indisponibilites[0] ?? null;
          return null;
        },
        async run() {
          insertions.push({ sql, valeurs });
          return { success: true, meta: { last_row_id: 1 } };
        },
      };
      return api;
    },
  };

  return base;
}

const env = (extra = {}) => ({
  DB: fausseBase(),
  ALLOWED_ORIGINS: ORIGINE,
  ADMIN_PASSWORD: MOT_DE_PASSE,
  ADMIN_TOKEN_SECRET: SECRET,
  ...extra,
});

const appeler = (chemin, options = {}) => {
  const { methode = 'GET', corps, entetes = {}, origine = ORIGINE, environnement = env() } = options;
  const request = new Request(`https://api.test${chemin}`, {
    method: methode,
    headers: {
      ...(origine ? { Origin: origine } : {}),
      ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...entetes,
    },
    ...(corps !== undefined ? { body: typeof corps === 'string' ? corps : JSON.stringify(corps) } : {}),
  });
  return worker.fetch(request, environnement);
};

/** Passe par /admin/login : c'est le chemin reel d'obtention d'un jeton. */
async function jetonValide(environnement = env()) {
  const reponse = await appeler('/admin/login', {
    methode: 'POST', corps: { password: MOT_DE_PASSE }, environnement,
  });
  assert.equal(reponse.status, 200, 'la connexion admin devrait reussir');
  return (await reponse.json()).token;
}

/** Reproduit la signature du Worker pour forger un jeton que lui n'emettrait pas. */
async function forgerJeton(charge, secret = SECRET) {
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
  ...extra,
});

describe('allowlist d origine', () => {
  test('une origine autorisee passe et est renvoyee telle quelle', async () => {
    const reponse = await appeler('/public/unavailabilities');
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get('Access-Control-Allow-Origin'), ORIGINE);
  });

  test('une origine non autorisee est refusee', async () => {
    const reponse = await appeler('/public/unavailabilities', { origine: 'https://exemple-pirate.fr' });
    assert.equal(reponse.status, 403);
    assert.match((await reponse.json()).message, /Origine non autorisée/);
  });

  test('l origine refusee ne se voit jamais renvoyer sa propre origine', async () => {
    const reponse = await appeler('/public/unavailabilities', { origine: 'https://exemple-pirate.fr' });
    assert.notEqual(reponse.headers.get('Access-Control-Allow-Origin'), 'https://exemple-pirate.fr');
  });

  test('une requete sans origine passe : c est le cas d un appel hors navigateur', async () => {
    const reponse = await appeler('/public/unavailabilities', { origine: null });
    assert.equal(reponse.status, 200);
  });

  test('une allowlist contenant * laisse tout passer', async () => {
    const reponse = await appeler('/public/unavailabilities', {
      origine: 'https://nimporte-ou.fr', environnement: env({ ALLOWED_ORIGINS: '*' }),
    });
    assert.equal(reponse.status, 200);
  });

  test('la liste se lit separee par des virgules, espaces compris', async () => {
    const environnement = env({ ALLOWED_ORIGINS: ' https://a.fr , https://b.fr ' });
    assert.equal((await appeler('/public/unavailabilities', { origine: 'https://b.fr', environnement })).status, 200);
    assert.equal((await appeler('/public/unavailabilities', { origine: 'https://c.fr', environnement })).status, 403);
  });

  test('le prevol OPTIONS repond 204 avec les entetes CORS, sans authentification', async () => {
    const reponse = await appeler('/admin/unavailabilities', { methode: 'OPTIONS' });
    assert.equal(reponse.status, 204);
    assert.match(reponse.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.equal(reponse.headers.get('Vary'), 'Origin');
  });
});

describe('connexion administrateur', () => {
  test('un mot de passe absent est refuse avant toute comparaison', async () => {
    const reponse = await appeler('/admin/login', { methode: 'POST', corps: {} });
    assert.equal(reponse.status, 400);
  });

  test('un mot de passe vide ou fait d espaces est refuse', async () => {
    assert.equal((await appeler('/admin/login', { methode: 'POST', corps: { password: '   ' } })).status, 400);
  });

  test('un mauvais mot de passe est refuse', async () => {
    const reponse = await appeler('/admin/login', { methode: 'POST', corps: { password: 'pas-le-bon' } });
    assert.equal(reponse.status, 401);
  });

  test('le bon mot de passe rend un jeton exploitable', async () => {
    const jeton = await jetonValide();
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 200);
  });

  test('un corps qui n est pas du JSON est refuse en 400, pas en 500', async () => {
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
  ];

  for (const [methode, chemin] of routesProtegees) {
    test(`${methode} ${chemin} exige un jeton`, async () => {
      const reponse = await appeler(chemin, { methode, corps: methode === 'GET' ? undefined : {} });
      assert.equal(reponse.status, 401);
    });
  }

  test('un en-tete sans le prefixe Bearer est refuse', async () => {
    const jeton = await jetonValide();
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: jeton } });
    assert.equal(reponse.status, 401);
  });

  test('un jeton sans point separateur est refuse', async () => {
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: 'Bearer jetonsanspoint' } });
    assert.equal(reponse.status, 401);
  });

  test('une signature falsifiee est refusee', async () => {
    const jeton = await jetonValide();
    const [charge] = jeton.split('.');
    const reponse = await appeler('/admin/unavailabilities', {
      entetes: { Authorization: `Bearer ${charge}.signature-inventee` },
    });
    assert.equal(reponse.status, 401);
  });

  test('un jeton signe avec un autre secret est refuse', async () => {
    const jeton = await forgerJeton({ scope: 'admin', exp: Date.now() + 60_000 }, 'mauvais-secret');
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 401);
  });

  test('un jeton expire est refuse, meme correctement signe', async () => {
    const jeton = await forgerJeton({ scope: 'admin', exp: Date.now() - 1000 });
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 401);
    assert.match((await reponse.json()).message, /Session expirée/);
  });

  test('un jeton sans date d expiration est refuse', async () => {
    const jeton = await forgerJeton({ scope: 'admin' });
    const reponse = await appeler('/admin/unavailabilities', { entetes: { Authorization: `Bearer ${jeton}` } });
    assert.equal(reponse.status, 401);
  });

  test('la charge modifiee invalide la signature', async () => {
    const jetonLong = await forgerJeton({ scope: 'admin', exp: Date.now() + 10_000_000 });
    const [charge, signature] = jetonLong.split('.');
    const autreCharge = (await forgerJeton({ scope: 'admin', exp: Date.now() + 99_000_000 })).split('.')[0];
    assert.notEqual(charge, autreCharge);
    const reponse = await appeler('/admin/unavailabilities', {
      entetes: { Authorization: `Bearer ${autreCharge}.${signature}` },
    });
    assert.equal(reponse.status, 401);
  });
});

describe('quota d envoi par adresse IP', () => {
  const environnementAvec = (envoisRecents) => ({
    DB: fausseBase({ envoisRecents }),
    ALLOWED_ORIGINS: ORIGINE, ADMIN_PASSWORD: MOT_DE_PASSE, ADMIN_TOKEN_SECRET: SECRET,
  });

  test('trois envois recents passent encore', async () => {
    const environnement = environnementAvec(3);
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 200);
    assert.equal(environnement.DB.insertions.length, 1, 'la demande aurait du etre enregistree');
  });

  test('le quatrieme est refuse en 429', async () => {
    const environnement = environnementAvec(4);
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 429);
    assert.equal(environnement.DB.insertions.length, 0, 'rien ne doit etre ecrit quand le quota est atteint');
  });

  test('l adresse IP n est jamais stockee en clair, seulement son empreinte', async () => {
    const environnement = environnementAvec(0);
    await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
      entetes: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    const valeurs = environnement.DB.insertions[0].valeurs.map(String);
    assert.ok(!valeurs.includes('203.0.113.42'), 'l adresse IP se retrouve en clair en base');
    assert.ok(valeurs.some((v) => /^[0-9a-f]{64}$/.test(v)), 'aucune empreinte SHA-256 trouvee');
  });
});

describe('garde anti-robot', () => {
  test('un envoi sans horodatage de debut est refuse', async () => {
    const corps = demandeValide();
    delete corps.startedAt;
    const reponse = await appeler('/public/reservations', { methode: 'POST', corps });
    assert.equal(reponse.status, 400);
  });

  test('un envoi en moins de 3,5 secondes est refuse', async () => {
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide({ startedAt: Date.now() - 500 }),
    });
    assert.equal(reponse.status, 400);
    assert.match((await reponse.json()).message, /trop vite/);
  });

  test('le champ piege rempli bloque l envoi', async () => {
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide({ website: 'http://spam.example' }),
    });
    assert.equal(reponse.status, 400);
  });

  test('une demande invalide rend le detail des champs fautifs', async () => {
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide({ email: 'pas-une-adresse', nom: '' }),
    });
    assert.equal(reponse.status, 400);
    const { errors } = await reponse.json();
    assert.ok(errors.email, 'l e-mail aurait du etre signale');
    assert.ok(errors.nom, 'le nom aurait du etre signale');
  });

  test('une periode indisponible est refusee cote serveur', async () => {
    const environnement = {
      DB: fausseBase({ indisponibilites: [{ startDate: '2099-06-05', endDate: '2099-06-20', comment: '' }] }),
      ALLOWED_ORIGINS: ORIGINE, ADMIN_PASSWORD: MOT_DE_PASSE, ADMIN_TOKEN_SECRET: SECRET,
    };
    const reponse = await appeler('/public/reservations', {
      methode: 'POST', corps: demandeValide(), environnement,
    });
    assert.equal(reponse.status, 400);
    assert.ok((await reponse.json()).errors.dateRange);
    assert.equal(environnement.DB.insertions.length, 0);
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
    const jeton = await jetonValide();
    const reponse = await appeler('/admin/unavailabilities/abc', {
      methode: 'DELETE', entetes: { Authorization: `Bearer ${jeton}` },
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
