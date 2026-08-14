/**
 * Harnais de non-regression du site Miaoucratie.
 *
 *   npm run qa          verifie le site contre la reference
 *   npm run qa:update   regenere la reference (a faire APRES avoir valide un changement voulu)
 *
 * Deux familles de controles :
 *
 *  1. Empreinte visuelle. Pour chaque element de chaque page, on releve ses
 *     dimensions, sa position et ses styles calcules. Toute difference avec la
 *     reference est signalee. C'est ce qui attrape les regressions silencieuses
 *     d'une modification CSS.
 *
 *  2. Comportement. Menu, accordeon, filtres, recherche, moteur de communes,
 *     initialisation du calendrier. C'est ce qui attrape les regressions
 *     silencieuses d'une modification HTML ou JS — une page peut avoir des
 *     balises parfaitement equilibrees et n'avoir plus aucun JavaScript.
 *
 * Pieges connus, traites ici :
 *  - les elements Leaflet sont exclus de l'empreinte : le marqueur de depart
 *    depend d'un appel reseau, sa presence varie d'un chargement a l'autre ;
 *  - les ressources CDN (Flatpickr, hCaptcha) chargent de facon asynchrone :
 *    on attend explicitement leur presence plutot qu'un delai fixe.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REFERENCE = join(RACINE, 'qa', 'reference.json');
const MAJ = process.argv.includes('--update');

const PAGES = [
  'index.html', 'tarifs.html', 'faq.html', 'carte.html', 'reservation.html',
  'cgv.html', 'mentions-legales.html', 'calculateur-miaoucratie.html',
  'admin-indisponibilites.html',
];
const LARGEURS = [1272, 375];

/**
 * Pages exclues de l'empreinte visuelle, mais pas des controles de
 * comportement : leur rendu depend d'un appel a l'API de reservation, qui
 * n'autorise que l'origine de production. En local, leur hauteur varie donc
 * d'un passage a l'autre sans qu'aucune regression soit en cause.
 */
const SANS_EMPREINTE = new Set(['admin-indisponibilites.html']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml',
};

/** Sert le dossier du site, pour tester au plus pres de la production. */
function demarrerServeur() {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0]);
    const fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
    if (!fichier.startsWith(RACINE) || !existsSync(fichier)) {
      res.writeHead(404).end('introuvable');
      return;
    }
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
      res.end(await readFile(fichier));
    } catch {
      res.writeHead(500).end('erreur');
    }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(serveur)));
}

/* ─── 1. Empreinte visuelle ──────────────────────────────────────────── */

async function empreinte(page) {
  return page.evaluate(() => {
    const sel = 'h1,h2,h3,h4,p,a,button,img,li,strong,span,div,input,select,textarea';
    return [...document.querySelectorAll(sel)]
      // Leaflet se rend de facon asynchrone : ses elements produisent
      // des ecarts reproductibles mais sans signification.
      .filter((e) => !String(e.className || '').includes('leaflet'))
      .map((e) => {
        const b = e.getBoundingClientRect();
        const c = getComputedStyle(e);
        return [
          e.tagName, String(e.className || '').replace(/\s+/g, ' ').slice(0, 30),
          Math.round(b.width), Math.round(b.height), Math.round(b.left), Math.round(b.top),
          c.color, c.backgroundColor, c.fontSize, c.fontWeight, c.fontStyle,
          c.fontFamily.split(',')[0], c.display, c.borderRadius, c.padding, c.margin,
          c.textAlign, c.opacity, c.visibility,
        ].join('|');
      });
  });
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

  // Accordeon : la classe et aria doivent basculer (la hauteur suit une
  // transition de 400ms, on ne la mesure donc pas).
  const item = page.locator('.acc-item').nth(4);
  const avant = await item.evaluate((e) => e.classList.contains('open'));
  await item.locator('.acc-trigger').click();
  await attendre(600);
  const apres = await item.evaluate((e) => e.classList.contains('open'));
  if (avant === apres) echecs.push("faq : l'accordeon ne bascule pas");
  const aria = await item.locator('.acc-trigger').getAttribute('aria-expanded');
  if (aria !== String(apres)) echecs.push('faq : aria-expanded desynchronise de la classe');

  // Filtres : chaque filtre ne doit laisser que sa categorie
  for (const cat of ['soins', 'tarifs', 'legal']) {
    await page.click(`.filter-btn[data-filter="${cat}"]`);
    await attendre(350);
    const visibles = await page.evaluate(() =>
      [...document.querySelectorAll('.faq-section')]
        .filter((s) => getComputedStyle(s).display !== 'none')
        .map((s) => s.dataset.cat));
    if (visibles.length !== 1 || visibles[0] !== cat) {
      echecs.push(`faq : filtre "${cat}" affiche ${JSON.stringify(visibles)}`);
    }
  }
  await page.click('.filter-btn[data-filter="all"]');
  await attendre(300);

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

  // Les donnees structurees doivent refleter le texte affiche,
  // sinon Google ignore le resultat enrichi.
  const sync = await page.evaluate(() => {
    const vues = [...document.querySelectorAll('.acc-question')].map((e) => e.textContent.trim());
    const brut = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => s.textContent).find((t) => t.includes('FAQPage'));
    if (!brut) return { erreur: 'aucun bloc FAQPage' };
    const ld = (JSON.parse(brut).mainEntity ?? []).map((e) => e.name);
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

  // Le bouton Reinitialiser doit vider l'etat, y compris le CONTENU de la
  // pastille flottante : la masquer sans la reinitialiser laisse un resultat
  // perime qui reapparait a la recherche suivante.
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
  // Flatpickr vient d'un CDN : on attend sa presence plutot qu'un delai fixe.
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

  // Le champ conditionnel doit rester masque tant qu'il n'est pas demande.
  const masque = await page.evaluate(() => {
    const e = document.getElementById('autre-frequence-wrapper');
    return e ? getComputedStyle(e).display === 'none' : null;
  });
  if (masque === false) echecs.push('reservation : le champ conditionnel "autre frequence" est visible a tort');
}

/** Regle non negociable : jamais le nom de famille d'un client sur le site. */
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

/* ─── Execution ──────────────────────────────────────────────────────── */

async function main() {
  const serveur = await demarrerServeur();
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const navigateur = await chromium.launch();
  const echecs = [];
  const empreintes = {};

  try {
    for (const largeur of LARGEURS) {
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 } });
      for (const nomPage of PAGES) {
        const page = await contexte.newPage();
        const erreursJs = [];
        // Bruit attendu en local, sans rapport avec une regression :
        //  - 404 sur le favicon en chemin absolu ;
        //  - CORS sur l'API de reservation, qui n'autorise que l'origine de
        //    production. C'est le comportement voulu de l'API, pas un defaut.
        const bruitLocal = (t) => t.includes('404')
          || (t.includes('CORS') && t.includes('miaoucratie'))
          || t.includes('Failed to fetch')
          || t.includes('ERR_FAILED');
        page.on('pageerror', (e) => { if (!bruitLocal(e.message)) erreursJs.push(e.message); });
        page.on('console', (m) => { if (m.type() === 'error' && !bruitLocal(m.text())) erreursJs.push(m.text()); });

        await page.goto(`${base}/${nomPage}`, { waitUntil: 'networkidle' }).catch(() => {});
        await attendre(600);

        if (!SANS_EMPREINTE.has(nomPage)) {
          empreintes[`${nomPage}@${largeur}`] = await empreinte(page);
        }

        const debordement = await page.evaluate((l) => document.documentElement.scrollWidth > l, largeur);
        if (debordement) echecs.push(`${nomPage} @${largeur}px : debordement horizontal`);

        if (largeur === LARGEURS[0]) {
          await testerMenu(page, echecs, nomPage);
          if (nomPage === 'faq.html') await testerFaq(page, echecs);
          if (nomPage === 'carte.html') await testerCarte(page, echecs);
          if (nomPage === 'reservation.html') await testerReservation(page, echecs);
          if (nomPage === 'index.html') await testerAnonymatDesAvis(page, echecs);
        }

        if (erreursJs.length) echecs.push(`${nomPage} @${largeur}px : erreur JS — ${erreursJs[0]}`);
        await page.close();
      }
      await contexte.close();
    }

    if (MAJ) {
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
        for (let i = 0; i < Math.max(attendu.length, actuel.length); i++) {
          if (attendu[i] !== actuel[i]) {
            n++;
            premier ??= `\n        avant : ${attendu[i] ?? '(absent)'}\n        apres : ${actuel[i] ?? '(absent)'}`;
          }
        }
        if (n) echecs.push(`${cle} : ${n} ecart(s) visuel(s)${premier}`);
      }
    }
  } finally {
    await navigateur.close();
    serveur.close();
  }

  if (echecs.length) {
    console.error(`\n${echecs.length} probleme(s) :\n`);
    for (const e of echecs) console.error('  - ' + e);
    console.error('\nSi le changement est voulu : npm run qa:update\n');
    process.exitCode = 1;
  } else if (!MAJ) {
    console.log(`Aucune regression. ${Object.keys(empreintes).length} vues verifiees.`);
  }
}

main();
