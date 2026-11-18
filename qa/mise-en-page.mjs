/* Contrôle de mise en page */

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const DEMANDEES = process.argv.slice(2).filter((a) => a.endsWith('.html'));

/* Pages exclues */
const EXCLUES = new Set(['administration.html']);

/* Largeurs de contrôle */
const LARGEURS = [1280, 1024, 900, 768, 600, 480, 375, 320];

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

/* ══ Relevé dans la page ══ */
const RELEVE = async () => {
  const d = document, D = d.documentElement;

  const nom = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '');

  /* Lignes rendues */
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

  /* ── Contraste ── */
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const rgba = (s) => { const m = (s.match(/[\d.]+/g) || []).map(Number); return m.length === 3 ? [...m, 1] : m; };
  /* Fond composé */
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

  /* 1. Débordement horizontal */
  if (D.scrollWidth > D.clientWidth + 1) {
    const coupables = [...d.querySelectorAll('body *')]
      .filter((e) => visible(e) && e.getBoundingClientRect().right > D.clientWidth + 1)
      .map(nom).slice(0, 5);
    ajouter('debordement', `${D.scrollWidth}px pour ${D.clientWidth}px : ${coupables.join(', ') || 'origine non isolee'}`);
  }

  /* 2. Dernière ligne d'un seul mot */
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

  /* 4. Contraste */
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

  /* 4 bis. Italique gras, lien bleu */
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
    const normal = (s) => s.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const al = a.getAttribute('aria-label'), tv = a.textContent.trim();
    if (al && tv && !normal(al).includes(normal(tv))) ajouter('etiquette dans le nom', `visible « ${tv} », nom « ${al.slice(0, 60)} »`);
  }

  /* 7. Images */
  for (const i of d.querySelectorAll('img:not([alt])')) ajouter('image sans alt', i.getAttribute('src') || '');

  /* 8. Cibles tactiles */
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

  /* 9. Texte recouvert */
  const peint = (h) => {
    if (/^(IMG|SVG|CANVAS|VIDEO|IFRAME|PICTURE)$/i.test(h.tagName) || h.closest('svg')) return true;
    const s = getComputedStyle(h);
    if (s.backgroundImage !== 'none' || rgba(s.backgroundColor)[3] > 0) return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some((c) => parseFloat(s[`border${c}Width`]) > 0 && rgba(s[`border${c}Color`])[3] > 0);
  };
  const fixe = (x) => { for (let y = x; y; y = y.parentElement) { const p = getComputedStyle(y).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const textes = [...d.querySelectorAll('body *')].filter((e) => visible(e)
    && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    && !fixe(e) && !e.closest('.leaflet-container'));
  for (const e of textes) {
    const r0 = e.getBoundingClientRect();
    if (r0.width < 4 || r0.height < 4) continue;
    window.scrollTo(0, r0.top + scrollY - 120);
    const q = e.getBoundingClientRect();
    const cx = (q.left + q.right) / 2, cy = (q.top + q.bottom) / 2;
    const points = [[cx, cy], [cx, q.top + 2], [cx, q.bottom - 2], [q.left + 2, cy], [q.right - 2, cy]];
    const cadres = [];
    for (let a = e.parentElement; a && a !== d.body; a = a.parentElement) {
      const sa = getComputedStyle(a);
      if (sa.overflowX !== 'visible' || sa.overflowY !== 'visible') cadres.push(a.getBoundingClientRect());
    }
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      if (cadres.some((c) => x < c.left || x > c.right || y < c.top || y > c.bottom)) continue;
      const h = d.elementFromPoint(x, y);
      if (h && h !== e && !e.contains(h) && !h.contains(e) && !fixe(h) && peint(h)) {
        ajouter('texte recouvert', `${nom(e)} « ${e.textContent.trim().slice(0, 34)} » sous ${nom(h)}`);
        break;
      }
    }
  }
  window.scrollTo(0, 0);

  /* 10. Texte coupé */
  for (const e of textes) {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (let a = e.parentElement; a && a !== d.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/auto|scroll/.test(s.overflowX + s.overflowY)) break;
      const cx = /hidden|clip/.test(s.overflowX), cy = /hidden|clip/.test(s.overflowY);
      if (!cx && !cy) continue;
      const b = a.getBoundingClientRect();
      if (b.width <= 2 || b.height <= 2) break;
      if ((cx && (r.left < b.left - 1 || r.right > b.right + 1)) || (cy && (r.top < b.top - 1 || r.bottom > b.bottom + 1))) {
        ajouter('texte coupé', `${nom(e)} « ${e.textContent.trim().slice(0, 34)} » par ${nom(a)}`);
      }
      break;
    }
  }

  /* 11. Défilement sans indice */
  for (const e of d.querySelectorAll('body *')) {
    if (!visible(e)) continue;
    const s = getComputedStyle(e);
    if (!/auto|scroll/.test(s.overflowX) || s.scrollbarWidth !== 'none' || e.scrollWidth <= e.clientWidth + 1) continue;
    const fleches = e.parentElement && [...e.parentElement.querySelectorAll(':scope > button')].some(visible);
    if (!fleches) ajouter('défilement figé', `${nom(e)} : contenu caché sur le côté, sans flèche pour le faire défiler`);
  }

  /* 12. Cadres d'une même colonne */
  /* Exceptions */
  const sansCadres = /calculateur-miaoucratie/.test(location.pathname);
  const cadre = (x) => {
    if (!x || !visible(x)) return null;
    const st = getComputedStyle(x);
    const bord = ['Top', 'Right', 'Bottom', 'Left'].some((c) => parseFloat(st[`border${c}Width`]) > 0 && rgba(st[`border${c}Color`])[3] > 0);
    return rgba(st.backgroundColor)[3] > 0 || st.backgroundImage !== 'none' || bord ? x : null;
  };
  for (const p of sansCadres ? [] : d.querySelectorAll('body *')) {
    if (!visible(p) || p.closest('.leaflet-container')) continue;
    const ps = getComputedStyle(p);
    if (ps.display !== 'block' && !(ps.display.includes('flex') && ps.flexDirection.startsWith('column')) && !(ps.display.includes('grid') && ps.gridTemplateColumns.split(' ').length === 1)) continue;
    const largeur = p.clientWidth;
    if (largeur < innerWidth * 0.5) continue;
    const cadres = [...p.children].map((c) => cadre(c) || (c.children.length === 1 ? cadre(c.children[0]) : null)).filter(Boolean)
      .filter((c) => !c.matches('.hero-photo-frame') && !fixe(c) && getComputedStyle(c).position !== 'absolute' && /^(block|flex|grid|flow-root|list-item)$/.test(getComputedStyle(c).display))
      .map((c) => ({ c, r: c.getBoundingClientRect() })).filter(({ r }) => r.width >= largeur * 0.9 && r.height >= 24);
    for (let i = 1; i < cadres.length; i++) {
      const a = cadres[i - 1].r, b = cadres[i].r;
      if (b.top < a.bottom - 1) continue;
      if (Math.abs(a.left - b.left) > 1 || Math.abs(a.right - b.right) > 1) {
        ajouter('cadres non alignés', `${nom(cadres[i - 1].c)} [${Math.round(a.left)}–${Math.round(a.right)}] et ${nom(cadres[i].c)} [${Math.round(b.left)}–${Math.round(b.right)}]`);
      }
    }
  }

  /* 13. Fin de page */
  {
    window.scrollTo({ top: D.scrollHeight, behavior: 'instant' });
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const pied = [...d.querySelectorAll('footer')].filter(visible).pop();
    if (pied) {
      const f = pied.getBoundingClientRect();
      const sous = Math.round(D.scrollHeight - (f.bottom + scrollY));
      if (sous > 1) ajouter('fin de page', `${sous} px sous le pied de page`);
      for (const x of d.querySelectorAll('body *')) {
        if (!visible(x) || x.closest('.consentement') || getComputedStyle(x).position !== 'fixed') continue;
        const r = x.getBoundingClientRect();
        if (r.width && r.height && r.top < f.bottom - 1 && r.bottom > f.top + 1 && r.left < f.right && r.right > f.left) {
          ajouter('fin de page', `${nom(x)} recouvre le pied de page`);
        }
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return echecs;
};

/* ══ Passe statique du balisage ══ */
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
    const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, reducedMotion: 'reduce' });
    const page = await contexte.newPage();

    await page.goto(`${base}/${fichier}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await page.addStyleTag({ content: '* { pointer-events: auto !important; }' });
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
