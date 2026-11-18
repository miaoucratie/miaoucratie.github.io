/* États des pages */

import {
  DEMANDES_ESSAI, INDISPONIBILITES_DATEES, JETON_REFUSE, JOUR_FIGE, MOT_DE_PASSE_ESSAI,
  figerApiAdresse, intercepterMesure, nouveauContexte, refuserLaMesure, remplirFormulaire,
} from './qa.mjs';

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
const INTERACTIONS = /:(hover|focus-visible|focus-within|focus|active)\b/g;

/* Animations terminées */
const finirAnimations = (page) => page.evaluate(() => document.getAnimations().forEach((a) => {
  try { a.finish(); } catch { a.cancel(); }
}));

/* Page stabilisée */
async function stabiliser(page) {
  for (let i = 0; i < 20; i++) {
    const enCours = await page.evaluate(() => document.fonts.status !== 'loaded' || [...document.images].some((im) => im.loading !== 'lazy' && !im.complete));
    if (!enCours) break;
    await attendre(100);
  }
  await attendre(300);
  await finirAnimations(page);
  await attendre(100);
  await finirAnimations(page);
}

/* Survol et focus forcés */
async function forcerInteractions(page) {
  const selecteurs = await page.evaluate((source) => {
    const re = new RegExp(source, 'g');
    const vus = new Set();
    const lire = (regles) => {
      for (const r of regles) {
        if (r.cssRules && !(r instanceof CSSStyleRule)) lire(r.cssRules);
        else if (r instanceof CSSStyleRule && r.selectorText.match(re)) {
          for (const s of r.selectorText.split(',')) vus.add(s.replace(/::?(before|after|marker|placeholder)\b/g, '').replace(re, '').trim() || '*');
        }
      }
    };
    for (const f of document.styleSheets) { try { lire(f.cssRules); } catch { /* feuille tierce */ } }
    return [...vus];
  }, INTERACTIONS.source);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const noeuds = new Set();
  for (const s of selecteurs) {
    try { (await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: s })).nodeIds.forEach((n) => noeuds.add(n)); } catch { /* sélecteur hors DOM */ }
  }
  for (const n of noeuds) await cdp.send('CSS.forcePseudoState', { nodeId: n, forcedPseudoClasses: ['hover', 'focus', 'focus-within', 'focus-visible', 'active'] });
}

/* États communs */
async function etatsCommuns(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 600);
  await attendre(400);
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
    document.querySelectorAll('.acc-item').forEach((e) => e.classList.add('open'));
    for (const e of document.querySelectorAll('body *')) {
      if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) {
        e.scrollLeft = (e.scrollWidth - e.clientWidth) / 2;
        e.dispatchEvent(new Event('scroll'));
      }
    }
  });
  if (await page.$('#tmenuBtn')) await page.click('#tmenuBtn', { force: true }).catch(() => {});
  await attendre(300);
  await forcerInteractions(page);
}

/* Scénarios propres à une page */
const SCENARIOS = {
  'faq.html': [
    { nom: 'recherche', agir: async (p) => { await p.fill('#faqSearch', 'canicule'); await attendre(400); } },
    { nom: 'recherche vide', agir: async (p) => { await p.fill('#faqSearch', 'zzzzqqq'); await attendre(400); } },
  ],
  'carte.html': [
    ...['Vitré', 'Le Pertre', 'Rennes'].map((commune) => ({
      nom: `commune ${commune}`,
      agir: async (p) => { await p.fill('#searchInput', commune); await p.click('#searchBtn'); await attendre(1400); },
    })),
    { nom: 'propositions', agir: async (p) => { await p.fill('#searchInput', 'Vitré'); await attendre(1200); } },
    { nom: 'bulle du marqueur', agir: async (p) => { await p.waitForSelector('.leaflet-marker-icon'); await p.click('.leaflet-marker-icon', { force: true }); await attendre(600); } },
  ],
  'reservation.html': [
    { nom: 'calendrier', agir: async (p) => { await p.waitForFunction(() => document.getElementById('dateDebut')?._flatpickr); await p.evaluate(() => document.getElementById('dateDebut')._flatpickr.open()); await attendre(400); } },
    { nom: 'propositions', agir: async (p) => { await p.fill('#commune', 'Domagné'); await attendre(1200); } },
    { nom: 'calendrier avec période', agir: async (p) => { await remplirFormulaire(p); await p.evaluate(() => document.getElementById('dateFin')._flatpickr.open()); await attendre(400); } },
    {
      nom: 'envoi en cours',
      preparer: (c) => c.route('**/public/reservations', async (r) => { await attendre(8000); await r.fallback().catch(() => {}); }),
      agir: async (p) => { await remplirFormulaire(p); await p.waitForFunction(() => window.__antirobot?.rendus === 1, null, { timeout: 5000 }); await p.click('#submit-button'); await attendre(500); },
    },
    { nom: 'envoi vide', agir: async (p) => { await p.click('#submit-button', { force: true }); await attendre(400); } },
    { nom: 'envoyée', agir: async (p) => { await remplirFormulaire(p); await p.waitForFunction(() => window.__antirobot?.rendus === 1, null, { timeout: 5000 }); await p.click('#submit-button'); await p.locator('#success-panel').waitFor({ state: 'visible', timeout: 8000 }); } },
    {
      nom: 'refus anti-robot',
      preparer: (c) => c.addInitScript((jeton) => { window.__jetonsAntirobot = [jeton]; }, JETON_REFUSE),
      agir: async (p) => { await remplirFormulaire(p); await p.waitForFunction(() => window.__antirobot?.rendus === 1, null, { timeout: 5000 }); await p.click('#submit-button'); await attendre(1000); },
    },
    { nom: 'anti-robot absent', preparer: (c) => c.route('https://challenges.cloudflare.com/**', (r) => r.abort()), agir: async (p) => { await remplirFormulaire(p); await p.click('#submit-button'); await attendre(800); } },
    ...[['relais', '2026-12-28', '2027-01-05'], ['aucun jour', '2027-01-01', '2027-01-03']].map(([nom, debut, fin]) => ({
      nom,
      preparer: (c) => c.route('**/public/unavailabilities', (r) => r.fulfill({
        status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ranges: INDISPONIBILITES_DATEES }),
      })),
      horloge: JOUR_FIGE,
      agir: async (p) => {
        await p.waitForFunction(() => document.querySelectorAll('.flatpickr-input').length === 2, null, { timeout: 12000 });
        await p.evaluate(([d, f]) => { document.getElementById('dateDebut')._flatpickr.setDate(d, true); document.getElementById('dateFin')._flatpickr.setDate(f, true); }, [debut, fin]);
        await attendre(300);
      },
    })),
    { nom: 'sans JavaScript', options: { javaScriptEnabled: false } },
    { nom: 'sans module', preparer: (c) => c.route('**/js/reservation.js', (r) => r.abort()) },
  ],
  'administration.html': [
    { nom: 'refus', agir: async (p) => { await p.fill('#admin-password', 'essai'); await p.press('#admin-password', 'Enter'); await attendre(800); } },
    {
      nom: 'connexion en cours',
      preparer: (c) => c.route('**/admin/login', async (r) => { await attendre(8000); await r.fallback().catch(() => {}); }),
      agir: async (p) => { await p.fill('#admin-password', MOT_DE_PASSE_ESSAI); await p.press('#admin-password', 'Enter'); await attendre(500); },
    },
    {
      nom: 'connectée', demandes: true,
      agir: async (p) => { await p.fill('#admin-password', MOT_DE_PASSE_ESSAI); await p.press('#admin-password', 'Enter'); await p.locator('#demande-list .demande-card').first().waitFor({ timeout: 5000 }); },
    },
    {
      nom: 'modification', demandes: true,
      agir: async (p) => {
        await p.fill('#admin-password', MOT_DE_PASSE_ESSAI); await p.press('#admin-password', 'Enter');
        await p.locator('#period-list .period-card').first().waitFor({ timeout: 5000 });
        await p.locator('#period-list .period-card').first().getByRole('button', { name: 'Modifier' }).click();
        await attendre(300);
      },
    },
    { nom: 'sans JavaScript', options: { javaScriptEnabled: false } },
    { nom: 'sans module', preparer: (c) => c.route('**/js/admin-indisponibilites.js', (r) => r.abort()) },
  ],
};

/* Parcours de tous les états */
export async function parcourirEtats(navigateur, base, reseau, nomPage, largeur, mesurer) {
  const ouvrir = async (scenario = {}) => {
    const contexte = await nouveauContexte(navigateur, reseau, { viewport: { width: largeur, height: 900 }, ...(scenario.options || {}) });
    await intercepterMesure(contexte, []);
    await figerApiAdresse(contexte, new Set());
    if (scenario.consentement !== true) await refuserLaMesure(contexte);
    if (scenario.preparer) await scenario.preparer(contexte);
    reseau.worker.reglages.demandes = scenario.demandes ? DEMANDES_ESSAI() : [];
    const page = await contexte.newPage();
    page.on('dialog', (d) => d.accept());
    if (scenario.horloge) await page.clock.setFixedTime(scenario.horloge);
    await page.goto(`${base}/${nomPage}`, { waitUntil: 'networkidle' });
    await stabiliser(page);
    return { contexte, page };
  };
  const etats = [
    { nom: 'ouverture', consentement: true },
    { nom: 'états courants', agir: etatsCommuns },
    ...(SCENARIOS[nomPage] || []),
  ];
  for (const etat of etats) {
    const { contexte, page } = await ouvrir(etat);
    try {
      if (etat.agir) await etat.agir(page);
      await stabiliser(page);
      await mesurer(page, etat.nom);
    } catch (e) {
      throw new Error(`${nomPage} à ${largeur} px, état « ${etat.nom} » : ${e.message.split('\n')[0]}`);
    } finally {
      await contexte.close();
    }
  }
}
