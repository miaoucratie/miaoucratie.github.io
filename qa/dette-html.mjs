/* Relevé du HTML mort */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Exceptions */
export const EXCEPTIONS = new Map([
  ['calculateur-miaoucratie.html', 'page appelée à disparaître'],
  ['id sur section, article, figure ou titre', 'adresse de partage, visée parfois hors du site'],
]);

/* Adresses de partage */
const ANCRES = /^(section|article|figure|h2|h3|h4)$/i;
const ROLES_NATURELS = { main: 'main', nav: 'navigation', button: 'button', article: 'article', aside: 'complementary', form: 'form' };

/* Références à un identifiant */
function referencesIds(pages, feuilles, scripts) {
  const vus = new Set();
  const noter = (texte, re) => { for (const m of texte.matchAll(re)) vus.add(m[1]); };
  for (const html of pages.values()) {
    noter(html, /href="[^"#]*#([^"]+)"/g);
    noter(html, /\b(?:for|list|form|headers)="([^"]+)"/g);
    for (const m of html.matchAll(/\baria-(?:labelledby|describedby|controls|owns|activedescendant|details|errormessage|flowto)="([^"]+)"/g)) m[1].split(/\s+/).forEach((x) => vus.add(x));
    noter(html, /url\(#([\w-]+)\)/g);
  }
  for (const css of feuilles.values()) noter(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#([a-zA-Z][\w-]*)(?![^{]*;)/g);
  const affixes = [];
  for (const js of scripts) {
    noter(js, /['"`]#?([a-zA-Z][\w-]*)['"`]/g);
    noter(js, /#([a-zA-Z][\w-]*)/g);
    for (const m of js.matchAll(/([\w-]{3,})\$\{/g)) affixes.push((id) => id.startsWith(m[1]));
    for (const m of js.matchAll(/\}([\w-]{3,})[`'"]/g)) affixes.push((id) => id.endsWith(m[1]));
  }
  return { a: (id) => vus.has(id) || affixes.some((f) => f(id)) };
}

/* Analyse */
export function analyser(pages, feuilles, scripts) {
  const constats = [];
  const vises = referencesIds(pages, feuilles, [...scripts.values(), ...[...pages.values()].flatMap((h) => [...h.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]))]);
  for (const [nom, html] of pages) {
    if (EXCEPTIONS.has(nom)) continue;
    const corps = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, (s) => s.replace(/>[\s\S]*<\//, '></')).replace(/<style[\s\S]*?<\/style>/gi, '');
    const noter = (sorte, detail) => constats.push(`${nom} | ${sorte} | ${detail}`);
    for (const m of corps.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\sid="([^"]*)"/g)) {
      if (!m[2]) noter('attribut sans effet', `<${m[1]} id="">`);
      else if (!ANCRES.test(m[1]) && !vises.a(m[2])) noter('identifiant que rien ne vise', `<${m[1]} id="${m[2]}">`);
    }
    for (const m of corps.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\s(class|style)=""/g)) noter('attribut sans effet', `<${m[1]} ${m[2]}="">`);
    for (const m of corps.matchAll(/<(script|style|link)\b[^>]*\stype="text\/(javascript|css)"/g)) noter('attribut sans effet', `<${m[1]} type="text/${m[2]}">`);
    for (const m of corps.matchAll(/<(\w+)\b[^>]*\srole="(\w+)"/g)) if (ROLES_NATURELS[m[1].toLowerCase()] === m[2]) noter('attribut sans effet', `<${m[1]} role="${m[2]}">`);
    for (const m of html.matchAll(/<script\b[^>]*\ssrc="(js\/[^"]+)"/g)) {
      const source = scripts.get(m[1]);
      if (!source) continue;
      const ids = [...source.matchAll(/getElementById\(\s*['"]([\w-]+)['"]/g)].map((x) => x[1]);
      const selecteurs = [...source.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
      if ((!ids.length && !selecteurs.length) || /createElement\(|innerHTML\s*=|insertAdjacentHTML/.test(source)) continue;
      const present = ids.some((id) => html.includes(`id="${id}"`)) || selecteurs.some((s) => {
        const c = s.match(/[.#]([\w-]+)|\[([\w-]+)/);
        if (!c) return true;
        if (c[2]) return html.includes(c[2]);
        return s.trim().startsWith('#') ? html.includes(`id="${c[1]}"`) : new RegExp(`class="[^"]*\\b${c[1]}\\b`).test(html);
      });
      if (!present) noter('script sans usage', m[1]);
    }
  }
  return constats.sort();
}

/* Éléments vides qui ne dessinent rien */
export const VIDES = () => {
  const admis = /^(BR|HR|IMG|INPUT|LINK|META|SOURCE|TRACK|WBR|SCRIPT|STYLE|IFRAME|CANVAS|TEXTAREA|TD|TH|OPTION|SELECT|NOSCRIPT|TEMPLATE|VIDEO|AUDIO|OBJECT|EMBED|AREA|BASE|COL)$/;
  const out = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('svg') || admis.test(e.tagName) || e.attributes.length || e.childNodes.length) continue;
    const r = e.getBoundingClientRect();
    const dessine = ['::before', '::after'].some((p) => getComputedStyle(e, p).content !== 'none');
    if ((!r.width || !r.height) && !dessine) out.push(`<${e.tagName.toLowerCase()}></${e.tagName.toLowerCase()}>`);
  }
  return out;
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
  const STRICT = process.argv.includes('--strict');
  const lister = (dossier, ext, prefixe = '') => readdirSync(join(RACINE, dossier), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? lister(join(dossier, e.name), ext, `${prefixe}${e.name}/`) : e.name.endsWith(ext) && !e.name.endsWith(`.test${ext}`) ? [`${prefixe}${e.name}`] : []));
  const pages = new Map(readdirSync(RACINE).filter((f) => f.endsWith('.html')).sort().map((f) => [f, readFileSync(join(RACINE, f), 'utf8')]));
  const feuilles = new Map(lister('css', '.css').map((f) => [f, readFileSync(join(RACINE, 'css', f), 'utf8')]));
  const scripts = new Map([...lister('js', '.js').map((f) => [`js/${f}`, readFileSync(join(RACINE, 'js', f), 'utf8')]),
    ...lister('shared', '.js').map((f) => [`shared/${f}`, readFileSync(join(RACINE, 'shared', f), 'utf8')])]);
  const constats = analyser(pages, feuilles, scripts);
  const { chromium } = await import('playwright');
  const { demarrerFauxWorker, demarrerServeur } = await import('./qa.mjs');
  const worker = await demarrerFauxWorker();
  const serveur = await demarrerServeur(worker.url);
  const navigateur = await chromium.launch();
  for (const nom of pages.keys()) {
    if (EXCEPTIONS.has(nom)) continue;
    const parLargeur = [];
    for (const largeur of [1280, 375]) {
      const p = await navigateur.newPage({ viewport: { width: largeur, height: 900 } });
      await p.goto(`http://127.0.0.1:${serveur.address().port}/${nom}`, { waitUntil: 'load' });
      parLargeur.push(await p.evaluate(VIDES));
      await p.close();
    }
    const communs = parLargeur[0].filter((x, i) => parLargeur[1].includes(x));
    for (const v of communs) constats.push(`${nom} | élément vide | ${v}`);
  }
  await navigateur.close();
  serveur.close();
  worker.serveur.close();
  constats.sort();
  const parSorte = new Map();
  for (const c of constats) { const s = c.split(' | ')[1]; parSorte.set(s, (parSorte.get(s) || 0) + 1); }
  console.log(`\nHTML mort — ${pages.size} pages, ${constats.length} constat(s)\n`);
  for (const [s, n] of parSorte) console.log(`  ${String(n).padStart(4)}  ${s}`);
  if (constats.length) console.log(`\n${constats.map((c) => `  ${c}`).join('\n')}`);
  console.log(`\n  ── exceptions ──\n${[...EXCEPTIONS].map(([n, r]) => `  ${n} : ${r}`).join('\n')}\n`);
  if (STRICT && constats.length) {
    console.error(`HTML mort : ${constats.length} constat(s).`);
    process.exit(1);
  }
}
