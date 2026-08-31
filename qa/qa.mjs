/**
 * Harnais de non-regression du site Miaoucratie.
 *
 * Ce commentaire est la reference des options : le README y renvoie plutot
 * que de les recopier, pour qu'il n'y ait qu'un seul endroit a tenir a jour.
 *
 *   npm run qa                    verifie le site contre la reference
 *   npm run qa -- --detail        liste TOUS les ecarts, pas seulement le premier
 *   npm run qa -- --comportement  ignore l'apparence, ne teste que le comportement
 *   npm run qa:update             regenere la reference, APRES avoir valide a l'oeil
 *                                 que le changement visuel est bien celui qu'on voulait
 *
 * Deux familles de controles :
 *
 *  1. Empreinte visuelle. Pour chaque element de chaque page, on releve ses
 *     dimensions, sa position et ses styles calcules. Toute difference avec la
 *     reference est signalee. C'est ce qui attrape les regressions silencieuses
 *     d'une modification CSS.
 *
 *  2. Comportement. Menu, accordeon, filtres, recherche, moteur de communes,
 *     initialisation du calendrier, calculateur de tarif, anonymat des avis,
 *     consentement a la mesure d'audience. C'est ce qui attrape les
 *     regressions silencieuses d'une modification HTML ou JS — une page peut
 *     avoir des balises parfaitement equilibrees et n'avoir plus aucun
 *     JavaScript.
 *
 *  3. Taux metier annonces. Le tarif kilometrique et le taux d'acompte sont
 *     repetes dans le texte de plusieurs pages : on verifie qu'ils disent tous
 *     ce que dit shared/tarifs.js. Une hausse appliquee partout sauf a un
 *     endroit ne casse rien et ne se voit pas — le site annonce simplement
 *     deux tarifs selon la page ouverte.
 *
 * Pieges connus, traites ici :
 *  - les elements Leaflet sont exclus de l'empreinte : le marqueur de depart
 *    depend d'un appel reseau, sa presence varie d'un chargement a l'autre ;
 *  - les ressources CDN (Flatpickr, hCaptcha) chargent de facon asynchrone :
 *    on attend explicitement leur presence plutot qu'un delai fixe ;
 *  - les polices sont servies par le site depuis le 16 aout 2026. Elles
 *    venaient de fonts.gstatic.com et ce trajet cassait environ une fois sur
 *    sept, ce qui rendait la verification aleatoire. Le controle reste en
 *    place — il attraperait desormais un chemin casse dans polices.css ;
 *  - l'API adresse (geo.api.gouv.fr) est interceptee depuis le 17 aout 2026 et
 *    servie depuis qa/fixtures/geo-api.json. Elle faisait echouer la carte en
 *    bloc — Rennes classee « sur devis », reinitialisation incomplete — puis
 *    repassait au vert au tour suivant sans qu'une ligne ait bouge. Voir
 *    figerApiAdresse plus bas ;
 *  - la mesure d'audience attend un consentement depuis le 17 aout 2026. Les
 *    vues sont mesurees avec un refus deja enregistre, sans quoi le bandeau
 *    s'ajouterait a chaque page et masquerait des liens dans les parcours.
 *    Toute requete vers Google est en outre interceptee et comptee : une page
 *    qui mesurerait malgre le refus est nommee. Voir refuserLaMesure.
 *
 * Le harnais teste ses propres fonctions : `node --test` couvre memeElement,
 * l'oracle qui decide si deux releves sont identiques. Sans ce filet, une
 * tolerance trop large rendrait la QA verte pour de mauvaises raisons.
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
// Importe pour son effet : le fichier pose son contenu sur globalThis au lieu
// de l'exporter, pour rester chargeable en script classique depuis file://.
// Voir son en-tete.
import '../shared/tarifs.js';

const {
  FRAIS_KM_EUR, TAUX_ACOMPTE, estimerSejour, formatEuros,
} = globalThis.MiaouTarifs;

const RACINE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REFERENCE = join(RACINE, 'qa', 'reference.json');
const MAJ = process.argv.includes('--update');

/**
 * Par defaut un ecart visuel n'affiche que son premier exemple : de quoi
 * signaler une regression, pas de quoi conduire un refactoring. Le mode
 * detaille les liste tous, avec la vue et l'element concernes.
 */
const DETAIL = process.argv.includes('--detail');

/**
 * L'empreinte visuelle ne franchit pas la frontière entre systèmes.
 *
 * Mesurée sous Windows puis sous Ubuntu, la même page donne des largeurs de
 * texte qui diffèrent de 2 à 3 % : DM Sans est bien chargée des deux côtés,
 * mais la rastérisation et le crénage diffèrent. Ces écarts s'accumulent
 * verticalement — jusqu'à 29 px sur la hauteur d'une page. Aucune tolérance
 * ne règle ça : celle qui absorberait 29 px masquerait aussi la barre passée
 * de 50 à 67 px, régression réelle rencontrée le 11 août.
 *
 * L'empreinte reste donc un outil local, comparée à une référence produite
 * sur la même machine. En intégration continue, on ne garde que ce qui est
 * portable : comportement, erreurs JavaScript, débordement. C'est d'ailleurs
 * ce qui aurait attrapé la panne de la FAQ — menu mort, accordéon figé,
 * filtres inopérants — sans jamais mesurer un pixel.
 */
const COMPORTEMENT_SEUL = process.argv.includes('--comportement') || !!process.env.CI;

const PAGES = [
  'index.html', 'tarifs.html', 'faq.html', 'carte.html', 'reservation.html',
  'presse.html', 'ce-que-jutilise.html', 'cgv.html', 'mentions-legales.html',
  'calculateur-miaoucratie.html', 'admin-indisponibilites.html',
  /* alimentation-du-chat.html a ete scindee en deux articles : l'un sur la
     lecture d'une etiquette, l'autre sur la repartition entre croquettes et
     patee. La page n'existe plus. */
  'blog.html', 'etiquette-nourriture-chat.html', 'croquettes-et-patee.html',
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

/* ─── API adresse : reponses figees ──────────────────────────────────── */

/**
 * La carte et le formulaire de reservation interrogent geo.api.gouv.fr. Tant
 * que l'appel partait sur le vrai reseau, la QA pouvait echouer en bloc —
 * Rennes classee « sur devis », reinitialisation incomplete — puis repasser au
 * vert au tour suivant sans qu'une ligne ait bouge. Un oracle qui echoue au
 * hasard est pire que pas d'oracle : on finit par ne plus croire ses rouges.
 *
 * Les reponses sont donc servies depuis qa/fixtures/geo-api.json, capture
 * reelle du 17 aout 2026. La logique de classification reste integralement
 * testee — c'est elle qui nous interesse — mais elle l'est sur une entree
 * constante.
 *
 * Ce qui est conserve de la vraie API, parce que la page s'en sert :
 *  - les homonymes (Vitreux pour « Vitré », Rennes-le-Château pour « Rennes »),
 *    qui font travailler pickBestFeature ;
 *  - codeDepartement, sur lequel repose l'exclusion hors Ille-et-Vilaine ;
 *  - les coordonnees exactes des mairies, dont depend le calcul de distance,
 *    donc le classement en zone incluse, sur devis ou hors zone.
 *
 * Ce qui est synthetise : les contours. Ils pesent 53 Ko pour la seule ville
 * de Rennes, et classifyFeature ne les lit jamais — ils ne servent qu'au
 * trace Leaflet, lui-meme exclu de l'empreinte. Un carre autour de la mairie
 * suffit a ce que la carte ait quelque chose a dessiner.
 *
 * Pour rafraichir la capture, rejouer les requetes de la fonction ci-dessous
 * contre la vraie API et remplacer le fichier.
 */
const FIXTURE_GEO = join(RACINE, 'qa', 'fixtures', 'geo-api.json');

/** Meme normalisation que celle de carte.html : minuscules, sans accents. */
const sansAccents = (s = '') =>
  String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Un carre de ~2 km de cote autour du point, de quoi tracer sans mentir sur la position. */
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

    // /communes/{code} : une commune precise, demandee quand la recherche par
    // nom n'a pas rendu de contour exploitable.
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
          // Ni erreur ni silence : la vraie API rendrait une liste vide, on
          // fait pareil, mais on note la requete pour que l'ajout d'une
          // commune temoin ne se traduise pas par un echec incomprehensible.
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

    // format=json rend un tableau d'objets plats, format=geojson une
    // FeatureCollection. L'autocompletion utilise le premier, la carte le second.
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

/* ─── Consentement : mesure d'audience neutralisee ───────────────────── */

/**
 * Depuis le 17 aout 2026, Google Analytics n'est plus ecrit en dur dans les
 * pages : js/consentement.js ne l'injecte qu'apres un accord du visiteur.
 * Deux precautions en decoulent pour la QA, pour la meme raison de fond —
 * l'oracle ne doit dependre ni d'un reseau ni d'un etat de navigateur.
 *
 * 1. Un refus est ecrit dans localStorage avant toute navigation. Le bandeau
 *    ne s'affiche donc pas sur les 20 vues, et l'empreinte reste celle d'un
 *    visiteur ayant deja repondu. Sans ca, un composant flottant s'ajoutait a
 *    chaque page et masquait des liens dans les parcours.
 * 2. Toute requete vers Google est interceptee et comptee. Une page qui
 *    appellerait la mesure malgre le refus est signalee nommement : c'est la
 *    regression qui compte ici, celle qui remet le suivi en marche sans
 *    consentement, et elle ne se voit sur aucun pixel.
 *
 * Le bandeau lui-meme est teste a part, dans un contexte neuf ou aucun choix
 * n'est enregistre. Voir testerConsentement.
 */
const CLE_CONSENTEMENT = 'miaoucratie.consentement';
const HOTES_MESURE = ['https://www.googletagmanager.com/**', 'https://*.google-analytics.com/**'];

async function intercepterMesure(contexte, appels) {
  for (const motif of HOTES_MESURE) {
    await contexte.route(motif, async (route) => {
      appels.push(route.request().url());
      // Corps vide : gtag.js ne s'execute pas, donc aucune requete de collecte
      // derriere. L'interception se suffit a elle-meme.
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });
  }
}

async function refuserLaMesure(contexte) {
  const choix = JSON.stringify({ valeur: 'refuse', version: 1, date: new Date().toISOString() });
  await contexte.addInitScript(([cle, valeur]) => {
    // about:blank a une origine opaque : localStorage y jette. Sans effet.
    try { window.localStorage.setItem(cle, valeur); } catch (e) { /* stockage indisponible */ }
  }, [CLE_CONSENTEMENT, choix]);
}

/* ─── 1. Empreinte visuelle ──────────────────────────────────────────── */

/**
 * Vérifie que les polices sont réellement utilisables avant toute mesure.
 * Renvoie la liste des familles déclarées mais indisponibles.
 *
 * Depuis que le site sert ses propres polices, ce contrôle ne devrait plus
 * jamais échouer : il protège d'un chemin cassé dans `css/polices.css`. Ce qui
 * suit vaut pour l'histoire, et pour le jour où l'on serait tenté de revenir à
 * un fournisseur extérieur.
 *
 * Trois attentes successives se sont révélées insuffisantes, et l'ordre dans
 * lequel elles tombent explique le reste :
 *
 * 1. « networkidle » — le navigateur peut avoir fini ses requêtes sans avoir
 *    composé les glyphes.
 * 2. `document.fonts.ready` — il ne résout que les chargements *déjà
 *    engagés* ; une face demandée tardivement lui échappe.
 * 3. Forcer `load()` sur chaque face déclarée — inopérant quand la requête
 *    elle-même échoue : les polices viennent de fonts.gstatic.com, et ce
 *    trajet réseau casse par intermittence.
 *
 * Mesurée dans cet état, la page rend les métriques de la police de secours :
 * la barre de navigation passe de 566 à 540 px et toutes les pages s'écartent
 * en bloc — jusqu'à 503 différences sur la FAQ, pour un CSS pourtant
 * inchangé. Constaté environ une fois sur sept.
 *
 * Recharger ne rattrape pas : mesuré sur les cas observés, quatre tentatives
 * successives échouent toutes. La panne colle au processus du navigateur, ce
 * qui explique aussi pourquoi les neuf pages s'écartent d'un seul coup — la
 * QA partage un contexte entre elles.
 *
 * Un oracle qui échoue au hasard est pire que pas d'oracle : il fait douter
 * de changements corrects, et il finit par se faire ignorer. Faute de pouvoir
 * garantir la police, on refuse de mesurer sans elle : la vue n'est pas
 * comparée, et le manque est signalé pour ce qu'il est au lieu d'être
 * maquillé en régression visuelle. Le remède de fond serait d'héberger les
 * deux familles avec le site, ce qui supprimerait la dépendance réseau.
 */
const FAMILLES = ['DM Sans', 'Cormorant Garamond'];

async function attendrePolices(page) {
  return page.evaluate(async (familles) => {
    await document.fonts.ready;
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
    await document.fonts.ready;
    // Une famille absente de la page n'a pas à être exigée : seules comptent
    // celles que la page déclare vraiment.
    const declarees = new Set([...document.fonts].map((f) => f.family.replace(/^['"]|['"]$/g, '')));
    return familles
      .filter((f) => declarees.has(f))
      .filter((f) => !document.fonts.check(`400 16px "${f}"`));
  }, FAMILLES);
}

async function empreinte(page) {
  return page.evaluate(() => {
    // em porte la couleur d'accent de la marque, dans les titres de chaque
    // page et dans le logo du pied. label et blockquote portent le style des
    // formulaires et du carrousel d'avis. Aucun n'etait releve : une couleur
    // pouvait y changer sans que rien ne le signale.
    const sel = 'h1,h2,h3,h4,p,a,button,img,li,strong,em,span,div,label,blockquote,input,select,textarea';
    return [...document.querySelectorAll(sel)]
      // Leaflet se rend de facon asynchrone : ses elements produisent
      // des ecarts reproductibles mais sans signification.
      .filter((e) => !String(e.className || '').includes('leaflet'))
      // Le calendrier depend de la date du jour : la case « aujourd'hui »
      // se deplace et les jours passes deviennent desactives. Sans cette
      // exclusion, la reference perimerait chaque nuit.
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
          // Interlignage et interlettrage : ils ne deplacent rien par
          // eux-memes mais changent la hauteur et la largeur du texte. Sans
          // eux, une regression d'interlignage n'apparaissait qu'en ricochet,
          // sous la forme de centaines de decalages sans cause lisible.
          c.lineHeight, c.letterSpacing,
        ].join('|');
      });
  });
}

/**
 * Compare deux relevés d'élément.
 *
 * Les moteurs de rendu n'arrondissent pas les métriques de police de la même
 * façon selon le système : la même page mesurée sous Windows et sous Linux
 * donne 53x43 ici et 52x42 là, une marge de 551.562px devient 551px. Sans
 * tolérance, la référence générée sur un poste ne vaut rien sur un autre, et
 * la CI échoue sur du bruit.
 *
 * La tolérance ne s'applique qu'aux champs géométriques. Couleurs, polices,
 * display, visibilité et alignement restent comparés au caractère près : une
 * régression de style s'y voit toujours, et un décalage réel de mise en page
 * dépasse toujours largement deux pixels.
 */
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

    // Le squelette non numérique doit être identique : « 4px 8px » et
    // « 4px » ne sont pas comparables, quelles que soient les valeurs.
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
    /* La comparaison porte sur le texte, pas sur la nature des espaces :
           le texte affiche pose une espace insecable avant « ? », le JSON-LD
           une espace ordinaire. C'est la meme question pour un lecteur comme
           pour Google, et les comparer octet a octet faisait tomber les
           trente-sept d'un coup. */
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

/**
 * Le calculateur, du clic au montant affiche.
 *
 * Deux choses a prouver, et la seconde est la vraie raison de ce test.
 *
 * 1. Les commandes repondent. Le script de la page est passe en module pour
 *    importer shared/tarifs.js, ce qui a fait disparaitre les fonctions
 *    globales qu'appelaient les onclick du balisage. Une regression ici ne
 *    leve aucune erreur : les boutons ne font simplement plus rien.
 * 2. Le montant affiche est celui que calcule shared/tarifs.js. Un tarif faux
 *    ne deplace aucun pixel — l'empreinte visuelle le verrait passer.
 */
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

  // Tarif de base, remise sejour long, remise solidaire, supplement km.
  if (vu.lignes !== 4) {
    echecs.push(`calculateur : ${vu.lignes} ligne(s) de detail, attendu 4 `
      + '(base, remise sejour long, remise solidaire, supplement kilometrique)');
  }
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

/**
 * Le nombre d'avis est ecrit en dur a cinq endroits sur trois pages, plus le
 * nombre de cartes du carrousel qui doit s'y accorder. En oublier un ne casse
 * rien de visible : chaque page reste coherente avec elle-meme, et l'empreinte
 * ne lit pas les chiffres.
 *
 * On releve donc les compteurs sous leurs trois formes, et main() exige une
 * valeur unique sur tout le site.
 */
async function relevesCompteurAvis(page) {
  return page.evaluate(() => {
    const releves = [];
    // Le chiffre affiche se lit dans le texte rendu, pas dans le balisage :
    // les quatre mentions ont quatre formulations et quatre habillages
    // differents, et une cinquieme page demain en aurait une autre.
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

/**
 * Le bandeau de consentement, dans un contexte neuf : aucun choix enregistre,
 * donc exactement ce que rencontre un visiteur a sa premiere visite.
 *
 * Quatre proprietes, et chacune se casserait en silence :
 *  - rien ne part chez Google avant un accord. C'est la raison d'etre du
 *    bandeau, et c'est invisible a l'oeil ;
 *  - refuser demande le meme geste qu'accepter — memes dimensions, meme
 *    taille de texte. Un bouton de refus rapetisse serait un dark pattern ;
 *  - le choix survit au rechargement. Un bandeau qui revient a chaque page
 *    est une panne, pas un detail d'affichage ;
 *  - le bandeau ne fait pas deborder la page. Il est en position fixe, donc
 *    l'empreinte des autres vues ne l'attraperait pas.
 */
async function testerConsentement(navigateur, base, largeur, echecs) {
  const prefixe = `consentement @${largeur}px`;

  for (const scenario of ['refuse', 'accepte']) {
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 } });
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

/**
 * Divergences volontaires entre pages, avec leur raison. Toute autre
 * divergence est signalee. Cette liste doit rester tres courte : chaque
 * entree est une exception a la regle « le site se ressemble partout ».
 */
const DIVERGENCES_ADMISES = new Map([
  ['barre.position', {
    pages: ['reservation.html', 'admin-indisponibilites.html'],
    raison: 'La barre n\'est pas collante dans le tunnel de reservation. Elle '
      + 'prendrait 50px de haut sur un formulaire long, et toute la page est '
      + 'empilee sous elle : calendrier a 90, listes de suggestion a 40 et 50. '
      + 'La rendre collante demanderait de relever ces quatre couches. Choix '
      + 'de conversion autant que technique, a rediscuter si besoin.',
  }],
]);

/**
 * Verifie des regles d'harmonie que le site doit toujours respecter.
 *
 * L'empreinte visuelle compare a une reference : elle detecte un changement,
 * jamais un defaut deja present. Les trois defauts trouves a l'oeil le 16
 * aout 2026 — champs de hauteurs differentes sur la reservation, cartes de
 * largeurs differentes sur la carte, accent invisible sur la FAQ — etaient
 * tous dans la reference, donc verts. Ces controles-ci n'ont pas de
 * reference : ils posent une regle et la verifient.
 *
 * Renvoie aussi la signature de la barre et du pied, comparee ensuite d'une
 * page a l'autre : ces deux blocs doivent etre rigoureusement identiques
 * partout.
 */
async function relevesCoherence(page) {
  return page.evaluate(() => {
    const defauts = [];
    const arrondi = (n) => Math.round(n);
    const visible = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';

    // 1. Deux champs de formulaire cote a cote demarrent a la meme hauteur et
    //    ont la meme taille. C'est ce qui manquait sur la reservation.
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
      // Une zone de texte est plus haute par nature : on ne la compare pas.
      const simples = groupe.filter((g) => g.balise !== 'textarea');
      if (simples.length < 2) continue;
      const hauts = new Set(simples.map((g) => g.haut));
      const hauteurs = new Set(simples.map((g) => g.hauteur));
      if (hauts.size > 1) defauts.push(`champs desalignes : ${simples.map((g) => `${g.nom} commence a ${g.haut}px`).join(', ')}`);
      if (hauteurs.size > 1) defauts.push(`champs de hauteurs differentes : ${simples.map((g) => `${g.nom} fait ${g.hauteur}px`).join(', ')}`);
    }

    // 2. Des cartes soeurs, empilees dans la meme colonne, ont la meme
    //    largeur. C'est ce qui manquait sur la carte.
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

    // 3. Signature de la barre et du pied, propriete par propriete, pour
    //    comparaison d'une page a l'autre.
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

    // 4. La navigation est recopiee dans chaque page : neuf exemplaires du
    //    menu, de la barre et du pied. Les mentions legales avaient ainsi
    //    diverge en cinq versions, dont deux avaient perdu le bureau
    //    d'enregistrement du domaine. Tant que le balisage reste duplique,
    //    c'est ce controle qui empeche l'histoire de se repeter.
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

/* ─── 3 bis. Taux metier annonces ────────────────────────────────────── */

/**
 * Verifie que les taux metier annonces par le texte des pages sont bien ceux
 * de shared/tarifs.js.
 *
 * « 0,70 €/km » etait recopie a sept endroits sur trois pages, « acompte de
 * 30 % » sur cinq pages, et rien ne verifiait qu'ils disaient la meme chose.
 * Aucune divergence n'avait eu lieu — c'est justement le moment d'installer
 * le controle. Le risque n'est pas la faute de frappe : c'est la hausse
 * appliquee a six endroits sur sept, apres laquelle le site annonce deux
 * tarifs selon la page ouverte.
 *
 * On releve `textContent` et non `innerText` : les reponses repliees de la FAQ
 * doivent etre lues elles aussi. Cela embarque le source des scripts inline,
 * et c'est voulu — sur la carte, deux des trois mentions du tarif
 * kilometrique sont construites en JavaScript, donc invisibles au repos.
 */
function relevesTauxMetier(page) {
  return page.evaluate(() => {
    const morceaux = [document.body?.textContent || ''];
    for (const bloc of document.querySelectorAll('script[type="application/ld+json"]')) {
      morceaux.push(bloc.textContent || '');
    }
    // Espaces insecables et fines : « 30&nbsp;% » doit se lire comme « 30 % ».
    return morceaux.join('\n').replace(/[  ]/g, ' ');
  });
}

/** Les deux taux repetes dans le texte du site, et comment les y reconnaitre. */
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

/**
 * Suit un visiteur d'un bout a l'autre, en cliquant pour de vrai.
 *
 * Les controles de comportement testent chaque page isolement : le menu ici,
 * l'accordeon la, la carte ailleurs. Aucun ne verifiait le chemin qui fait
 * vivre l'entreprise — arriver, se renseigner, aboutir au formulaire.
 *
 * On clique volontairement les appels a l'action du contenu, jamais ceux du
 * menu : le menu est deja teste, et ce n'est pas lui qui convertit. Une page
 * sans lien vers la reservation en dehors de sa navigation est signalee.
 */
const PARCOURS = [
  {
    nom: 'accueil → carte → reservation',
    etapes: ['index.html', 'carte.html', 'reservation.html'],
    // Sur la carte, rien ne mene a la reservation tant que le visiteur n'a pas
    // verifie sa commune : l'appel a l'action n'apparait qu'apres la recherche.
    // C'est le parcours reel, le test le suit.
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

/** Ce qui prouve qu'on est bien arrive, et que la page a repris la main. */
const REPERE = {
  'index.html': '.hero-title',
  'carte.html': '#searchInput',
  'tarifs.html': '.t-price-header, .tarifs-hero h1',
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
        // Un lien du contenu, ni dans la barre ni dans le menu deroulant.
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

        if (!page.url().endsWith(cible)) {
          echecs.push(`parcours ${nom} : le lien vers ${cible} a mene a ${page.url().split('/').pop()}`);
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
  const serveur = await demarrerServeur();
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const navigateur = await chromium.launch();
  const echecs = [];
  const empreintes = {};
  // Signature de la barre et du pied par page : ces blocs doivent etre
  // identiques partout. Plusieurs signatures pour un meme bloc = divergence.
  const signatures = new Map();
  // Le nombre d'avis, par valeur relevee : ou on l'a lu, et combien il vaut.
  // Plusieurs valeurs = un emplacement a ete oublie. Voir relevesCompteurAvis.
  const compteursAvis = new Map();
  // Communes demandees a l'API adresse mais absentes de la capture figee.
  // Sans ce relevé, ajouter une commune temoin a testerCarte donnerait un
  // echec de classification sans cause lisible.
  const requetesGeoInconnues = new Set();

  try {
    for (const largeur of LARGEURS) {
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 } });
      // Avant toute navigation : la carte interroge l'API des la premiere
      // seconde, pour poser le marqueur de Domagne.
      await figerApiAdresse(contexte, requetesGeoInconnues);
      // Le consentement est refuse d'entree : pas de bandeau dans l'empreinte,
      // et tout appel a Google devient un echec attribuable a une page.
      await refuserLaMesure(contexte);
      const appelsMesure = [];
      await intercepterMesure(contexte, appelsMesure);
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

        // Les taux ne dependent pas de la largeur : une seule lecture suffit.
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
          // Un compteur efface ne fait diverger personne : il disparait, et la
          // comparaison des valeurs reste verte. L'accueil est la seule page a
          // porter les trois formes, il sert donc de garde-fou a leur presence.
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
        await page.close();
      }
      // Le bandeau se teste aux deux largeurs : il change de forme en mobile,
      // et c'est la qu'il risquerait de deborder.
      await testerConsentement(navigateur, base, largeur, echecs);
      // Les parcours se suivent une fois, en desktop : ils testent des liens,
      // pas une mise en page.
      if (largeur === LARGEURS[0]) await testerParcours(contexte, base, echecs);
      await contexte.close();
    }

    // Barre et pied de page : une seule valeur attendue par propriete, sur
    // toutes les pages. C'est ce controle qui aurait signale les deux
    // incoherences du 16 aout — une barre a 20px sur cinq pages et 24 sur
    // trois, une mention legale illisible sur deux pages seulement.
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

    // Le nombre d'avis : une seule valeur attendue sur tout le site. La liste
    // nomme l'emplacement de chaque valeur, donc directement ce qu'il reste a
    // corriger. Voir relevesCompteurAvis.
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
      // Une vue dont la police a manqué n'a pas été relevée. L'écrire quand
      // même amputerait la référence des vues concernées, et le manque se
      // lirait ensuite comme « absent de la reference » sur toutes les
      // exécutions suivantes.
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
  }

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

// Ne s'exécute que lancé directement : le fichier reste importable pour
// tester ses fonctions sans déclencher toute la campagne.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main();
}
