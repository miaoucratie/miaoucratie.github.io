/* Contrôle des feuilles de style */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classesDeBibliotheque,
  classesManipulees,
  estAccrochee,
  commentairesNonFermes,
  estTiers,
  nomsDeClasses,
  reglesCSS,
} from './css-regles.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

/* Exceptions */
const EXCEPTIONS = new Map([
  ['calculateur-miaoucratie.html', 'page appelée à disparaître'],
  ['calculateur.css', 'feuille de cette seule page'],
]);

/* !important admis */
const TITRES = 'harmonisation des titres, au-dessus du style propre à chaque page';
const AU_DESSUS = 'titre particulier, au-dessus de l\'harmonisation des titres';
const IMPORTANTS_ADMIS = new Map([
  ['couches.css', new Map([
    ['body .faq-hero .hero-title, body .cgv-title, body .hero-title', TITRES],
    ['body h1, body h2, body h3, body .hero-title, body .section-title, body .acc-question, body .cgv-title, body.calculateur-page h1', TITRES],
    ['body h2, body .section-title', TITRES],
    ['body h3', TITRES],
    ['body .stripe-item h2', TITRES],
    ['body .cred-item h3', TITRES],
    ['body .step h3', TITRES],
    ['.faq-cta .cta-title', AU_DESSUS],
    ['body.calculateur-page h1', 'page appelée à disparaître'],
    ['.topbar', 'barre du haut jamais animée'],
  ])],
  ['article.css', new Map([
    ['.art-etapes--echelle .art-etape h3', AU_DESSUS],
    ['.art-voie h3', AU_DESSUS],
  ])],
  ['pages/index.css', new Map([['.cta-section h2', AU_DESSUS]])],
  ['reservation.css', new Map([['[hidden]', 'un élément masqué reste masqué']])],
  ['pages/carte.css', new Map([
    ['.leaflet-control-zoom a', 'surcharge de la bibliothèque de carte'],
    ['@media (prefers-reduced-motion: reduce) { *,*::before,*::after', 'mouvement réduit à la demande du lecteur'],
  ])],
]);
const cleRegle = (r) => `${r.contexte ? r.contexte + ' { ' : ''}${r.selecteur.replace(/\s+/g, ' ').trim()}`;

const lister = (dossier, prefixe = '') => readdirSync(join(RACINE, dossier), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory()
    ? lister(join(dossier, e.name), `${prefixe}${e.name}/`)
    : e.name.endsWith('.css') ? [`${prefixe}${e.name}`] : []))
  .sort();

const feuilles = lister('css');
const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html')).sort();
const html = new Map(pages.map((p) => [p, readFileSync(join(RACINE, p), 'utf8')]));

/* Sources de style */
const sources = new Map();
for (const f of feuilles) if (!EXCEPTIONS.has(f)) sources.set(f, readFileSync(join(RACINE, 'css', f), 'utf8'));
let blocs = 0;
for (const [p, h] of html) {
  if (EXCEPTIONS.has(p)) continue;
  (h.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).forEach((bloc, i) => {
    sources.set(`${p} <style> ${i + 1}`, bloc.replace(/^<style[^>]*>|<\/style>$/g, ''));
    blocs++;
  });
}

const constats = [];
const noter = (f, quoi) => constats.push(`  ${f.padEnd(18)} ${quoi}`);

/* ── Intégrité, !important ── */
const regles = new Map();
for (const [f, brut] of sources) {
  const nonFermes = commentairesNonFermes(brut);
  if (nonFermes.length) {
    noter(f, `${nonFermes.length} commentaire(s) jamais ferme(s), ouvert(s) ligne(s) ${nonFermes.join(', ')}`
      + ' — tout ce qui suit est avale jusqu\'au prochain */');
  }
  const css = brut.replace(/\/\*[\s\S]*?\*\//g, '');
  let profondeur = 0, mini = 0;
  for (const c of css) {
    if (c === '{') profondeur++;
    else if (c === '}') { profondeur--; mini = Math.min(mini, profondeur); }
  }
  if (profondeur !== 0) noter(f, `accolades desequilibrees : ${profondeur > 0 ? profondeur + ' non fermee(s)' : -profondeur + ' en trop'}`);
  if (mini < 0) noter(f, 'une accolade fermante precede son ouvrante');

  regles.set(f, reglesCSS(brut));

  const admis = IMPORTANTS_ADMIS.get(f) || new Map();
  const vus = new Set();
  let bang = 0;
  for (const r of regles.get(f)) {
    const n = (r.corps.match(/!important/g) || []).length;
    if (!n) continue;
    if (admis.has(cleRegle(r))) vus.add(cleRegle(r)); else bang += n;
  }
  if (bang) noter(f, `${bang} !important hors exceptions`);
  for (const cle of admis.keys()) if (!vus.has(cle)) noter(f, `exception sans objet : ${cle}`);
}
for (const f of IMPORTANTS_ADMIS.keys()) if (!sources.has(f)) noter(f, 'exception pour une feuille absente');
for (const [p, h] of html) {
  if (EXCEPTIONS.has(p)) continue;
  const bang = [...h.matchAll(/style="([^"]*)"/g)].filter((m) => m[1].includes('!important')).length;
  if (bang) noter(p, `${bang} attribut(s) style avec !important`);
}

/* ── Trois relevés ── */
const selecteurs = (f) => regles.get(f).filter((r) => !r.arobase).map((r) => r.selecteur);

const posees = new Set();
for (const h of html.values()) {
  for (const m of h.matchAll(/class="([^"]+)"/g)) for (const c of m[1].trim().split(/\s+/)) if (c) posees.add(c);
}

const declareesPartout = new Set();
for (const f of regles.keys()) for (const s of selecteurs(f)) for (const n of nomsDeClasses(s)) declareesPartout.add(n);

const accroches = new Set();
for (const d of ['js', 'shared', 'qa']) {
  for (const j of readdirSync(join(RACINE, d)).filter((f) => /\.m?js$/.test(f) && !/\.test\.m?js$/.test(f))) {
    for (const c of classesManipulees(readFileSync(join(RACINE, d, j), 'utf8'))) accroches.add(c);
  }
}
for (const h of html.values()) {
  for (const bloc of h.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) || []) {
    for (const c of classesManipulees(bloc)) accroches.add(c);
  }
}

const seulementAvecTiers = classesDeBibliotheque([...regles.keys()].flatMap(selecteurs));

/* ── Classes déclarées non posées ── */
for (const f of regles.keys()) {
  const orphelines = new Set();
  for (const s of selecteurs(f)) {
    for (const n of nomsDeClasses(s)) {
      if (posees.has(n) || estAccrochee(n, accroches)) continue;
      if (estTiers(n) || seulementAvecTiers.has(n)) continue;
      orphelines.add(n);
    }
  }
  if (orphelines.size) noter(f, `${orphelines.size} classe(s) declaree(s) et jamais posee(s) : ${[...orphelines].sort().join(' ')}`);
}

/* ── Classes posées non déclarées ── */
for (const [p, h] of html) {
  if (EXCEPTIONS.has(p)) continue;
  const mortes = new Set();
  for (const m of h.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].trim().split(/\s+/)) {
      if (!c || declareesPartout.has(c) || estAccrochee(c, accroches) || estTiers(c)) continue;
      mortes.add(c);
    }
  }
  if (mortes.size) noter(p, `${mortes.size} classe(s) posee(s) et declaree(s) nulle part : ${[...mortes].sort().join(' ')}`);
}

/* ── Règle déclarée deux fois ── */
for (const [f, liste] of regles) {
  const vus = new Map();
  for (const r of liste) {
    if (r.arobase && !r.selecteur.startsWith('@keyframes')) continue;
    const cle = cleRegle(r);
    vus.set(cle, (vus.get(cle) || 0) + 1);
  }
  const doubles = [...vus].filter(([, n]) => n > 1);
  if (doubles.length) noter(f, `${doubles.length} regle(s) declaree(s) plusieurs fois : ${doubles.map(([s, n]) => `${s} ×${n}`).join(' · ')}`);
}

/* ── Ordre de chargement, page par page ── */
const ordres = new Map();
for (const [p, h] of html) {
  const suite = [...h.matchAll(/href="css\/([^"]+)"/g)].map((m) => m[1]);
  if (!suite.length) continue;
  const cle = suite.join(' > ');
  if (!ordres.has(cle)) ordres.set(cle, []);
  ordres.get(cle).push(p);
  if (suite.includes('couches.css') && suite[suite.length - 1] !== 'couches.css') {
    noter(p, `couches.css n'est pas chargee en dernier : ${cle}`);
  }
  if (suite.includes('style.css') && suite.indexOf('style.css') > suite.indexOf('couches.css')) {
    noter(p, 'style.css chargee apres couches.css');
  }
}

console.log(`\nFeuilles de style — ${feuilles.length} feuilles, ${pages.length} pages, ${blocs} bloc(s) <style> dans les pages\n`);
console.log(constats.length ? constats.join('\n') : '  Aucun constat.');
console.log(`\n  ── exceptions ──\n${[...EXCEPTIONS].map(([n, r]) => `  ${n} : ${r}`).join('\n')}`);
console.log('\n  ── !important admis ──');
for (const [f, admis] of IMPORTANTS_ADMIS) for (const [s, r] of admis) console.log(`  ${f} ${s} : ${r}`);
console.log('\n  ── ordre de chargement ──');
for (const [suite, liste] of [...ordres].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(liste.length).padStart(2)} page(s)  ${suite}`);
}
console.log('');

if (STRICT && constats.length) {
  console.error(`Controle CSS en echec : ${constats.length} constat(s).`);
  process.exit(1);
}
