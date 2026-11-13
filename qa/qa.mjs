/**
 * Harnais du site
 *
 *   node qa/qa.mjs                  empreinte et comportement
 *   node qa/qa.mjs --detail         tous les ecarts
 *   node qa/qa.mjs --comportement   comportement seul
 *   node qa/qa.mjs --update         regenere la reference
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
// Tarifs partagés
import '../shared/tarifs.js';

const {
  FRAIS_KM_EUR, TAUX_ACOMPTE, estimerSejour, formatEuros,
} = globalThis.MiaouTarifs;

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REFERENCE = join(RACINE, 'qa', 'reference.json');
const MAJ = process.argv.includes('--update');

/* Tous les écarts */
const DETAIL = process.argv.includes('--detail');

/* Comportement seul */
const COMPORTEMENT_SEUL = process.argv.includes('--comportement');

/* Toutes les pages */
const PAGES = readdirSync(RACINE)
  .filter((f) => f.endsWith('.html') && !f.startsWith('maquette-'))
  .sort();
const LARGEURS = [1272, 375];

/* Hors empreinte */
const SANS_EMPREINTE = new Set(['admin-indisponibilites.html']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml',
};

/* Adresse de l'API */
const META_API = /(<meta name="miaoucratie-api-base" content=")[^"]*(")/;

/* Clé anti-robot d'essai */
const META_ANTIROBOT = /(<meta name="miaoucratie-antirobot" content=")[^"]*(")/;
const CLE_ANTIROBOT_ESSAI = 'cle-essai';

/* Serveur du site */
function demarrerServeur(api) {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0]);
    let fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
    if (chemin.endsWith('/')) fichier = join(fichier, 'index.html');
    if (!fichier.startsWith(RACINE) || !existsSync(fichier)) {
      res.writeHead(404).end('introuvable');
      return;
    }
    try {
      let contenu = await readFile(fichier);
      if (extname(fichier) === '.html') {
        contenu = contenu.toString('utf8')
          .replace(META_API, `$1${api}$2`)
          .replace(META_ANTIROBOT, `$1${CLE_ANTIROBOT_ESSAI}$2`);
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
      res.end(contenu);
    } catch {
      res.writeHead(500).end('erreur');
    }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(serveur)));
}

/* ─── Faux Worker ────────────────────────────────────────────────────── */

const jourDecale = (jours) => new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10);

/* Indisponibilites figees */
const indisponibilitesFigees = () => [{ startDate: jourDecale(10), endDate: jourDecale(14) }];

/* Administration */
const MOT_DE_PASSE_ESSAI = 'essai-valide';
const JETON_ESSAI = 'jeton-essai';

/* Jeton anti-robot refusé */
const JETON_REFUSE = 'jeton-refuse';
const MESSAGE_REFUS = "La vérification anti-robot n'a pas abouti. Merci de réessayer.";

function demarrerFauxWorker() {
  const envois = [];
  const periodes = [{ id: 1, startDate: jourDecale(10), endDate: jourDecale(14), comment: 'Essai' }];
  let suivant = 2;
  const serveur = createServer((req, res) => {
    const origine = req.headers.origin || '';
    const entetes = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': /^http:\/\/127\.0\.0\.1:\d+$/.test(origine) ? origine : 'null',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const repondre = (statut, corps) => {
      res.writeHead(statut, entetes);
      res.end(corps === undefined ? '' : JSON.stringify(corps));
    };
    const chemin = req.url.split('?')[0];
    const admis = req.headers.authorization === `Bearer ${JETON_ESSAI}`;
    const periode = chemin.match(/^\/admin\/unavailabilities\/(\d+)$/);

    if (req.method === 'OPTIONS') return repondre(204);
    if (req.method === 'GET' && chemin === '/public/unavailabilities') {
      return repondre(200, { ranges: indisponibilitesFigees() });
    }
    if (req.method === 'GET' && chemin === '/admin/unavailabilities') {
      return admis ? repondre(200, { ranges: periodes }) : repondre(401, { message: 'Session expirée.' });
    }
    if (req.method === 'GET' && chemin === '/admin/reservations') {
      return admis ? repondre(200, { demandes: [] }) : repondre(401, { message: 'Session expirée.' });
    }

    let corps = '';
    req.on('data', (morceau) => { corps += morceau; });
    req.on('end', () => {
      envois.push({ methode: req.method, chemin, corps });
      let donnees = {};
      try { donnees = JSON.parse(corps || '{}'); } catch { /* corps illisible */ }
      if (req.method === 'POST' && chemin === '/public/reservations') {
        if (donnees.turnstileToken === JETON_REFUSE) return repondre(400, { message: MESSAGE_REFUS });
        return repondre(200, { message: 'Votre demande a bien été enregistrée.', reservationId: randomUUID() });
      }
      if (req.method === 'POST' && chemin === '/admin/login') {
        return donnees.password === MOT_DE_PASSE_ESSAI
          ? repondre(200, { token: JETON_ESSAI })
          : repondre(401, { message: 'Mot de passe invalide.' });
      }
      if ((chemin === '/admin/unavailabilities' || periode) && !admis) {
        return repondre(401, { message: 'Session expirée.' });
      }
      if (req.method === 'POST' && chemin === '/admin/unavailabilities') {
        const ajout = { id: suivant++, startDate: donnees.startDate, endDate: donnees.endDate, comment: donnees.comment || '' };
        periodes.push(ajout);
        return repondre(201, { message: 'Indisponibilité ajoutée.', period: ajout });
      }
      const rang = periode ? periodes.findIndex((p) => p.id === Number(periode[1])) : -1;
      if (req.method === 'PUT' && rang >= 0) {
        Object.assign(periodes[rang], { startDate: donnees.startDate, endDate: donnees.endDate, comment: donnees.comment || '' });
        return repondre(200, { message: 'Indisponibilité mise à jour.', period: periodes[rang] });
      }
      if (req.method === 'DELETE' && rang >= 0) {
        periodes.splice(rang, 1);
        return repondre(200, { message: 'Indisponibilité supprimée.' });
      }
      return repondre(404, { message: 'Introuvable.' });
    });
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok({
    serveur, envois, url: `http://127.0.0.1:${serveur.address().port}`,
  })));
}

/* ─── Filet reseau ───────────────────────────────────────────────────── */

const HOTE_API = /\.workers\.dev$/;
const HOTES_ANTIROBOT = /^challenges\.cloudflare\.com$/;

export function issueRequete(methode, adresse) {
  let hote;
  try {
    hote = new URL(adresse).hostname;
  } catch {
    return 'coupee';
  }
  if (hote === '127.0.0.1') return 'permise';
  if (HOTE_API.test(hote)) return 'coupee';
  if (methode === 'GET') return 'permise';
  if (HOTES_ANTIROBOT.test(hote)) return 'antirobot';
  return 'coupee';
}

async function poserFilet(contexte, reseau) {
  await contexte.route('**/*', async (route) => {
    const requete = route.request();
    const issue = issueRequete(requete.method(), requete.url());
    if (issue === 'permise') return route.fallback();
    const trace = `${requete.method()} ${requete.url().split('?')[0]}`;
    (issue === 'antirobot' ? reseau.antirobot : reseau.coupees).push(trace);
    return route.abort();
  });
  // Service d'e-mail
  await contexte.route('https://api.web3forms.com/**', async (route) => {
    reseau.courriels.push(route.request().postData() || '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  // Case anti-robot factice
  await contexte.route('https://challenges.cloudflare.com/turnstile/**', (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', path: FAUX_ANTIROBOT,
  }));
}

const FAUX_ANTIROBOT = join(RACINE, 'qa', 'fixtures', 'turnstile.js');

async function nouveauContexte(navigateur, reseau, options) {
  const contexte = await navigateur.newContext(options);
  await poserFilet(contexte, reseau);
  return contexte;
}

/* ─── API adresse : reponses figees ──────────────────────────────────── */

const FIXTURE_GEO = join(RACINE, 'qa', 'fixtures', 'geo-api.json');

/* Normalisation des noms */
const sansAccents = (s = '') =>
  String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/* Contour carré */
function contourAutourDe(point) {
  const [lon, lat] = point.coordinates;
  const d = 0.01;
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - d, lat - d], [lon + d, lat - d],
      [lon + d, lat + d], [lon - d, lat + d],
      [lon - d, lat - d],
    ]],
  };
}

async function figerApiAdresse(contexte, requetesInconnues) {
  const fixture = JSON.parse(await readFile(FIXTURE_GEO, 'utf8'));
  const parRequete = fixture.requetes;
  const parCode = new Map();
  for (const features of Object.values(parRequete)) {
    for (const f of features) parCode.set(String(f.properties.code), f);
  }

  await contexte.route('**://geo.api.gouv.fr/**', async (route) => {
    const url = new URL(route.request().url());
    const geojson = url.searchParams.get('format') === 'geojson';
    const contour = url.searchParams.get('geometry') === 'contour';

    // Commune par code
    const parId = url.pathname.match(/^\/communes\/(\d+)$/);
    let features;

    if (parId) {
      const f = parCode.get(parId[1]);
      features = f ? [f] : [];
    } else {
      const nom = url.searchParams.get('nom');
      const codePostal = url.searchParams.get('codePostal');
      if (nom) {
        features = parRequete[sansAccents(nom)];
        if (!features) {
          // Commune absente
          requetesInconnues.add(nom);
          features = [];
        }
      } else if (codePostal) {
        features = [...parCode.values()]
          .filter((f) => (f.properties.codesPostaux || []).includes(codePostal));
      } else {
        features = [];
      }
    }

    const avecGeometrie = features.map((f) => (contour
      ? { ...f, geometry: contourAutourDe(f.geometry) }
      : f));

    // Format json ou geojson
    const corps = geojson
      ? { type: 'FeatureCollection', features: avecGeometrie }
      : avecGeometrie.map((f) => f.properties);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(corps),
    });
  });
}

/* ─── Mesure neutralisee ─────────────────────────────────────────────── */

const CLE_CONSENTEMENT = 'miaoucratie.consentement';
const HOTES_MESURE = ['https://www.googletagmanager.com/**', 'https://*.google-analytics.com/**'];

async function intercepterMesure(contexte, appels) {
  for (const motif of HOTES_MESURE) {
    await contexte.route(motif, async (route) => {
      appels.push(route.request().url());
      // Corps vide
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
  }
}

async function refuserLaMesure(contexte) {
  const choix = JSON.stringify({ valeur: 'refuse', version: 1, date: new Date().toISOString() });
  await contexte.addInitScript(([cle, valeur]) => {
    try { window.localStorage.setItem(cle, valeur); } catch (e) { /* stockage indisponible */ }
  }, [CLE_CONSENTEMENT, choix]);
}

/* ─── 1. Empreinte visuelle ──────────────────────────────────────────── */

/* Polices chargées */
const FAMILLES = ['DM Sans', 'Cormorant Garamond'];

async function attendrePolices(page) {
  return page.evaluate(async (familles) => {
    await document.fonts.ready;
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
    await document.fonts.ready;
    const declarees = new Set([...document.fonts].map((f) => f.family.replace(/^['"]|['"]$/g, '')));
    return familles
      .filter((f) => declarees.has(f))
      .filter((f) => !document.fonts.check(`400 16px "${f}"`));
  }, FAMILLES);
}

async function empreinte(page) {
  return page.evaluate(() => {
    // Éléments relevés
    const sel = 'h1,h2,h3,h4,p,a,button,img,li,strong,em,span,div,header,nav,main,footer,label,blockquote,input,select,textarea';
    return [...document.querySelectorAll(sel)]
      // Hors Leaflet
      .filter((e) => !String(e.className || '').includes('leaflet'))
      // Hors calendrier
      .filter((e) => !e.closest('.flatpickr-calendar'))
      .map((e) => {
        const b = e.getBoundingClientRect();
        const c = getComputedStyle(e);
        return [
          e.tagName, String(e.className || '').replace(/\s+/g, ' ').slice(0, 30),
          Math.round(b.width), Math.round(b.height), Math.round(b.left), Math.round(b.top),
          c.color, c.backgroundColor, c.fontSize, c.fontWeight, c.fontStyle,
          c.fontFamily.split(',')[0], c.display, c.borderRadius, c.padding, c.margin,
          c.textAlign, c.opacity, c.visibility,
          // Interlignage et interlettrage
          c.lineHeight, c.letterSpacing,
        ].join('|');
      });
  });
}

/* Tolérance de 2 px */
const CHAMPS_GEOMETRIQUES = new Set([2, 3, 4, 5, 8, 13, 14, 15, 19, 20]);
const TOLERANCE_PX = 2;

export function memeElement(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const ca = a.split('|');
  const cb = b.split('|');
  if (ca.length !== cb.length) return false;

  for (let i = 0; i < ca.length; i++) {
    if (ca[i] === cb[i]) continue;
    if (!CHAMPS_GEOMETRIQUES.has(i)) return false;

    // Même squelette
    const nombres = (s) => (s.match(/-?[\d.]+/g) ?? []).map(Number);
    const squelette = (s) => s.replace(/-?[\d.]+/g, '#');
    if (squelette(ca[i]) !== squelette(cb[i])) return false;

    const na = nombres(ca[i]);
    const nb = nombres(cb[i]);
    if (na.length !== nb.length) return false;
    if (na.some((v, j) => Math.abs(v - nb[j]) > TOLERANCE_PX)) return false;
  }
  return true;
}

/* ─── 2. Comportement ────────────────────────────────────────────────── */

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function testerMenu(page, echecs, nom) {
  const bouton = await page.$('#tmenuBtn');
  const panneau = await page.$('#tmenuPanel');
  if (!bouton || !panneau) return echecs.push(`${nom} : menu burger absent du DOM`);

  const ferme = await panneau.evaluate((e) => getComputedStyle(e).display);
  await bouton.click();
  await attendre(250);
  const ouvert = await panneau.evaluate((e) => getComputedStyle(e).display);
  if (ferme === ouvert) echecs.push(`${nom} : le menu burger ne s'ouvre pas`);

  await page.mouse.click(5, 400);
  await attendre(250);
  const refeme = await panneau.evaluate((e) => getComputedStyle(e).display);
  if (refeme !== ferme) echecs.push(`${nom} : le menu burger ne se referme pas`);
}

async function testerFaq(page, echecs) {
  const n = await page.locator('.acc-item').count();
  if (n < 30) echecs.push(`faq : ${n} questions seulement, attendu au moins 30`);

  // Accordéon
  const item = page.locator('.acc-item').nth(4);
  const avant = await item.evaluate((e) => e.classList.contains('open'));
  await item.locator('.acc-trigger').click();
  await attendre(600);
  const apres = await item.evaluate((e) => e.classList.contains('open'));
  if (avant === apres) echecs.push("faq : l'accordeon ne bascule pas");
  const aria = await item.locator('.acc-trigger').getAttribute('aria-expanded');
  if (aria !== String(apres)) echecs.push('faq : aria-expanded desynchronise de la classe');

  // Sommaire
  const sommaire = await page.evaluate(() => {
    const liens = [...document.querySelectorAll('.faq-sommaire a')];
    return {
      entrees: liens.length,
      sections: document.querySelectorAll('.faq-section').length,
      ancresMortes: liens.filter((a) => !document.querySelector(a.getAttribute('href')))
        .map((a) => a.getAttribute('href')),
    };
  });
  if (sommaire.entrees !== sommaire.sections) {
    echecs.push(`faq : ${sommaire.entrees} entrees de sommaire pour ${sommaire.sections} sections`);
  }
  if (sommaire.ancresMortes.length) {
    echecs.push(`faq : ancre sans cible ${JSON.stringify(sommaire.ancresMortes)}`);
  }

  // Recherche
  await page.fill('#faqSearch', 'canicule');
  await attendre(450);
  const trouves = await page.evaluate(() =>
    [...document.querySelectorAll('.acc-item')].filter((i) => getComputedStyle(i).display !== 'none').length);
  if (trouves === 0 || trouves > 5) echecs.push(`faq : recherche "canicule" renvoie ${trouves} resultats`);

  await page.fill('#faqSearch', 'zzzzqqq');
  await attendre(450);
  const vide = await page.evaluate(() => getComputedStyle(document.getElementById('noResults')).display !== 'none');
  if (!vide) echecs.push('faq : aucun message quand la recherche ne trouve rien');
  await page.fill('#faqSearch', '');

  // Données structurées
  const sync = await page.evaluate(() => {
    /* Texte seul */
        const memeTexte = (s) => s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        const vues = [...document.querySelectorAll('.acc-question')].map((e) => memeTexte(e.textContent));
    const brut = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => s.textContent).find((t) => t.includes('FAQPage'));
    if (!brut) return { erreur: 'aucun bloc FAQPage' };
    const ld = (JSON.parse(brut).mainEntity ?? []).map((e) => memeTexte(e.name));
    return {
      absentes: vues.filter((q) => !ld.includes(q)),
      orphelines: ld.filter((q) => !vues.includes(q)),
    };
  });
  if (sync.erreur) echecs.push(`faq : ${sync.erreur}`);
  if (sync.absentes?.length) echecs.push(`faq : ${sync.absentes.length} question(s) absente(s) du JSON-LD : ${sync.absentes[0]}`);
  if (sync.orphelines?.length) echecs.push(`faq : ${sync.orphelines.length} question(s) en JSON-LD sans equivalent affiche : ${sync.orphelines[0]}`);
}

async function testerCarte(page, echecs) {
  const cas = [
    { commune: 'Vitré', attendu: 'Commune incluse', pin: '7A9E8E' },
    { commune: 'Le Pertre', attendu: 'Commune sur devis', pin: 'C8603A' },
    { commune: 'Rennes', attendu: 'Hors zone', pin: 'D64545' },
  ];
  for (const { commune, attendu, pin } of cas) {
    await page.fill('#searchInput', commune);
    await page.click('#searchBtn');
    await attendre(1400);

    const titre = await page.locator('#desktopStickyCta .title').textContent();
    if (titre.trim() !== attendu) echecs.push(`carte : "${commune}" classee "${titre.trim()}", attendu "${attendu}"`);

    const couleurs = await page.evaluate(() =>
      [...document.querySelectorAll('.leaflet-marker-icon')]
        .map((i) => decodeURIComponent(i.getAttribute('src') || '')));
    if (!couleurs.some((s) => s.includes(pin))) {
      echecs.push(`carte : "${commune}" n'affiche pas de marqueur ${pin}`);
    }

    const texte = await page.locator('#resultText').textContent();
    if (/NaN|undefined|null/.test(texte)) echecs.push(`carte : "${commune}" affiche une valeur invalide`);
  }

  // Réinitialisation complète
  await page.click('#resetView');
  await attendre(900);
  const apres = await page.evaluate(() => ({
    champ: document.getElementById('searchInput').value,
    ctaVide: document.getElementById('dynamicCTA').textContent.trim() === '',
    masquee: !document.getElementById('desktopStickyCta').classList.contains('show'),
    titre: document.querySelector('#desktopStickyCta .title').textContent.trim(),
    marqueurs: document.querySelectorAll('.leaflet-marker-icon').length,
  }));
  if (apres.champ !== '') echecs.push('carte : le champ de recherche n\'est pas vide apres reinitialisation');
  if (!apres.ctaVide) echecs.push('carte : le bloc CTA subsiste apres reinitialisation');
  if (!apres.masquee) echecs.push('carte : la pastille reste visible apres reinitialisation');
  if (apres.titre !== 'Vérifiez votre commune') echecs.push(`carte : la pastille garde "${apres.titre}" apres reinitialisation`);
  if (apres.marqueurs > 1) echecs.push(`carte : ${apres.marqueurs} marqueurs subsistent apres reinitialisation`);
}

async function testerReservation(page, echecs) {
  // Attente de Flatpickr
  try {
    await page.waitForFunction(() => document.querySelectorAll('.flatpickr-input').length === 2, { timeout: 12000 });
  } catch {
    const n = await page.locator('.flatpickr-input').count();
    echecs.push(`reservation : ${n} champ(s) de date initialises, attendu 2 (script absent ou CDN injoignable ?)`);
    return;
  }
  const ouvre = await page.evaluate(async () => {
    const fp = document.getElementById('dateDebut')?._flatpickr;
    if (!fp) return false;
    fp.open();
    await new Promise((r) => setTimeout(r, 400));
    return document.querySelectorAll('.flatpickr-day').length > 20;
  });
  if (!ouvre) echecs.push('reservation : le calendrier ne s\'ouvre pas');

  const champs = await page.locator('#reservation-form input, #reservation-form select, #reservation-form textarea').count();
  if (champs < 15) echecs.push(`reservation : ${champs} champs de formulaire, attendu au moins 15`);

  // Champ conditionnel
  const masque = await page.evaluate(() => {
    const e = document.getElementById('autre-frequence-wrapper');
    return e ? getComputedStyle(e).display === 'none' : null;
  });
  if (masque === false) echecs.push('reservation : le champ conditionnel "autre frequence" est visible a tort');

  const depart = await etatFormulaire(page, '#reservation-form', '#submit-button');
  if (!depart.actif || depart.boutonInactif || !depart.secoursMasque) {
    echecs.push(`reservation : demarrage incomplet ${JSON.stringify(depart)}`);
  }
  const note = await page.locator('#availability-note').textContent();
  if (!note.includes('dates grisées')) echecs.push(`reservation : indisponibilites non chargees (« ${note.trim()} »)`);
}

/* Etat d'un formulaire */
function etatFormulaire(page, formulaire, bouton) {
  return page.evaluate(([f, b]) => {
    const form = document.querySelector(f);
    const secours = form?.querySelector('[data-secours]');
    return {
      actif: Boolean(form?.hasAttribute('data-actif')),
      boutonInactif: Boolean(document.querySelector(b)?.disabled),
      secoursMasque: !secours || secours.hidden,
      secoursVisible: Boolean(secours && !secours.hidden && secours.getClientRects().length),
      methode: form?.getAttribute('method') || '',
    };
  }, [formulaire, bouton]);
}

/* Connexion d'administration */
async function testerConnexion(page, reseau, echecs) {
  const depart = await etatFormulaire(page, '#admin-login-form', '#admin-login-button');
  if (!depart.actif || depart.boutonInactif || !depart.secoursMasque) {
    echecs.push(`admin : demarrage incomplet ${JSON.stringify(depart)}`);
    return;
  }
  const adresse = page.url();
  const avant = reseau.worker.envois.length;
  await page.fill('#admin-password', 'essai');
  await page.press('#admin-password', 'Enter');
  await page.locator('#admin-password-error').filter({ hasText: /\S/ }).waitFor({ timeout: 5000 }).catch(() => {});
  const recus = reseau.worker.envois.slice(avant).filter((e) => e.chemin === '/admin/login');
  if (recus.length !== 1) echecs.push(`admin : ${recus.length} connexion(s) recue(s) par le faux Worker, attendu 1`);
  if (page.url() !== adresse) echecs.push(`admin : adresse changee apres Entree (${page.url()})`);
  const message = (await page.locator('#admin-password-error').textContent()).trim();
  if (!message) echecs.push('admin : aucun message apres un refus du serveur');
}

/* Gestion des indisponibilites */
async function testerGestion(navigateur, base, reseau, echecs) {
  const contexte = await nouveauContexte(navigateur, reseau, { viewport: { width: LARGEURS[0], height: 900 } });
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('dialog', (d) => d.accept());
  const avant = reseau.worker.envois.length;
  const recus = (methode) => reseau.worker.envois.slice(avant)
    .filter((e) => e.methode === methode && e.chemin.startsWith('/admin/unavailabilities')).length;
  try {
    await page.goto(`${base}/admin-indisponibilites.html`, { waitUntil: 'load' });
    const adresse = page.url();
    await page.fill('#admin-password', MOT_DE_PASSE_ESSAI);
    await page.press('#admin-password', 'Enter');
    await page.locator('#management-panel').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#period-list .period-card').first().waitFor({ timeout: 5000 });

    const etat = await etatFormulaire(page, '#unavailability-form', '#save-period-button');
    if (!etat.actif || etat.boutonInactif || etat.methode !== 'post') {
      echecs.push(`admin (gestion) : demarrage incomplet ${JSON.stringify(etat)}`);
    }

    const cartes = () => page.locator('#period-list .period-card').count();
    const depart = await cartes();
    await page.fill('#startDate', jourDecale(40));
    await page.fill('#endDate', jourDecale(42));
    await page.fill('#comment', 'Ajout');
    await page.press('#comment', 'Enter');
    await page.waitForFunction((n) => document.querySelectorAll('#period-list .period-card').length === n + 1, depart, { timeout: 5000 });

    await page.locator('#period-list .period-card', { hasText: 'Ajout' }).getByRole('button', { name: 'Modifier' }).click();
    await page.fill('#comment', 'Modifiée');
    await page.click('#save-period-button');
    await page.locator('#period-list .period-card', { hasText: 'Modifiée' }).waitFor({ timeout: 5000 });

    await page.locator('#period-list .period-card', { hasText: 'Modifiée' }).getByRole('button', { name: 'Supprimer' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('#period-list .period-card').length === n, depart, { timeout: 5000 });

    const compte = { POST: recus('POST'), PUT: recus('PUT'), DELETE: recus('DELETE') };
    if (compte.POST !== 1 || compte.PUT !== 1 || compte.DELETE !== 1) {
      echecs.push(`admin (gestion) : envois recus par le faux Worker ${JSON.stringify(compte)}, attendu un de chaque`);
    }
    if (page.url() !== adresse) echecs.push(`admin (gestion) : adresse changee (${page.url()})`);
    if (erreurs.length) echecs.push(`admin (gestion) : erreur JS — ${erreurs[0]}`);
  } catch (e) {
    echecs.push(`admin (gestion) : interrompu — ${e.message.split('\n')[0]}`);
  } finally {
    await contexte.close();
  }
}

/* ─── Formulaires sans leur module ───────────────────────────────────── */

const FORMULAIRES = [
  {
    page: 'reservation.html', formulaire: '#reservation-form', bouton: '#submit-button',
    champ: '#nom', valeur: 'Durand', module: '**/js/reservation.js',
  },
  {
    page: 'admin-indisponibilites.html', formulaire: '#admin-login-form', bouton: '#admin-login-button',
    champ: '#admin-password', valeur: 'essai', module: '**/js/admin-indisponibilites.js',
    autres: [['#unavailability-form', '#save-period-button']],
  },
];

async function testerSecours(navigateur, base, reseau, echecs) {
  for (const f of FORMULAIRES) {
    for (const sansJs of [false, true]) {
      const nom = `${f.page} ${sansJs ? 'sans JavaScript' : 'sans module'}`;
      const contexte = await nouveauContexte(navigateur, reseau, {
        viewport: { width: LARGEURS[0], height: 900 }, javaScriptEnabled: !sansJs,
      });
      await refuserLaMesure(contexte);
      await intercepterMesure(contexte, []);
      if (!sansJs) await contexte.route(f.module, (route) => route.abort());
      const page = await contexte.newPage();
      try {
        await page.goto(`${base}/${f.page}`, { waitUntil: 'load' });
        await attendre(300);
        const adresse = page.url();
        let navigations = 0;
        page.on('framenavigated', (cadre) => { if (cadre === page.mainFrame()) navigations += 1; });

        if (sansJs && !(await page.locator(`${f.formulaire} noscript .formulaire-secours`).isVisible())) {
          echecs.push(`${nom} : phrase de secours absente`);
        }
        for (const formulaire of [f.formulaire, ...(f.autres || []).map(([x]) => x)]) {
          if ((await page.locator(formulaire).getAttribute('method')) !== 'post') {
            echecs.push(`${nom} : ${formulaire} sans methode post`);
          }
        }
        if (!sansJs && !(await page.locator(`${f.formulaire} [data-secours]`).isVisible())) {
          echecs.push(`${nom} : phrase de secours absente`);
        }
        if (await page.locator(`${f.formulaire} .formulaire-secours:visible`).count() !== 1) {
          echecs.push(`${nom} : la phrase de secours doit apparaitre une fois`);
        }
        for (const bouton of [f.bouton, ...(f.autres || []).map(([, y]) => y)]) {
          if (!(await page.locator(bouton).isDisabled())) echecs.push(`${nom} : ${bouton} actif`);
        }

        await page.fill(f.champ, f.valeur);
        await page.press(f.champ, 'Enter');
        await page.click(f.bouton, { force: true }).catch(() => {});
        await attendre(800);
        const apres = new URL(page.url());
        if (apres.search || apres.pathname !== new URL(adresse).pathname) {
          echecs.push(`${nom} : adresse changee (${page.url()})`);
        }
        if (navigations) echecs.push(`${nom} : ${navigations} envoi(s) sans le module`);

        if (!sansJs) {
          await Promise.all([
            page.waitForNavigation({ timeout: 5000 }),
            page.evaluate((s) => document.querySelector(s).submit(), f.formulaire),
          ]);
          if (new URL(page.url()).search) echecs.push(`${nom} : parametres dans l'adresse apres envoi`);
        }
      } catch (e) {
        echecs.push(`${nom} : interrompu — ${e.message.split('\n')[0]}`);
      } finally {
        await contexte.close();
      }
    }
  }
}

/* ─── Ressources externes coupees ────────────────────────────────────── */

const COUPURES = [
  { nom: 'anti-robot', motifs: ['https://challenges.cloudflare.com/**'] },
  { nom: 'geocodage', motifs: ['https://geo.api.gouv.fr/**', 'https://data.geopf.fr/**'] },
  { nom: 'calendrier', motifs: ['https://cdn.jsdelivr.net/**'] },
  { nom: 'serveur', motifs: [] },
];

/* Brouillons anciens */
const BROUILLONS = [
  '{"nom":"Durand","dateDebut":"2020-01-01","dateFin":"2020-01-05","nombreChats":"2","frequence":"Autre besoin à préciser","startedAt":"abc"}',
  '{"nom":{"a":1},"prenom":["x"],"dateDebut":"31/12/1999","dateFin":"pas une date","nombreChats":null}',
  '{"date_debut":"2030-01-01","nombre_chats":"3","frequence":42}',
  '[1,2,3]',
  '"texte"',
  'null',
  '{pas du json',
];

const CLE_BROUILLON = 'miaoucratie:reservation:draft:v1';

/* Bruit reseau */
const bruitReseau = (t) => t.includes('Failed to load resource') || t.includes('ERR_FAILED')
  || t.includes('Failed to fetch');

async function demarrageSansErreur(navigateur, base, reseau, nom, preparer, echecs) {
  const contexte = await nouveauContexte(navigateur, reseau, { viewport: { width: LARGEURS[0], height: 900 } });
  await refuserLaMesure(contexte);
  await intercepterMesure(contexte, []);
  await figerApiAdresse(contexte, new Set());
  await preparer(contexte);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !bruitReseau(m.text())) erreurs.push(m.text()); });
  try {
    await page.goto(`${base}/reservation.html`, { waitUntil: 'load' });
    await attendre(800);
    const etat = await etatFormulaire(page, '#reservation-form', '#submit-button');
    if (!etat.actif || etat.boutonInactif || !etat.secoursMasque) {
      echecs.push(`reservation (${nom}) : demarrage incomplet ${JSON.stringify(etat)}`);
    }
    const messages = await page.evaluate(() => [...document.querySelectorAll('#reservation-form .field-error')]
      .map((e) => e.textContent.trim()).filter(Boolean));
    if (messages.length) echecs.push(`reservation (${nom}) : message d'erreur affiche « ${messages[0]} »`);
    if (erreurs.length) echecs.push(`reservation (${nom}) : erreur JS — ${erreurs[0]}`);
  } catch (e) {
    echecs.push(`reservation (${nom}) : interrompu — ${e.message.split('\n')[0]}`);
  } finally {
    await contexte.close();
  }
}

async function testerCoupures(navigateur, base, reseau, echecs) {
  for (const { nom, motifs } of COUPURES) {
    await demarrageSansErreur(navigateur, base, reseau, `${nom} coupe`, async (contexte) => {
      for (const motif of motifs) await contexte.route(motif, (route) => route.abort());
      if (!motifs.length) await contexte.route(`${reseau.worker.url}/**`, (route) => route.abort());
    }, echecs);
  }
  for (const [i, brut] of BROUILLONS.entries()) {
    await demarrageSansErreur(navigateur, base, reseau, `brouillon ${i + 1}`, (contexte) => contexte.addInitScript(
      ([cle, valeur]) => { try { sessionStorage.setItem(cle, valeur); } catch (e) { /* indisponible */ } },
      [CLE_BROUILLON, brut],
    ), echecs);
  }
}

/* ─── Envoi complet ──────────────────────────────────────────────────── */

/* Formulaire rempli */
async function remplirFormulaire(page) {
  await page.waitForFunction(() => document.querySelectorAll('.flatpickr-input').length === 2, { timeout: 12000 });
  await page.fill('#nom', 'Durand');
  await page.fill('#prenom', 'Claire');
  await page.fill('#telephone', '06 12 34 56 78');
  await page.fill('#email', 'essai@exemple.fr');
  await page.fill('#commune', 'Domagné');
  await page.fill('#nombreChats', '1');
  await page.selectOption('#frequence', '1 visite par jour');
  await page.evaluate(([debut, fin]) => {
    document.getElementById('dateDebut')._flatpickr.setDate(debut, true);
    document.getElementById('dateFin')._flatpickr.setDate(fin, true);
  }, [jourDecale(30), jourDecale(32)]);
}

/* Envois vers le faux Worker */
const envoisDepuis = (reseau, depart) => reseau.worker.envois.slice(depart);

/* Ni e-mail ni signalement */
function aucunAncienChemin(reseau, depart, courriels, nom, echecs) {
  if (reseau.courriels.length !== courriels) {
    echecs.push(`${nom} : ${reseau.courriels.length - courriels} appel(s) au service d'e-mail, attendu 0`);
  }
  const signalements = envoisDepuis(reseau, depart).filter((e) => e.chemin.endsWith('/notification-echouee'));
  if (signalements.length) echecs.push(`${nom} : ${signalements.length} signalement(s), attendu 0`);
}

async function pageReservation(navigateur, reseau, preparer) {
  const contexte = await nouveauContexte(navigateur, reseau, { viewport: { width: LARGEURS[0], height: 900 } });
  await refuserLaMesure(contexte);
  await intercepterMesure(contexte, []);
  await figerApiAdresse(contexte, new Set());
  if (preparer) await preparer(contexte);
  return { contexte, page: await contexte.newPage() };
}

async function testerEnvoi(navigateur, base, reseau, echecs) {
  const nom = 'reservation (envoi)';
  const { contexte, page } = await pageReservation(navigateur, reseau);
  const depart = reseau.worker.envois.length;
  const courriels = reseau.courriels.length;
  try {
    await page.goto(`${base}/reservation.html`, { waitUntil: 'networkidle' });
    await remplirFormulaire(page);
    await page.waitForFunction(() => window.__antirobot?.rendus === 1, { timeout: 5000 });
    await attendre(200);
    await page.click('#submit-button');
    await page.locator('#success-panel').waitFor({ state: 'visible', timeout: 8000 });

    const recus = envoisDepuis(reseau, depart).filter((e) => e.chemin === '/public/reservations');
    if (recus.length !== 1 || !recus[0].corps.includes('Durand')) {
      echecs.push(`${nom} : ${recus.length} demande(s) recue(s) par le faux Worker, attendu 1`);
    } else if (JSON.parse(recus[0].corps).turnstileToken !== 'jeton-essai-1') {
      echecs.push(`${nom} : jeton anti-robot absent de la demande`);
    }
    const options = await page.evaluate(() => ({
      action: window.__antirobot.options?.action, cle: window.__antirobot.options?.sitekey,
    }));
    if (options.action !== 'reservation' || options.cle !== CLE_ANTIROBOT_ESSAI) {
      echecs.push(`${nom} : case anti-robot mal reglee ${JSON.stringify(options)}`);
    }
    aucunAncienChemin(reseau, depart, courriels, nom, echecs);
    if (new URL(page.url()).search) echecs.push(`${nom} : parametres dans l'adresse`);
  } catch (e) {
    echecs.push(`${nom} : interrompu — ${e.message.split('\n')[0]}`);
  } finally {
    await contexte.close();
  }
}

/* Refus du serveur */
async function testerRefusAntirobot(navigateur, base, reseau, echecs) {
  const nom = 'reservation (refus anti-robot)';
  const { contexte, page } = await pageReservation(navigateur, reseau, (c) => c.addInitScript(
    (jeton) => { window.__jetonsAntirobot = [jeton]; }, JETON_REFUSE,
  ));
  const depart = reseau.worker.envois.length;
  const courriels = reseau.courriels.length;
  try {
    await page.goto(`${base}/reservation.html`, { waitUntil: 'networkidle' });
    await remplirFormulaire(page);
    await page.waitForFunction(() => window.__antirobot?.rendus === 1, { timeout: 5000 });
    await attendre(200);
    await page.click('#submit-button');
    await page.locator('#reservation-feedback').filter({ hasText: MESSAGE_REFUS }).waitFor({ timeout: 5000 });

    const vu = await page.evaluate(() => ({
      secours: !document.getElementById('antirobot-secours').hidden,
      motif: !document.getElementById('antirobot-motif').hidden,
      remises: window.__antirobot.remises,
      succes: !document.getElementById('success-panel').hidden,
    }));
    if (!vu.secours) echecs.push(`${nom} : phrase de secours absente`);
    if (vu.motif) echecs.push(`${nom} : la phrase de secours dit que le formulaire ne s'est pas charge`);
    if (vu.remises !== 1) echecs.push(`${nom} : case reinitialisee ${vu.remises} fois, attendu 1`);
    if (vu.succes) echecs.push(`${nom} : confirmation affichee apres un refus`);

    await attendre(200);
    await page.click('#submit-button');
    await page.locator('#success-panel').waitFor({ state: 'visible', timeout: 8000 });
    const jetons = envoisDepuis(reseau, depart).filter((e) => e.chemin === '/public/reservations')
      .map((e) => JSON.parse(e.corps).turnstileToken);
    if (jetons.length !== 2 || jetons[0] !== JETON_REFUSE || jetons[1] === JETON_REFUSE) {
      echecs.push(`${nom} : jetons envoyes ${JSON.stringify(jetons)}, attendu un jeton neuf au second envoi`);
    }
    aucunAncienChemin(reseau, depart, courriels, nom, echecs);
  } catch (e) {
    echecs.push(`${nom} : interrompu — ${e.message.split('\n')[0]}`);
  } finally {
    await contexte.close();
  }
}

/* Case qui ne se charge pas */
async function testerAntirobotAbsent(navigateur, base, reseau, echecs) {
  const nom = 'reservation (anti-robot absent)';
  const { contexte, page } = await pageReservation(navigateur, reseau, (c) => c.route(
    'https://challenges.cloudflare.com/**', (route) => route.abort(),
  ));
  const depart = reseau.worker.envois.length;
  const courriels = reseau.courriels.length;
  try {
    await page.goto(`${base}/reservation.html`, { waitUntil: 'networkidle' });
    await remplirFormulaire(page);
    if (!(await page.locator('#antirobot-secours').isVisible())) echecs.push(`${nom} : phrase de secours absente au chargement`);
    await page.click('#submit-button');
    await attendre(800);
    const vu = await page.evaluate(() => ({
      motif: !document.getElementById('antirobot-motif').hidden,
      alerte: document.getElementById('reservation-feedback').textContent.trim(),
    }));
    if (!(await page.locator('#antirobot-secours').isVisible()) || !vu.motif) {
      echecs.push(`${nom} : phrase de secours incomplete apres l'envoi`);
    }
    if (vu.alerte) echecs.push(`${nom} : message d'erreur affiche « ${vu.alerte} »`);
    const recus = envoisDepuis(reseau, depart).filter((e) => e.chemin === '/public/reservations');
    if (recus.length) echecs.push(`${nom} : ${recus.length} demande(s) partie(s), attendu 0`);
    aucunAncienChemin(reseau, depart, courriels, nom, echecs);
  } catch (e) {
    echecs.push(`${nom} : interrompu — ${e.message.split('\n')[0]}`);
  } finally {
    await contexte.close();
  }
}

/* Calculateur */
async function testerCalculateur(page, echecs) {
  const cas = { chats: 3, visites: 7, solidaire: true, km: 5 };

  const clic = (selecteur, fois = 1) => page.locator(selecteur).first().click({ clickCount: 1 })
    .then(() => (fois > 1 ? clic(selecteur, fois - 1) : null));

  await clic('[data-ajuster="chats"][data-pas="1"]', cas.chats - 1);
  await clic('[data-ajuster="visites"][data-pas="1"]', cas.visites - 1);
  await page.locator('[data-option="solidaire"]').click();
  await page.fill('#km-input', String(cas.km));
  await attendre(200);

  const vu = await page.evaluate(() => ({
    chats: document.getElementById('val-chats')?.textContent.trim(),
    visites: document.getElementById('val-visites')?.textContent.trim(),
    solidaireActif: document.getElementById('toggle-solidaire')?.classList.contains('active'),
    total: document.querySelector('.result-total .amount')?.textContent.trim(),
    acompte: document.querySelector('.breakdown-item.highlight .b-amount')?.textContent.trim(),
    lignes: document.querySelectorAll('.result-line').length,
  }));

  if (vu.chats !== String(cas.chats) || vu.visites !== String(cas.visites)) {
    echecs.push(`calculateur : les boutons ne comptent plus — ${vu.chats} chat(s), `
      + `${vu.visites} visite(s) affiches, attendu ${cas.chats} et ${cas.visites}`);
    return;
  }

  if (!vu.solidaireActif) {
    echecs.push('calculateur : la bascule de remise solidaire ne s\'active plus');
  }

  const attendu = estimerSejour(cas);

  if (vu.total !== formatEuros(attendu.total)) {
    echecs.push(`calculateur : total affiche ${vu.total || '(aucun)'}, `
      + `attendu ${formatEuros(attendu.total)} pour ${cas.chats} chats, ${cas.visites} visites, `
      + `remise solidaire, ${cas.km} km`);
  }

  if (vu.acompte !== formatEuros(attendu.acompte)) {
    echecs.push(`calculateur : acompte affiche ${vu.acompte || '(aucun)'}, `
      + `attendu ${formatEuros(attendu.acompte)}`);
  }

  // Quatre lignes de détail
  if (vu.lignes !== 4) {
    echecs.push(`calculateur : ${vu.lignes} ligne(s) de detail, attendu 4 `
      + '(base, remise sejour long, remise solidaire, supplement kilometrique)');
  }
}

/* Anonymat des avis */
async function testerAnonymatDesAvis(page, echecs) {
  const fautifs = await page.evaluate(() => {
    const noms = [...document.querySelectorAll('.avis-name')].map((e) => e.textContent.trim());
    const brut = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => s.textContent).find((t) => t.includes('"Review"')) ?? '';
    const ld = [...brut.matchAll(/"author":\s*\{[^}]*"name":\s*"([^"]+)"/g)].map((m) => m[1]);
    return [...noms, ...ld].filter((n) => n.trim().includes(' '));
  });
  if (fautifs.length) {
    echecs.push(`accueil : nom de famille publie dans un avis : ${fautifs.join(', ')}`);
  }
}

/* Compteur d'avis */
async function relevesCompteurAvis(page) {
  return page.evaluate(() => {
    const releves = [];
    // Texte rendu
    for (const m of (document.body.innerText || '').matchAll(/(\d+)\s+avis/g)) {
      releves.push({ type: 'affiche', source: `« ${m[0]} »`, valeur: Number(m[1]) });
    }
    const brut = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => s.textContent).find((t) => t.includes('"reviewCount"'));
    const ld = brut && brut.match(/"reviewCount":\s*"?(\d+)"?/);
    if (ld) releves.push({ type: 'jsonLd', source: 'reviewCount du JSON-LD', valeur: Number(ld[1]) });
    const cartes = document.querySelectorAll('.avis-card').length;
    if (cartes) releves.push({ type: 'cartes', source: 'cartes du carrousel', valeur: cartes });
    return releves;
  });
}

/* Bandeau de consentement */
async function testerConsentement(navigateur, base, largeur, reseau, echecs) {
  const prefixe = `consentement @${largeur}px`;

  for (const scenario of ['refuse', 'accepte']) {
    const contexte = await nouveauContexte(navigateur, reseau, { viewport: { width: largeur, height: 900 } });
    const appels = [];
    await intercepterMesure(contexte, appels);
    const page = await contexte.newPage();

    try {
      await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
      await attendre(300);

      const bandeau = page.locator('.consentement');
      if (!(await bandeau.count())) {
        echecs.push(`${prefixe} : aucun bandeau a la premiere visite`);
        continue;
      }
      if (appels.length) {
        echecs.push(`${prefixe} : ${appels.length} appel(s) a Google avant tout choix — ${appels[0]}`);
      }
      if (await page.evaluate((l) => document.documentElement.scrollWidth > l, largeur)) {
        echecs.push(`${prefixe} : le bandeau fait deborder la page`);
      }

      const geo = await page.evaluate(() => {
        const mesurer = (sel) => {
          const e = document.querySelector(sel);
          if (!e) return null;
          const b = e.getBoundingClientRect();
          return {
            largeur: Math.round(b.width), hauteur: Math.round(b.height),
            taille: getComputedStyle(e).fontSize,
          };
        };
        return { refuser: mesurer('.consentement-refuser'), accepter: mesurer('.consentement-accepter') };
      });
      if (!geo.refuser || !geo.accepter) {
        echecs.push(`${prefixe} : bouton ${geo.refuser ? 'accepter' : 'refuser'} absent`);
        continue;
      }
      if (Math.abs(geo.refuser.largeur - geo.accepter.largeur) > 1
        || geo.refuser.hauteur !== geo.accepter.hauteur
        || geo.refuser.taille !== geo.accepter.taille) {
        echecs.push(`${prefixe} : refuser n'a pas le meme poids qu'accepter — `
          + `refuser ${geo.refuser.largeur}x${geo.refuser.hauteur} en ${geo.refuser.taille}, `
          + `accepter ${geo.accepter.largeur}x${geo.accepter.hauteur} en ${geo.accepter.taille}`);
      }

      await page.locator(`.consentement-${scenario === 'refuse' ? 'refuser' : 'accepter'}`).click();
      await attendre(500);

      if (await bandeau.count()) echecs.push(`${prefixe} : le bandeau subsiste apres « ${scenario} »`);
      if (scenario === 'refuse' && appels.length) {
        echecs.push(`${prefixe} : ${appels.length} appel(s) a Google apres un refus — ${appels[0]}`);
      }
      if (scenario === 'accepte' && !appels.length) {
        echecs.push(`${prefixe} : aucun appel a Google apres un accord, la mesure ne demarre pas`);
      }

      await page.reload({ waitUntil: 'networkidle' });
      await attendre(300);
      if (await bandeau.count()) {
        echecs.push(`${prefixe} : le bandeau revient au rechargement apres « ${scenario} »`);
      }
    } catch (e) {
      echecs.push(`${prefixe} : interrompu — ${e.message.split('\n')[0]}`);
    } finally {
      await page.close();
      await contexte.close();
    }
  }
}

/* ─── 3. Coherence d'affichage ───────────────────────────────────────── */

/* Divergences admises */
const DIVERGENCES_ADMISES = new Map([
  ['barre.position', {
    pages: ['reservation.html', 'admin-indisponibilites.html'],
    raison: 'tunnel de réservation',
  }],
]);

/* Cohérence d'affichage */
async function relevesCoherence(page) {
  return page.evaluate(() => {
    const defauts = [];
    const arrondi = (n) => Math.round(n);
    const visible = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';

    // 1. Champs alignés
    const parLigne = new Map();
    for (const f of document.querySelectorAll('.field')) {
      if (!visible(f)) continue;
      const c = f.querySelector('input:not([type="hidden"]), select, textarea');
      if (!c) continue;
      const b = c.getBoundingClientRect();
      const cle = arrondi(f.getBoundingClientRect().top);
      if (!parLigne.has(cle)) parLigne.set(cle, []);
      parLigne.get(cle).push({
        nom: f.dataset.field || c.id || c.name || c.tagName.toLowerCase(),
        haut: arrondi(b.top), hauteur: arrondi(b.height), balise: c.tagName.toLowerCase(),
      });
    }
    for (const groupe of parLigne.values()) {
      if (groupe.length < 2) continue;
      // Hors zones de texte
      const simples = groupe.filter((g) => g.balise !== 'textarea');
      if (simples.length < 2) continue;
      const hauts = new Set(simples.map((g) => g.haut));
      const hauteurs = new Set(simples.map((g) => g.hauteur));
      if (hauts.size > 1) defauts.push(`champs desalignes : ${simples.map((g) => `${g.nom} commence a ${g.haut}px`).join(', ')}`);
      if (hauteurs.size > 1) defauts.push(`champs de hauteurs differentes : ${simples.map((g) => `${g.nom} fait ${g.hauteur}px`).join(', ')}`);
    }

    // 2. Cartes de même largeur
    const conteneurs = new Set();
    for (const c of document.querySelectorAll('.card, .zone-card, .rule-card')) {
      if (visible(c) && c.parentElement) conteneurs.add(c.parentElement);
    }
    for (const parent of conteneurs) {
      const s = getComputedStyle(parent);
      if (s.display !== 'flex' || !s.flexDirection.startsWith('column')) continue;
      const soeurs = [...parent.children]
        .filter((e) => visible(e) && /(^|\s)(card|zone-card|rule-card)(\s|$)/.test(e.className));
      if (soeurs.length < 2) continue;
      const largeurs = new Set(soeurs.map((e) => arrondi(e.getBoundingClientRect().width)));
      if (largeurs.size > 1) {
        defauts.push(`cartes de largeurs differentes dans la meme colonne : `
          + soeurs.map((e) => `${String(e.className).trim()} fait ${arrondi(e.getBoundingClientRect().width)}px`).join(', '));
      }
    }

    // 3. Signature barre et pied
    const signer = (sel, props) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const s = getComputedStyle(e);
      return Object.fromEntries(props.map((p) => [p, s[p]]));
    };
    const signature = {
      barre: signer('.topbar', ['minHeight', 'padding', 'backgroundColor', 'position']),
      lienBarre: signer('.topbar-links a', ['color', 'fontSize', 'fontWeight', 'fontFamily']),
      pied: signer('.footer-bar', ['padding', 'backgroundColor', 'flexDirection']),
      mentionLegale: signer('.footer-bar .footer-legal', ['color', 'fontSize']),
    };

    // 4. Navigation identique
    const liens = (sel) => {
      const trouves = [...document.querySelectorAll(sel)];
      if (!trouves.length) return null;
      return {
        liste: trouves
          .map((a) => `${a.getAttribute('href')} « ${a.textContent.replace(/\s+/g, ' ').trim()} »`)
          .join(' | '),
      };
    };
    const navigation = {
      menu: liens('.tmenu-panel a'),
      liensBarre: liens('.topbar-links a'),
      liensPied: liens('.footer-bar a'),
    };

    return { defauts, signature: { ...signature, ...navigation } };
  });
}

/* ─── 3 bis. Taux metier ────────────────────────────────────────────── */

/* Texte des pages */
function relevesTauxMetier(page) {
  return page.evaluate(() => {
    const morceaux = [document.body?.textContent || ''];
    for (const bloc of document.querySelectorAll('script[type="application/ld+json"]')) {
      morceaux.push(bloc.textContent || '');
    }
    // Espaces insécables
    return morceaux.join('\n').replace(/[  ]/g, ' ');
  });
}

/* Taux métier */
const TAUX_ANNONCES = [
  {
    nom: 'frais kilometriques',
    motif: /(\d{1,3}(?:[.,]\d{1,2})?)\s*€\s*\/\s*km/g,
    attendu: () => FRAIS_KM_EUR,
    lire: (brut) => Number(brut.replace(',', '.')),
    ecrire: (valeur) => `${formatEuros(valeur)}/km`,
  },
  {
    nom: 'acompte',
    motif: /acompte\s+(?:de|à)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*%/gi,
    attendu: () => TAUX_ACOMPTE * 100,
    lire: (brut) => Number(brut.replace(',', '.')),
    ecrire: (valeur) => `acompte de ${valeur} %`,
  },
];

export function controlerTauxMetier(texte) {
  const defauts = [];

  for (const taux of TAUX_ANNONCES) {
    const attendu = taux.attendu();
    for (const trouve of texte.matchAll(taux.motif)) {
      const valeur = taux.lire(trouve[1]);
      if (Math.abs(valeur - attendu) < 0.005) continue;
      defauts.push(
        `${taux.nom} : la page annonce « ${trouve[0].trim()} » alors que `
        + `shared/tarifs.js dit ${taux.ecrire(attendu)}. `
        + `Mettre a jour l'un des deux — le texte de la page, ou le taux.`,
      );
    }
  }

  return defauts;
}

/* ─── 4. Parcours utilisateurs ───────────────────────────────────────── */

/* Parcours */
const PARCOURS = [
  {
    nom: 'accueil → carte → reservation',
    etapes: ['index.html', 'carte.html', 'reservation.html'],
    // Commune d'abord
    avant: {
      'carte.html': async (page) => {
        await page.fill('#searchInput', 'Vitré');
        await page.click('#searchBtn');
        await attendre(1400);
      },
    },
  },
  { nom: 'accueil → tarifs → reservation', etapes: ['index.html', 'tarifs.html', 'reservation.html'] },
  { nom: 'faq → reservation', etapes: ['faq.html', 'reservation.html'] },
];

/* Repères d'arrivée */
const REPERE = {
  'index.html': '.hero-title',
  'carte.html': '#searchInput',
  'tarifs.html': '.t-hero h1',
  'faq.html': '.acc-question',
  'reservation.html': '#reservation-form',
};

async function testerParcours(contexte, base, echecs) {
  for (const { nom, etapes, avant = {} } of PARCOURS) {
    const page = await contexte.newPage();
    try {
      await page.goto(`${base}/${etapes[0]}`, { waitUntil: 'networkidle' });
      if (avant[etapes[0]]) await avant[etapes[0]](page);

      for (let i = 1; i < etapes.length; i++) {
        const cible = etapes[i];
        // Lien du contenu
        const lien = page.locator(
          `a[href="${cible}"]:not(.tmenu-panel a):not(.topbar-links a):not(.footer-bar a)`,
        ).filter({ visible: true }).first();

        if (!(await lien.count())) {
          echecs.push(`parcours ${nom} : aucun lien vers ${cible} dans le contenu de ${etapes[i - 1]}`);
          break;
        }

        await lien.click();
        await page.waitForLoadState('networkidle').catch(() => {});
        await attendre(400);

        const chemin = new URL(page.url()).pathname;
        if (!chemin.endsWith(`/${cible}`)) {
          echecs.push(`parcours ${nom} : le lien vers ${cible} a mene a ${chemin}`);
          break;
        }

        const repere = page.locator(REPERE[cible]).first();
        if (!(await repere.count())) {
          echecs.push(`parcours ${nom} : ${cible} atteinte, mais « ${REPERE[cible]} » est absent`);
          break;
        }

        if (avant[cible]) await avant[cible](page);
      }
    } catch (e) {
      echecs.push(`parcours ${nom} : interrompu — ${e.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }
}

/* ─── Execution ──────────────────────────────────────────────────────── */

async function main() {
  const worker = await demarrerFauxWorker();
  const reseau = { worker, coupees: [], antirobot: [], courriels: [] };
  const serveur = await demarrerServeur(worker.url);
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const navigateur = await chromium.launch();
  const echecs = [];
  const empreintes = {};
  // Barre et pied
  const signatures = new Map();
  // Compteurs d'avis
  const compteursAvis = new Map();
  // Communes hors capture
  const requetesGeoInconnues = new Set();

  try {
    for (const largeur of LARGEURS) {
      const contexte = await nouveauContexte(navigateur, reseau, { viewport: { width: largeur, height: 900 } });
      // Avant toute navigation
      await figerApiAdresse(contexte, requetesGeoInconnues);
      // Consentement refusé
      await refuserLaMesure(contexte);
      const appelsMesure = [];
      await intercepterMesure(contexte, appelsMesure);
      for (const nomPage of PAGES) {
        const page = await contexte.newPage();
        const erreursJs = [];
        // Bruit local
        const bruitLocal = (t) => t.includes('404')
          || t.includes('Failed to fetch')
          || t.includes('ERR_FAILED');
        page.on('pageerror', (e) => { if (!bruitLocal(e.message)) erreursJs.push(e.message); });
        page.on('console', (m) => { if (m.type() === 'error' && !bruitLocal(m.text())) erreursJs.push(m.text()); });

        appelsMesure.length = 0;
        await page.goto(`${base}/${nomPage}`, { waitUntil: 'networkidle' }).catch(() => {});
        await attendre(600);

        if (appelsMesure.length) {
          echecs.push(`${nomPage} @${largeur}px : ${appelsMesure.length} appel(s) a Google `
            + `malgre un consentement refuse — ${appelsMesure[0]}`);
        }

        if (!COMPORTEMENT_SEUL && !SANS_EMPREINTE.has(nomPage)) {
          const manquantes = await attendrePolices(page);
          if (manquantes.length) {
            echecs.push(`${nomPage} @${largeur}px : police non chargee — ${manquantes.join(', ')}. `
              + "L'empreinte serait mesuree avec la police de secours : releve ignore.");
          } else {
            empreintes[`${nomPage}@${largeur}`] = await empreinte(page);
          }
        }

        const debordement = await page.evaluate((l) => document.documentElement.scrollWidth > l, largeur);
        if (debordement) echecs.push(`${nomPage} @${largeur}px : debordement horizontal`);

        const coherence = await relevesCoherence(page);
        for (const d of coherence.defauts) echecs.push(`${nomPage} @${largeur}px : ${d}`);

        // Une lecture suffit
        if (largeur === LARGEURS[0]) {
          for (const d of controlerTauxMetier(await relevesTauxMetier(page))) {
            echecs.push(`${nomPage} : ${d}`);
          }
        }

        for (const [bloc, sig] of Object.entries(coherence.signature)) {
          if (!sig) continue;
          for (const [prop, valeur] of Object.entries(sig)) {
            const cle = `${bloc}.${prop}@${largeur}`;
            if (!signatures.has(cle)) signatures.set(cle, new Map());
            const vues = signatures.get(cle);
            if (!vues.has(valeur)) vues.set(valeur, []);
            vues.get(valeur).push(nomPage);
          }
        }

        if (largeur === LARGEURS[0]) {
          await testerMenu(page, echecs, nomPage);
          if (nomPage === 'faq.html') await testerFaq(page, echecs);
          if (nomPage === 'carte.html') await testerCarte(page, echecs);
          if (nomPage === 'reservation.html') await testerReservation(page, echecs);
          if (nomPage === 'index.html') await testerAnonymatDesAvis(page, echecs);
          if (nomPage === 'calculateur-miaoucratie.html') await testerCalculateur(page, echecs);

          const compteurs = await relevesCompteurAvis(page);
          for (const r of compteurs) {
            if (!compteursAvis.has(r.valeur)) compteursAvis.set(r.valeur, []);
            compteursAvis.get(r.valeur).push(`${nomPage} : ${r.source}`);
          }
          // Présence des compteurs
          if (nomPage === 'index.html') {
            for (const [type, quoi] of [
              ['affiche', 'la mention « N avis »'],
              ['jsonLd', 'le reviewCount du JSON-LD'],
              ['cartes', 'les cartes du carrousel'],
            ]) {
              if (!compteurs.some((r) => r.type === type)) {
                echecs.push(`accueil : ${quoi} a disparu — l'avis Google n'est plus affiche`);
              }
            }
          }
        }

        if (erreursJs.length) echecs.push(`${nomPage} @${largeur}px : erreur JS — ${erreursJs[0]}`);
        if (largeur === LARGEURS[0] && nomPage === 'admin-indisponibilites.html') {
          await testerConnexion(page, reseau, echecs);
        }
        await page.close();
      }
      // Deux largeurs
      await testerConsentement(navigateur, base, largeur, reseau, echecs);
      // Une fois, en bureau
      if (largeur === LARGEURS[0]) await testerParcours(contexte, base, echecs);
      await contexte.close();
    }

    await testerSecours(navigateur, base, reseau, echecs);
    await testerCoupures(navigateur, base, reseau, echecs);
    await testerEnvoi(navigateur, base, reseau, echecs);
    await testerRefusAntirobot(navigateur, base, reseau, echecs);
    await testerAntirobotAbsent(navigateur, base, reseau, echecs);
    await testerGestion(navigateur, base, reseau, echecs);

    // Barre et pied identiques
    for (const [cle, vues] of signatures) {
      if (vues.size < 2) continue;
      const [blocProp, largeur] = cle.split('@');
      const admise = DIVERGENCES_ADMISES.get(blocProp);
      const pagesDivergentes = [...vues.values()].sort((a, b) => a.length - b.length)[0];
      if (admise && pagesDivergentes.every((p) => admise.pages.includes(p))) continue;
      const detail = [...vues.entries()]
        .map(([v, pages]) => `\n        ${v}  —  ${pages.join(', ')}`)
        .join('');
      echecs.push(`${blocProp} @${largeur}px : ${vues.size} valeurs differentes selon la page${detail}`);
    }

    // Un seul nombre d'avis
    if (compteursAvis.size > 1) {
      const detail = [...compteursAvis.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([valeur, ou]) => `\n        ${valeur}  —  ${ou.join(', ')}`)
        .join('');
      echecs.push(`nombre d'avis : ${compteursAvis.size} valeurs differentes selon l'emplacement${detail}`);
    }

    if (COMPORTEMENT_SEUL) {
      console.log("Mode comportement : l'empreinte visuelle n'est pas comparée,\n"
        + 'elle ne serait pas fiable sur un autre système que celui qui l\'a produite.');
    } else if (MAJ) {
      // Relevé incomplet
      if (echecs.some((e) => e.includes('police non chargee'))) {
        console.error('\nReference non regeneree : une police a manque, le releve serait incomplet.');
        console.error('Relancez la commande.\n');
        process.exitCode = 1;
        return;
      }
      await mkdir(join(RACINE, 'qa'), { recursive: true });
      await writeFile(REFERENCE, JSON.stringify(empreintes, null, 1), 'utf8');
      const total = Object.values(empreintes).reduce((n, v) => n + v.length, 0);
      console.log(`Reference regeneree : ${Object.keys(empreintes).length} vues, ${total} elements.`);
    } else if (!existsSync(REFERENCE)) {
      console.log('Aucune reference. Lancez d\'abord : npm run qa:update');
      process.exitCode = 1;
      return;
    } else {
      const ref = JSON.parse(await readFile(REFERENCE, 'utf8'));
      for (const [cle, actuel] of Object.entries(empreintes)) {
        const attendu = ref[cle];
        if (!attendu) { echecs.push(`${cle} : absent de la reference`); continue; }
        let n = 0, premier = null;
        const tous = [];
        for (let i = 0; i < Math.max(attendu.length, actuel.length); i++) {
          if (!memeElement(attendu[i], actuel[i])) {
            n++;
            const paire = `\n        avant : ${attendu[i] ?? '(absent)'}\n        apres : ${actuel[i] ?? '(absent)'}`;
            premier ??= paire;
            if (DETAIL) tous.push(`\n      [${i}]${paire}`);
          }
        }
        if (n) echecs.push(`${cle} : ${n} ecart(s) visuel(s)${DETAIL ? tous.join('') : premier}`);
      }
    }
  } finally {
    await navigateur.close();
    serveur.close();
    worker.serveur.close();
  }

  for (const trace of new Set(reseau.coupees)) echecs.push(`requete sortante coupee : ${trace}`);

  if (requetesGeoInconnues.size) {
    console.error(
      `\nAPI adresse : ${[...requetesGeoInconnues].map((q) => `« ${q} »`).join(', ')} `
      + `absente(s) de qa/fixtures/geo-api.json — reponse vide servie.`
      + `\nSi une commune temoin a ete ajoutee, capturer sa reponse dans le fichier.\n`,
    );
  }

  if (echecs.length) {
    console.error(`\n${echecs.length} probleme(s) :\n`);
    for (const e of echecs) console.error('  - ' + e);
    if (!COMPORTEMENT_SEUL) {
      console.error('\nSi le changement est voulu : npm run qa:update');
    }
    console.error('');
    process.exitCode = 1;
  } else if (!MAJ) {
    console.log(COMPORTEMENT_SEUL
      ? `Aucune regression de comportement. ${PAGES.length} pages, ${LARGEURS.length} largeurs.`
      : `Aucune regression. ${Object.keys(empreintes).length} vues verifiees.`);
  }
}

// Lancement direct
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main();
}
