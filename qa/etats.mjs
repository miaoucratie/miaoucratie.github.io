/* États des pages */

import {
  DEMANDES_ESSAI, INDISPONIBILITES_DATEES, JETON_REFUSE, JOUR_FIGE, MOT_DE_PASSE_ESSAI,
  figerApiAdresse, intercepterMesure, jourDecale, nouveauContexte, refuserLaMesure, remplirFormulaire,
} from './qa.mjs';

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* Étape en cours */
export const suivi = { etape: 'démarrage' };
const etape = (texte) => { suivi.etape = texte; };
const INTERACTIONS = /:(hover|focus-visible|focus-within|focus|active)\b/g;

/* Animations terminées */
const finirAnimations = (page) => page.evaluate(() => document.getAnimations().forEach((a) => {
  try { a.finish(); } catch { a.cancel(); }
}));

/* Page stabilisée */
async function stabiliser(page) {
  await page.mouse.move(0, 0);
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

/* Rendu figé */
async function figerRendu(page, sansJs) {
  const remettreSelects = 'document.querySelectorAll("select").forEach((s) => { const d = s.style.display; s.style.display = "none"; void s.offsetHeight; s.style.display = d; void s.offsetHeight; })';
  if (sansJs) {
    const cdp = await page.context().newCDPSession(page);
    const ev = async (e) => (await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
    await ev('document.querySelectorAll(\'img[loading="lazy"]\').forEach((i) => { i.loading = "eager"; })');
    await ev('window.scrollTo(0, document.documentElement.scrollHeight)');
    await attendre(300);
    await page.waitForLoadState('networkidle');
    await ev('window.scrollTo(0, 0)');
    const pret = 'document.fonts.status === "loaded" && [...document.images].every((i) => i.complete) && scrollY === 0';
    for (let k = 0; k < 300 && !(await ev(pret)); k++) await attendre(100);
    await cdp.send('Runtime.evaluate', { expression: 'Promise.all([...document.images].map((i) => i.decode().catch(() => {})))', awaitPromise: true });
    await ev(remettreSelects);
    if (await ev('scrollY') !== 0) throw new Error('défilement non nul sans JavaScript');
    await cdp.detach();
    await attendre(300);
    return;
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelectorAll('select').forEach((s) => { const d = s.style.display; s.style.display = 'none'; void s.offsetHeight; s.style.display = d; void s.offsetHeight; });
    document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
    await Promise.race([
      Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => {})
        : new Promise((ok) => { i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }); }).then(() => i.decode().catch(() => {}))))),
      new Promise((ok) => setTimeout(ok, 15000)),
    ]);
    const actif = document.activeElement;
    const dansFixe = (e) => { for (; e && e !== document.body; e = e.parentElement) if (/fixed|sticky/.test(getComputedStyle(e).position)) return true; return false; };
    if (actif && actif !== document.body && actif !== document.documentElement && !dansFixe(actif)) {
      const r = actif.getBoundingClientRect();
      window.scrollTo({ left: 0, top: Math.round(scrollY + r.top + r.height / 2 - innerHeight / 2), behavior: 'instant' });
    } else if (scrollY > 0) {
      window.scrollTo({ left: 0, top: document.documentElement.scrollHeight, behavior: 'instant' });
    }
    await new Promise((ok) => {
      let y = scrollY, n = 0, t = 0;
      const pas = () => { if (scrollY === y) n++; else { y = scrollY; n = 0; } if (n >= 10 || ++t > 300) ok(); else requestAnimationFrame(pas); };
      requestAnimationFrame(pas);
    });
    window.scrollTo({ left: Math.floor(scrollX), top: Math.floor(scrollY), behavior: 'instant' });
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  });
}

/* Survol et focus forcés */
async function forcerInteractions(page, classes = ['hover', 'focus', 'focus-within', 'focus-visible', 'active'], premierSeul = false) {
  const selecteurs = await page.evaluate((source) => {
    const re = new RegExp(source, 'g');
    const vus = new Set();
    const lire = (regles) => {
      for (const r of regles) {
        if (r.cssRules && !(r instanceof CSSStyleRule)) lire(r.cssRules);
        else if (r instanceof CSSStyleRule && r.selectorText.match(re)) {
          for (const s of r.selectorText.split(',')) {
            const t = s.replace(/::?(before|after|marker|placeholder)\b/g, '');
            /* Élément porteur de la pseudo-classe */
            for (const m of t.matchAll(re)) vus.add(t.slice(0, m.index + m[0].length).replace(re, '').trim() || '*');
          }
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
    try { (await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: s })).nodeIds.slice(0, premierSeul ? 1 : undefined).forEach((n) => noeuds.add(n)); } catch { /* sélecteur hors DOM */ }
  }
  for (const n of noeuds) await cdp.send('CSS.forcePseudoState', { nodeId: n, forcedPseudoClasses: classes });
}

/* Rangées horizontales poussées jusqu'à stabilité */
const pousserRangees = (page, ou) => page.evaluate(async (ou) => {
  const image = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const rangees = [...document.querySelectorAll('body *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX));
  for (const e of rangees) {
    let avant = '';
    for (let k = 0; k < 20; k++) {
      const course = e.scrollWidth - e.clientWidth;
      const cible = ou === 'bout' ? course : Math.floor(course / 2);
      if (Math.abs(e.scrollLeft - cible) >= 1) e.scrollTo({ left: cible, behavior: 'instant' });
      e.dispatchEvent(new Event('scroll'));
      await image();
      const etat = `${e.scrollLeft}|${e.scrollWidth}|${e.className}`;
      if (etat === avant) break;
      avant = etat;
    }
  }
}, ou);

/* États communs */
async function etatsCommuns(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 600);
  await attendre(400);
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
    document.querySelectorAll('.acc-item').forEach((e) => e.classList.add('open'));
  });
  await pousserRangees(page, 'milieu');
  if (await page.$('#tmenuBtn')) await page.click('#tmenuBtn', { force: true }).catch(() => {});
  await attendre(300);
  await forcerInteractions(page);
}

/* Page défilée, carrousels au bout */
async function defiler(page) {
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 600);
  await attendre(400);
  await pousserRangees(page, 'bout');
  await attendre(300);
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
    ...[false, true].map((ouverte) => ({
      nom: ouverte ? 'archives ouvertes' : 'archives',
      demandes: true,
      preparer: (c) => c.route('**/admin/unavailabilities', (r) => (r.request().method() === 'GET'
        ? r.fulfill({ json: { ranges: [{ id: 1, startDate: jourDecale(10), endDate: jourDecale(14), comment: 'Essai' }, { id: 2, startDate: jourDecale(-20), endDate: jourDecale(-15), comment: 'Passée' }] } })
        : r.fallback())),
      agir: async (p) => {
        await p.fill('#admin-password', MOT_DE_PASSE_ESSAI); await p.press('#admin-password', 'Enter');
        await p.locator('#period-archive:not([hidden])').waitFor({ timeout: 5000 });
        if (ouverte) await p.click('#period-archive > summary');
        await attendre(300);
      },
    })),
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
    { nom: 'survol', agir: (p) => forcerInteractions(p, ['hover']) },
    { nom: 'focus', agir: (p) => forcerInteractions(p, ['focus', 'focus-within', 'focus-visible', 'active']) },
    { nom: 'défilée', agir: defiler },
    { nom: 'sans JavaScript', options: { javaScriptEnabled: false } },
    ...(SCENARIOS[nomPage] || []),
  ];
  for (const etat of etats) {
    const ici = `${largeur} px, « ${etat.nom} »`;
    etape(`${ici}, ouverture de la page`);
    const { contexte, page } = await ouvrir(etat);
    try {
      etape(`${ici}, action de l'état`);
      if (etat.agir) await etat.agir(page);
      /* Premier élément créé survolé */
      if ((SCENARIOS[nomPage] || []).includes(etat)) await forcerInteractions(page, ['hover'], true);
      etape(`${ici}, stabilisation`);
      await stabiliser(page);
      etape(`${ici}, gel du rendu`);
      await figerRendu(page, etat.options?.javaScriptEnabled === false);
      etape(`${ici}, mesure`);
      await mesurer(page, etat.nom);
    } catch (e) {
      throw new Error(`${nomPage} à ${largeur} px, état « ${etat.nom} » : ${e.message.split('\n')[0]}`);
    } finally {
      await contexte.close();
    }
  }
}
