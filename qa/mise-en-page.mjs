/**
 * Controle de mise en page rendue.
 *
 *   node qa/mise-en-page.mjs             toutes les pages, toutes les largeurs
 *   node qa/mise-en-page.mjs coulisses-miaoucratie.html   une page
 *   node qa/mise-en-page.mjs --strict    sort en erreur s'il reste un echec
 *
 * Pourquoi ce fichier : qa.mjs compare des empreintes a une reference, ce qui
 * detecte un CHANGEMENT mais pas un DEFAUT — une page peut etre stable et mal
 * fichue. Les constats releves ici sont ceux qu'on trouvait jusqu'a present a
 * l'oeil : debordement, ligne orpheline, bouton casse en deux, contraste sous
 * le seuil, cible trop petite, saut de niveau de titre, ancre morte.
 *
 * Tout est mesure sur la page RENDUE, polices chargees. Mesurer avant que les
 * polices soient appliquees donne les metriques de la police de secours, et
 * deux releves successifs ne rendent alors pas le meme chiffre.
 */

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html'));

/* Pages hors perimetre : outils internes ou pages a formulaire, deja couvertes
   par qa.mjs et dont la mise en page ne depend pas de ce chantier. */
const EXCLUES = new Set(['admin-indisponibilites.html']);
/* Les fichiers « maquette-*.html » sont ecartes a la lecture du dossier plus
   bas : ce sont des pages de travail, ignorees par Git, jamais publiees. */

/* Largeurs de controle. 320 est le minimum exige par le critere 1.4.10 ;
   375 est l'iPhone courant ; 768 la bascule des media queries ; 1280 le
   bureau de reference. */
const LARGEURS = [1280, 768, 375, 320];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function demarrerServeur() {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0]);
    const fichier = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
    if (!fichier.startsWith(RACINE) || !existsSync(fichier)) return res.writeHead(404).end('introuvable');
    try {
      res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] ?? 'application/octet-stream' });
      res.end(await readFile(fichier));
    } catch {
      res.writeHead(500).end('erreur');
    }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(serveur)));
}

/* ══ Le releve, execute dans la page ══════════════════════════════════════ */
const RELEVE = () => {
  const d = document, D = d.documentElement;

  const nom = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '');

  /* Lignes reellement rendues d'un element, groupees par ordonnee. */
  const lignes = (el) => {
    const R = d.createRange(), par = new Map();
    const w = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      for (let i = 0; i < n.nodeValue.length; i++) {
        R.setStart(n, i); R.setEnd(n, i + 1);
        const b = R.getBoundingClientRect();
        if (!b.height) continue;
        const cle = Math.round(b.top);
        par.set(cle, (par.get(cle) || '') + n.nodeValue[i]);
      }
    }
    return [...par.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1].trim()).filter(Boolean);
  };

  const visible = (e) => {
    for (let x = e; x; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    }
    return true;
  };

  /* ── Contraste, avec composition des fonds translucides ── */
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const rgba = (s) => { const m = (s.match(/[\d.]+/g) || []).map(Number); return m.length === 3 ? [...m, 1] : m; };
  /* Rend le fond compose, ou null si une image de fond intervient : un
     degrade ou une photo ne se ramene pas a une couleur unique, et publier
     un chiffre calcule sur la couleur de fond « transparente » qui reste
     donnerait un faux constat — le bouton d'envoi de la reservation, blanc
     sur un degrade rouille, ressortait ainsi a 1,07:1 alors qu'il est a
     5,83:1. Ces cas sont comptes a part, pas mesures. */
  const fond = (e) => {
    const pile = [];
    for (let x = e; x; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) { pile.push(c); if (c[3] === 1) break; }
    }
    let base = [255, 255, 255];
    for (let i = pile.length - 1; i >= 0; i--) {
      const [r, g, b, a] = pile[i];
      base = [0, 1, 2].map((k) => Math.round(base[k] * (1 - a) + [r, g, b][k] * a));
    }
    return base;
  };

  const echecs = [];
  const ajouter = (genre, detail) => echecs.push({ genre, detail });

  /* 1. Debordement horizontal (1.4.10) */
  if (D.scrollWidth > D.clientWidth + 1) {
    const coupables = [...d.querySelectorAll('body *')]
      .filter((e) => visible(e) && e.getBoundingClientRect().right > D.clientWidth + 1)
      .map(nom).slice(0, 5);
    ajouter('debordement', `${D.scrollWidth}px pour ${D.clientWidth}px : ${coupables.join(', ') || 'origine non isolee'}`);
  }

  /* 2. Derniere ligne d'un seul mot.
        Mesure « text-wrap » neutralise. Le moteur plafonne le temps qu'il
        consacre a « balance » et « pretty » : au-dela d'un certain nombre de
        lignes il renonce, et le seuil bouge d'un chargement a l'autre — deux
        passes identiques rendaient 27 puis 18 constats, et l'intersection de
        deux passes restait instable. Sans ces proprietes, le decoupage est
        deterministe. On mesure donc le pire cas : les blocs qui finiraient
        sur un mot seul si le navigateur n'aidait pas. C'est un avertissement,
        pas un echec — la regle du site les rattrape la plupart du temps. */
  const neutre = d.createElement('style');
  neutre.textContent = '*{text-wrap:wrap !important}';
  d.head.appendChild(neutre);
  d.documentElement.getBoundingClientRect();
  for (const el of d.querySelectorAll('h1, h2, h3, p, figcaption, caption, summary, li')) {
    if (!visible(el) || el.querySelector('p, li, h1, h2, h3')) continue;
    const L = lignes(el);
    if (L.length < 2) continue;
    const der = L[L.length - 1];
    if (der.split(/\s+/).length === 1 && der.replace(/[.,;:!?»)]/g, '').length < 16) {
      echecs.push({ genre: 'orpheline', detail: `${nom(el)} « …${der} »`, avertissement: true });
    }
  }
  neutre.remove();
  d.documentElement.getBoundingClientRect();

  /* 3. Bouton sur plusieurs lignes */
  for (const a of d.querySelectorAll('a.btn-primary, a.btn-secondary, a.cta-btn-white, a.cta-btn-outline, a.faq-cta-secondary')) {
    if (visible(a) && lignes(a).length > 1) ajouter('bouton casse', `« ${a.textContent.trim()} » sur ${lignes(a).length} lignes`);
  }

  /* 4. Contraste (1.4.3).
        Les sous-arbres en aria-hidden sont ecartes : le critere exempte la
        decoration pure, et un glyphe masque aux technologies d'assistance
        double toujours une information donnee en toutes lettres a cote —
        les etoiles d'une note suivie de « 5,0 · 14 avis », par exemple. */
  const vus = new Set();
  const nonMesurables = new Set();
  for (const e of d.querySelectorAll('body *')) {
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
    if (!visible(e) || e.closest('[aria-hidden="true"]')) continue;
    const s = getComputedStyle(e);
    const bg = fond(e);
    if (!bg) { nonMesurables.add(nom(e)); continue; }
    const fg = rgba(s.color);
    const avant = fg[3] < 1 ? [0, 1, 2].map((k) => Math.round(bg[k] * (1 - fg[3]) + fg[k] * fg[3])) : fg.slice(0, 3);
    const r = (Math.max(lum(avant), lum(bg)) + 0.05) / (Math.min(lum(avant), lum(bg)) + 0.05);
    const px = parseFloat(s.fontSize), seuil = px >= 24 || (px >= 18.66 && +s.fontWeight >= 700) ? 3 : 4.5;
    if (r >= seuil) continue;
    const cle = nom(e) + r.toFixed(2);
    if (vus.has(cle)) continue;
    vus.add(cle);
    ajouter('contraste', `${nom(e)} ${r.toFixed(2)}:1 au lieu de ${seuil} — « ${e.textContent.trim().slice(0, 30)} »`);
  }
  if (nonMesurables.size) {
    echecs.push({ genre: 'contraste non mesurable', detail: `texte sur image ou degrade, a controler a l'oeil : ${[...nonMesurables].sort().join(', ')}`, avertissement: true });
  }

  /* 4 bis. Italique gras, et lien bleu par defaut.
     Deux regles de charte, verifiees sur le texte REELLEMENT affiche : on
     descend jusqu'a l'element qui porte le texte, parce que le site place
     souvent un <span> en graisse 400 dans un titre que la couche TITLES-V5
     force a 700. Mesurer le conteneur donnerait un faux positif sur chaque
     titre de « presse.html » et de « ce-que-jutilise.html ».

     L'italique gras : aucun, sauf le <em> du logo, qui est la marque.
     « .cgv-brand » porte la meme marque « Miaoucratie. » en tete des pages
     legales, dans le meme traitement que le pied de page — italique sur la
     seconde moitie du mot. Elle manquait a la liste, et les deux pages
     legales tombaient sur une regle qui ne les visait pas.
     Le lien bleu : aucun. Un <a> sans regle de couleur retombe sur le bleu du
     navigateur, et c'est ainsi qu'il revient a chaque fois. */
  {
    const marcheur = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    const portes = new Set();
    for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement;
      if (!e || portes.has(e) || !visible(e)) continue;
      portes.add(e);
      const s = getComputedStyle(e);
      if (s.fontStyle === 'italic' && parseInt(s.fontWeight, 10) >= 600
          && !e.closest('.footer-logo, .logo-name, .logo, .brand, .cgv-brand')) {
        ajouter('italique gras', `${nom(e)} « ${e.textContent.trim().slice(0, 34)} » poids ${s.fontWeight}`);
      }
      if (e.closest('a') && !e.closest('.leaflet-container')) {
        const c = (s.color.match(/\d+/g) || []).map(Number);
        if (c.length >= 3 && c[2] > c[0] + 40 && c[2] > 120) {
          ajouter('lien bleu', `${nom(e)} « ${e.textContent.trim().slice(0, 34)} » ${s.color}`);
        }
      }
    }
  }

  /* 5. Hierarchie des titres */
  const niveaux = [...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => +h.tagName[1]);
  const nbH1 = d.querySelectorAll('h1').length;
  if (nbH1 !== 1) ajouter('titres', `${nbH1} h1 au lieu de 1`);
  niveaux.forEach((n, i) => { if (i && n > niveaux[i - 1] + 1) ajouter('titres', `saut h${niveaux[i - 1]} vers h${n}`); });
  for (const h of d.querySelectorAll('h1,h2,h3,h4,h5,h6')) if (!h.textContent.trim()) ajouter('titres', `${h.tagName} vide`);

  /* 6. Liens */
  for (const a of d.querySelectorAll('a[href^="#"]')) {
    const h = a.getAttribute('href');
    if (h !== '#' && !d.querySelector(h)) ajouter('ancre morte', h);
  }
  for (const a of d.querySelectorAll('a')) {
    if (!visible(a)) continue;
    if (!a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) ajouter('lien sans nom', a.getAttribute('href') || '(sans href)');
    /* 2.5.3 : le nom accessible doit contenir le texte visible.
       Les espaces insecables du texte visible sont ramenees a des espaces
       ordinaires avant comparaison : un lecteur d'ecran ne fait pas la
       difference, et l'exiger produirait des constats sans objet. */
    const normal = (s) => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const al = a.getAttribute('aria-label'), tv = a.textContent.trim();
    if (al && tv && !normal(al).includes(normal(tv))) ajouter('etiquette dans le nom', `visible « ${tv} », nom « ${al.slice(0, 60)} »`);
  }

  /* 7. Images */
  for (const i of d.querySelectorAll('img:not([alt])')) ajouter('image sans alt', i.getAttribute('src') || '');

  /* 8. Cibles tactiles (2.5.8).
        Deux exceptions du critere sont appliquees telles qu'il les enonce :
        la barre du haut et le pied sont des zones de navigation dense qui
        relevent de l'exception d'espacement, et un lien pose DANS une phrase
        est exempte — sa hauteur est contrainte par l'interligne du texte qui
        l'entoure, pas par un choix de dimension. */
  /* Un lien est « dans une phrase » des lors que le bloc de texte qui le
     contient porte autre chose que lui. On remonte jusqu'au bloc, et pas
     seulement au parent immediat : un lien enveloppe dans un <span> reste
     un lien de texte, et sa hauteur est celle de l'interligne du paragraphe,
     pas une dimension choisie. */
  const dansUnePhrase = (a) => {
    if (getComputedStyle(a).display !== 'inline') return false;
    let bloc = a.parentElement;
    while (bloc && getComputedStyle(bloc).display === 'inline') bloc = bloc.parentElement;
    if (!bloc) return false;
    return bloc.textContent.trim().length > a.textContent.trim().length + 1;
  };
  for (const e of d.querySelectorAll('main a, main button, article a, section a')) {
    if (!visible(e) || e.closest('.topbar, .footer-bar')) continue;
    if (e.tagName === 'A' && dansUnePhrase(e)) continue;
    const b = e.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (b.height < 24 || b.width < 24) ajouter('cible trop petite', `« ${e.textContent.trim().slice(0, 26)} » ${Math.round(b.width)}×${Math.round(b.height)}`);
  }

  return echecs;
};

/* ══ Passe statique : le balisage est-il bien forme ? ═════════════════════
   Le navigateur repare tout : une balise fermante en trop, une ouvrante
   manquante, il les rattrape et sert une page qui a l'air correcte. La
   verification doit donc se faire sur le fichier, avant tout rendu.

   Ce controle vient d'un incident reel : un script de nettoyage a supprime
   une ligne « <link …><style> », la feuille suivante s'est retrouvee sans
   ouverture, et son contenu s'affichait en clair tout en haut de la page
   d'accueil. Le rendu ne signalait rien, le DOM non plus. */
const AUTOFERMANTES = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'use', 'stop']);
const UNIQUES = ['main', 'h1'];

function verifierBalisage(html) {
  const anomalies = [];
  for (const b of ['style', 'script']) {
    const o = (html.match(new RegExp(`<${b}[\\s>]`, 'gi')) || []).length;
    const c = (html.match(new RegExp(`</${b}>`, 'gi')) || []).length;
    if (o !== c) anomalies.push(`<${b}> : ${o} ouverture(s) pour ${c} fermeture(s)`);
  }
  const propre = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const pile = [];
  for (const m of propre.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, fermante, brut, , autoferme] = m;
    const bal = brut.toLowerCase();
    if (bal === '!doctype' || AUTOFERMANTES.has(bal) || autoferme === '/') continue;
    if (!fermante) { pile.push(bal); continue; }
    if (!pile.length) { anomalies.push(`</${bal}> sans ouverture`); continue; }
    if (pile[pile.length - 1] === bal) { pile.pop(); continue; }
    const i = pile.lastIndexOf(bal);
    if (i < 0) anomalies.push(`</${bal}> surnumeraire, la pile attendait </${pile[pile.length - 1]}>`);
    else anomalies.push(`</${bal}> ferme trop tot : ${pile.splice(i).slice(1).join(', ')} restaient ouvertes`);
  }
  for (const r of pile) anomalies.push(`<${r}> jamais fermee`);
  for (const b of UNIQUES) {
    const n = (propre.match(new RegExp(`<${b}[\\s>]`, 'g')) || []).length;
    if (n !== 1) anomalies.push(`${n} <${b}> au lieu d'un seul`);
  }
  for (const b of ['header', 'nav', 'footer']) {
    if (!new RegExp(`<${b}[\\s>]`).test(propre)) anomalies.push(`aucun repere <${b}>`);
  }
  return anomalies;
}

/* ══ Execution ════════════════════════════════════════════════════════════ */
const serveur = await demarrerServeur();
const base = `http://127.0.0.1:${serveur.address().port}`;
const navigateur = await chromium.launch();

const pages = DEMANDEES.length
  ? DEMANDEES
  : (await readdir(RACINE)).filter((f) => f.endsWith('.html') && !f.startsWith('maquette-') && !EXCLUES.has(f)).sort();

let total = 0;
const parPage = new Map();

for (const fichier of pages) {
  for (const a of verifierBalisage(readFileSync(join(RACINE, fichier), 'utf8'))) {
    if (!parPage.has(fichier)) parPage.set(fichier, new Map());
    parPage.get(fichier).set(`✗ balisage — ${a}`, ['fichier']);
    total++;
  }
  for (const largeur of LARGEURS) {
    /* Le fondu d'entree n'est pas couvert par « prefers-reduced-motion » dans la
       feuille du site : c'est la coupure d'animations posee apres chargement,
       plus bas, qui rend la mesure deterministe. L'option ci-dessous ne couvre
       que les animations qui, elles, respectent la preference. */
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, reducedMotion: 'reduce' });
    const page = await contexte.newPage();

    await page.goto(`${base}/${fichier}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    /* « couches.css » anime tout enfant direct de body sur 0,7 s et ne prevoit
       pas « prefers-reduced-motion » : l'option du navigateur n'y peut rien. On
       coupe donc animations et transitions apres chargement, sinon la mesure
       tombe tantot avant, tantot apres le fondu, et deux passes identiques ne
       donnent pas le meme resultat. */
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const echecs = await page.evaluate(RELEVE);
    await contexte.close();
    if (!echecs.length) continue;
    if (!parPage.has(fichier)) parPage.set(fichier, new Map());
    for (const e of echecs) {
      const cle = `${e.avertissement ? '!' : '✗'} ${e.genre} — ${e.detail}`;
      const m = parPage.get(fichier);
      if (!m.has(cle)) m.set(cle, []);
      m.get(cle).push(largeur);
      total++;
    }
  }
}

await navigateur.close();
serveur.close();

console.log(`\nMise en page — ${pages.length} page(s), largeurs ${LARGEURS.join(' / ')}\n`);
if (!parPage.size) {
  console.log('  Aucun constat.\n');
} else {
  for (const [fichier, constats] of [...parPage].sort()) {
    const tries = [...constats].sort((a, b) => a[0].localeCompare(b[0]));
    console.log(`  ${fichier}`);
    for (const [texte, largeurs] of tries) {
      console.log(`    ${texte}`);
      console.log(`        a ${[...new Set(largeurs)].join(', ')} px`);
    }
    console.log('');
  }
}
let echecs = 0, avertissements = 0;
for (const m of parPage.values()) for (const cle of m.keys()) (cle.startsWith('✗') ? echecs++ : avertissements++);
console.log(`  ${echecs} echec(s), ${avertissements} avertissement(s), ${total} occurrence(s)\n`);

if (STRICT && echecs > 0) {
  console.error(`Controle de mise en page en echec : ${echecs} constat(s).`);
  process.exit(1);
}
