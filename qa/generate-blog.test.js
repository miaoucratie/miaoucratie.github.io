/* Tests du générateur du blog */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'generate-blog.js');

/* ── Un site minimal mais representatif ─────────────────────────────────── */
const ORIGINE = 'https://exemple.test';
/* Emoji par rubrique */
const EMOJI = { 'Rubrique A': '🅰️', 'Rubrique B': '🅱️' };
const zone = (nom) => `<!-- GENERATED:${nom}:START -->\n<!-- GENERATED:${nom}:END -->`;
const PAGES = ['coulisses-miaoucratie.html', 'un.html', 'deux.html', 'brouillon.html'];

function article(a) {
  return `<!DOCTYPE html><html lang="fr"><head>
<title>${a.seoTitle}</title>
<meta name="description" content="${a.description}">
<link rel="canonical" href="${ORIGINE}${a.url}">
<meta property="og:url" content="${ORIGINE}${a.url}">
<meta property="og:image" content="${a.image}">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BlogPosting","headline":"${a.ldHeadline}","url":"${ORIGINE}${a.url}","datePublished":"${a.datePublished}","dateModified":"${a.dateModified}"}
</script>
</head><body>
${zone('TOPBAR')}
<p class="eyebrow">${EMOJI[a.category]} ${a.category}</p>
<h1>${a.h1}</h1>
<p>Corps de l'article, ecrit a la main. Le generateur n'y touche pas.</p>
<!-- GENERATED:RELATED:START -->
<!-- GENERATED:RELATED:END -->
${zone('FOOTER')}
</body></html>`;
}

const BASE = () => ({
  site: { origin: ORIGINE, blogUrl: '/coulisses-miaoucratie.html', blogName: 'Blog test', author: 'Autrice', inLanguage: 'fr-FR', rubriques: [{ nom: 'Rubrique A', emoji: '🅰️' }, { nom: 'Rubrique B', emoji: '🅱️' }],
    pages: { 'coulisses-miaoucratie.html': 'coulisses-miaoucratie.html', 'un.html': 'coulisses-miaoucratie.html', 'deux.html': null, 'brouillon.html': 'reservation.html' } },
  articles: [
    {
      slug: 'un', url: '/un.html', status: 'published', category: 'Rubrique A', affiliate: true,
      h1: 'Titre editorial un', seoTitle: 'Titre SEO un | Blog', description: 'Description un.',
      ldHeadline: 'Titre structure un', cardTitle: 'Carte un', cardText: ['Texte un.'], cardCta: 'Lire un',
      datePublished: '2026-01-10', dateModified: '2026-01-10', keywords: ['a'], related: ['deux'],
      image: `${ORIGINE}/i.webp`,
    },
    {
      slug: 'deux', url: '/deux.html', status: 'published', category: 'Rubrique A', affiliate: false,
      h1: 'Titre editorial deux', seoTitle: 'Titre SEO deux | Blog', description: 'Description deux.',
      ldHeadline: 'Titre structure deux', cardTitle: 'Carte deux', cardText: ['Texte deux.'], cardCta: 'Lire deux',
      datePublished: '2026-02-20', dateModified: '2026-02-25', keywords: ['a'], related: [],
      image: `${ORIGINE}/i.webp`,
    },
    {
      slug: 'brouillon', url: '/brouillon.html', status: 'draft', category: 'Rubrique B', affiliate: false,
      h1: 'Brouillon', seoTitle: 'Brouillon | Blog', description: 'Pas encore publie.',
      ldHeadline: 'Brouillon', cardTitle: 'Carte brouillon', cardText: ['Texte.'], cardCta: 'Lire',
      datePublished: '2026-03-01', dateModified: '2026-03-01', keywords: [], related: [],
      image: `${ORIGINE}/i.webp`,
    },
  ],
});

function monter(registre = BASE(), options = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'blogtest-'));
  fs.mkdirSync(path.join(racine, 'blog'));
  fs.writeFileSync(path.join(racine, 'blog', 'articles.json'), JSON.stringify(registre, null, 1));
  for (const a of registre.articles) {
    if (options.sansFichier && options.sansFichier.includes(a.slug)) continue;
    const contenu = options.altererH1 === a.slug
      ? article(a).replace(`<h1>${a.h1}</h1>`, '<h1>Un tout autre titre</h1>')
      : article(a);
    fs.writeFileSync(path.join(racine, a.url.replace(/^\//, '')), contenu);
  }
  fs.writeFileSync(path.join(racine, 'coulisses-miaoucratie.html'), `<!DOCTYPE html><html lang="fr"><head>
<title>Blog test</title>
<!-- GENERATED:BLOG_JSONLD:START -->
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Blog","name":"Blog test","blogPost":[]}
</script>
<!-- GENERATED:BLOG_JSONLD:END -->
</head><body>
${zone('TOPBAR')}
<h1>Le blog</h1>
<div class="art-trio">
${options.marqueurGrille === 'absent' ? '' : options.marqueurGrille === 'double'
    ? '<!-- GENERATED:BLOG_GRID:START -->\n<!-- GENERATED:BLOG_GRID:START -->\n<!-- GENERATED:BLOG_GRID:END -->'
    : '<!-- GENERATED:BLOG_GRID:START -->\n<!-- GENERATED:BLOG_GRID:END -->'}
</div>
${zone('FOOTER')}
</body></html>`);
  fs.writeFileSync(path.join(racine, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGINE}/</loc><lastmod>2026-01-01</lastmod></url>
  <!-- GENERATED:BLOG_URLS:START -->
  <!-- GENERATED:BLOG_URLS:END -->
</urlset>`);
  return racine;
}

function lancer(racine, args = []) {
  try {
    const sortie = execFileSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, BLOG_RACINE: racine }, encoding: 'utf8', stdio: 'pipe',
    });
    return { code: 0, sortie };
  } catch (e) {
    return { code: e.status ?? 1, sortie: (e.stdout || '') + (e.stderr || '') };
  }
}

/* ── Cas valide ─────────────────────────────────────────────────────────── */
test('un registre correct genere la grille, les articles lies et le sitemap', () => {
  const r = monter();
  const g = lancer(r);
  assert.strictEqual(g.code, 0, g.sortie);

  const blog = fs.readFileSync(path.join(r, 'coulisses-miaoucratie.html'), 'utf8');
  assert.match(blog, /href="deux\.html"/, 'la carte de « deux » manque');
  assert.match(blog, /href="un\.html"/, 'la carte de « un » manque');
  assert.doesNotMatch(blog, /brouillon\.html/, 'un brouillon est apparu dans la grille');

  /* Ordre d'affichage */
  assert.ok(blog.indexOf('deux.html') < blog.indexOf('un.html'), 'ordre non respecte');

  /* JSON-LD */
  const ld = JSON.parse(blog.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(ld.blogPost.length, 2);
  assert.strictEqual(ld.name, 'Blog test', 'les donnees hors blogPost ont ete perdues');

  /* Articles liés */
  assert.match(fs.readFileSync(path.join(r, 'un.html'), 'utf8'), /href="deux\.html"/);
  assert.match(fs.readFileSync(path.join(r, 'deux.html'), 'utf8'), /href="un\.html"/);

  /* Sitemap */
  const sm = fs.readFileSync(path.join(r, 'sitemap.xml'), 'utf8');
  assert.match(sm, new RegExp(`<loc>${ORIGINE}/un.html</loc>`));
  assert.match(sm, /<lastmod>2026-02-25<\/lastmod>/, 'lastmod doit valoir dateModified');
  assert.doesNotMatch(sm, /brouillon/);
  assert.match(sm, new RegExp(`<loc>${ORIGINE}/</loc>`), 'les autres entrees du sitemap ont disparu');

  fs.rmSync(r, { recursive: true, force: true });
});

test('le corps editorial de la page n est pas touche', () => {
  const r = monter();
  const avant = fs.readFileSync(path.join(r, 'un.html'), 'utf8');
  assert.strictEqual(lancer(r).code, 0);
  const apres = fs.readFileSync(path.join(r, 'un.html'), 'utf8');
  assert.ok(apres.includes("Corps de l'article, ecrit a la main."), 'le texte editorial a bouge');
  const horsZones = (t) => t.replace(/(<!-- GENERATED:(\w+):START -->)[\s\S]*?(<!-- GENERATED:\2:END -->)/g, '$1$3');
  assert.strictEqual(horsZones(avant), horsZones(apres), 'la partie hors marqueurs a change');
  fs.rmSync(r, { recursive: true, force: true });
});

/* ── Idempotence ── */
test('une deuxieme generation ne change plus rien', () => {
  const r = monter();
  assert.strictEqual(lancer(r).code, 0);
  const empreinte = [...PAGES, 'sitemap.xml']
    .map((f) => fs.readFileSync(path.join(r, f), 'utf8')).join('\0');
  const deux = lancer(r);
  assert.strictEqual(deux.code, 0, deux.sortie);
  assert.match(deux.sortie, /Rien a changer/);
  const empreinte2 = [...PAGES, 'sitemap.xml']
    .map((f) => fs.readFileSync(path.join(r, f), 'utf8')).join('\0');
  assert.strictEqual(empreinte, empreinte2, 'la deuxieme generation a modifie des fichiers');
  fs.rmSync(r, { recursive: true, force: true });
});

test('--check reussit sur un depot a jour et n ecrit rien', () => {
  const r = monter();
  assert.strictEqual(lancer(r).code, 0);
  const avant = fs.readFileSync(path.join(r, 'coulisses-miaoucratie.html'), 'utf8');
  const c = lancer(r, ['--check']);
  assert.strictEqual(c.code, 0, c.sortie);
  assert.strictEqual(fs.readFileSync(path.join(r, 'coulisses-miaoucratie.html'), 'utf8'), avant);
  fs.rmSync(r, { recursive: true, force: true });
});

test('--check echoue sur un bloc obsolete, sans reparer le fichier', () => {
  const r = monter();
  assert.strictEqual(lancer(r).code, 0);
  const reg = JSON.parse(fs.readFileSync(path.join(r, 'blog', 'articles.json'), 'utf8'));
  reg.articles[0].cardTitle = 'Carte un, titre corrige';
  fs.writeFileSync(path.join(r, 'blog', 'articles.json'), JSON.stringify(reg, null, 1));
  const avant = fs.readFileSync(path.join(r, 'coulisses-miaoucratie.html'), 'utf8');
  const c = lancer(r, ['--check']);
  assert.strictEqual(c.code, 1, 'le mode --check aurait du echouer');
  assert.match(c.sortie, /differe de sa source/);
  assert.strictEqual(fs.readFileSync(path.join(r, 'coulisses-miaoucratie.html'), 'utf8'), avant, '--check a modifie un fichier');
  fs.rmSync(r, { recursive: true, force: true });
});

/* ── Cas négatifs ── */
const negatifs = [
  ['slug en double', (reg) => { reg.articles[1].slug = 'un'; }, /slug en double/],
  ['url en double', (reg) => { reg.articles[1].url = '/un.html'; }, /url en double/],
  ['related vers un slug inexistant', (reg) => { reg.articles[0].related = ['fantome']; }, /n'existe pas dans le registre/],
  ['auto-reference dans related', (reg) => { reg.articles[0].related = ['un']; }, /se refere a lui-meme/],
  ['doublon dans related', (reg) => { reg.articles[0].related = ['deux', 'deux']; }, /deux fois/],
  ['related vers un brouillon', (reg) => { reg.articles[0].related = ['brouillon']; }, /n'est pas publie/],
  ['dateModified anterieure', (reg) => { reg.articles[0].dateModified = '2026-01-01'; }, /anterieure a datePublished/],
  ['date au mauvais format', (reg) => { reg.articles[0].datePublished = '10/01/2026'; }, /AAAA-MM-JJ/],
  ['champ obligatoire manquant', (reg) => { delete reg.articles[0].cardCta; }, /champ obligatoire manquant/],
  ['status inconnu', (reg) => { reg.articles[0].status = 'peut-etre'; }, /status inconnu/],
  ['slug non conforme', (reg) => { reg.articles[0].slug = 'Un Slug'; }, /slug non conforme/],
  ['rubrique non declaree', (reg) => { reg.articles[0].category = 'Rubrique Z'; }, /absente de « site.rubriques »/],
  ['rang non entier', (reg) => { reg.articles[0].rang = 1.5; }, /« rang » doit etre un entier positif/],
  ['rang nul', (reg) => { reg.articles[0].rang = 0; }, /« rang » doit etre un entier positif/],
  ['emoji de rubrique absent', (reg) => { delete reg.site.rubriques[0].emoji; }, /l'emoji d'une rubrique doit tenir/],
  ['emoji de rubrique trop long', (reg) => { reg.site.rubriques[0].emoji = 'Étiquettes'; }, /l'emoji d'une rubrique doit tenir/],
  ['deux rubriques, un seul emoji', (reg) => { reg.site.rubriques[1].emoji = reg.site.rubriques[0].emoji; }, /sert deja a une autre rubrique/],
  ['table des pages absente', (reg) => { delete reg.site.pages; }, /« site\.pages » doit associer/],
  ['page absente de la table', (reg) => { delete reg.site.pages['deux.html']; }, /deux\.html\s+page absente de « site\.pages »/],
  ['entree courante inconnue', (reg) => { reg.site.pages['un.html'] = 'fantome.html'; }, /entree courante inconnue pour un\.html : « fantome\.html »/],
  ['page declaree sans fichier', (reg) => { reg.site.pages['fantome.html'] = null; }, /« fantome\.html », qui n'est pas une page du site/],
];

for (const [nom, casser, attendu] of negatifs) {
  test(`echec attendu : ${nom}`, () => {
    const reg = BASE();
    casser(reg);
    const r = monter(reg);
    const g = lancer(r);
    assert.strictEqual(g.code, 1, `la commande aurait du echouer\n${g.sortie}`);
    assert.match(g.sortie, attendu);
    assert.match(g.sortie, /Rien n'a ete ecrit/);
    fs.rmSync(r, { recursive: true, force: true });
  });
}

test('echec attendu : article publie sans fichier HTML', () => {
  const r = monter(BASE(), { sansFichier: ['deux'] });
  const g = lancer(r);
  assert.strictEqual(g.code, 1);
  assert.match(g.sortie, /article publie sans fichier/);
  fs.rmSync(r, { recursive: true, force: true });
});

test('echec attendu : h1 divergent, sans correction silencieuse', () => {
  const r = monter(BASE(), { altererH1: 'un' });
  const g = lancer(r);
  assert.strictEqual(g.code, 1);
  assert.match(g.sortie, /h1 diverge du registre/);
  assert.match(g.sortie, /Un tout autre titre/);
  assert.match(g.sortie, /Titre editorial un/);
  assert.match(fs.readFileSync(path.join(r, 'un.html'), 'utf8'), /Un tout autre titre/, 'le h1 a ete reecrit');
  fs.rmSync(r, { recursive: true, force: true });
});

test('echec attendu : sur-titre qui ne nomme pas la rubrique', () => {
  const r = monter();
  const f = path.join(r, 'un.html');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/<p class="eyebrow">[^<]*<\/p>/, '<p class="eyebrow">🅰️ Une autre rubrique</p>'));
  const g = lancer(r);
  assert.strictEqual(g.code, 1, g.sortie);
  assert.match(g.sortie, /sur-titre diverge du registre/);
  assert.match(fs.readFileSync(f, 'utf8'), /Une autre rubrique/, 'le sur-titre a ete reecrit en silence');
  fs.rmSync(r, { recursive: true, force: true });
});

test('echec attendu : marqueur absent', () => {
  const r = monter(BASE(), { marqueurGrille: 'absent' });
  const g = lancer(r);
  assert.strictEqual(g.code, 1);
  assert.match(g.sortie, /marqueur BLOG_GRID ambigu/);
  fs.rmSync(r, { recursive: true, force: true });
});

test('echec attendu : marqueur en double', () => {
  const r = monter(BASE(), { marqueurGrille: 'double' });
  const g = lancer(r);
  assert.strictEqual(g.code, 1);
  assert.match(g.sortie, /marqueur BLOG_GRID ambigu/);
  fs.rmSync(r, { recursive: true, force: true });
});

test('echec attendu : JSON du registre invalide', () => {
  const r = monter();
  fs.writeFileSync(path.join(r, 'blog', 'articles.json'), '{ ceci n est pas du JSON');
  const g = lancer(r);
  assert.strictEqual(g.code, 1);
  assert.match(g.sortie, /JSON illisible/);
  fs.rmSync(r, { recursive: true, force: true });
});

test('un brouillon n apparait ni dans la grille, ni dans les lies, ni dans le sitemap', () => {
  const r = monter();
  assert.strictEqual(lancer(r).code, 0);
  for (const f of ['coulisses-miaoucratie.html', 'un.html', 'deux.html', 'sitemap.xml']) {
    assert.doesNotMatch(fs.readFileSync(path.join(r, f), 'utf8'), /brouillon\.html/, `brouillon visible dans ${f}`);
  }
  fs.rmSync(r, { recursive: true, force: true });
});

test('relancer le generateur ne change aucune date', () => {
  const r = monter();
  assert.strictEqual(lancer(r).code, 0);
  const sm1 = fs.readFileSync(path.join(r, 'sitemap.xml'), 'utf8');
  const reg1 = fs.readFileSync(path.join(r, 'blog', 'articles.json'), 'utf8');
  assert.strictEqual(lancer(r).code, 0);
  assert.strictEqual(fs.readFileSync(path.join(r, 'sitemap.xml'), 'utf8'), sm1, 'le sitemap a change');
  assert.strictEqual(fs.readFileSync(path.join(r, 'blog', 'articles.json'), 'utf8'), reg1, 'le registre a change');
  fs.rmSync(r, { recursive: true, force: true });
});

/* ── Barre du haut et pied ── */
const lire = (r, f) => fs.readFileSync(path.join(r, f), 'utf8');
const compter = (t, motif) => t.split(motif).length - 1;

test('la barre du haut et le pied de page sont generes sur chaque page de la table', () => {
  const r = monter();
  const g = lancer(r);
  assert.strictEqual(g.code, 0, g.sortie);
  const pieds = new Set();
  for (const f of PAGES) {
    const t = lire(r, f);
    assert.strictEqual(compter(t, '<header class="topbar">'), 1, `barre du haut absente ou en double dans ${f}`);
    assert.strictEqual(compter(t, '<footer class="footer-bar">'), 1, `pied de page absent ou en double dans ${f}`);
    assert.match(t, /<span>06&nbsp;44&nbsp;24&nbsp;76&nbsp;81<\/span><\/a>/, `numero sans insecables dans ${f}`);
    assert.match(t, /&#9776; Menu<\/button>/);
    pieds.add(t.slice(t.indexOf('<footer'), t.indexOf('</footer>')));
  }
  assert.strictEqual(pieds.size, 1, 'le pied de page differe d une page a l autre');

  /* Entrée courante */
  assert.match(lire(r, 'un.html'), /<a href="coulisses-miaoucratie\.html" class="is-current">/);
  assert.strictEqual(compter(lire(r, 'un.html'), 'is-current'), 1);
  assert.doesNotMatch(lire(r, 'deux.html'), /is-current/, 'une page sans entree courante en a une');
  assert.match(lire(r, 'brouillon.html'), /<a href="reservation\.html" class="is-current is-cta">/, 'ordre des classes non reproduit');
  assert.match(lire(r, 'coulisses-miaoucratie.html'), /<a href="reservation\.html" class="is-cta">/);
  fs.rmSync(r, { recursive: true, force: true });
});

test('une page maquette n est ni exigee dans la table ni modifiee', () => {
  const r = monter();
  const maquette = '<!DOCTYPE html><html lang="fr"><body><p>Essai</p></body></html>';
  fs.writeFileSync(path.join(r, 'maquette-essai.html'), maquette);
  const g = lancer(r);
  assert.strictEqual(g.code, 0, g.sortie);
  assert.strictEqual(lire(r, 'maquette-essai.html'), maquette);
  fs.rmSync(r, { recursive: true, force: true });
});

for (const [nom, casser, attendu] of [
  ['zone de la barre du haut absente', (t) => t.replace(zone('TOPBAR'), ''), /marqueur TOPBAR ambigu : 0 balise\(s\) START et 0 balise\(s\) END/],
  ['zone du pied de page en double', (t) => t.replace(zone('FOOTER'), `${zone('FOOTER')}\n${zone('FOOTER')}`), /marqueur FOOTER ambigu : 2 balise\(s\) START et 2 balise\(s\) END/],
]) {
  test(`echec attendu : ${nom}`, () => {
    const r = monter();
    const f = path.join(r, 'un.html');
    fs.writeFileSync(f, casser(lire(r, 'un.html')));
    const avant = lire(r, 'un.html');
    const g = lancer(r);
    assert.strictEqual(g.code, 1, g.sortie);
    assert.match(g.sortie, attendu);
    assert.match(g.sortie, /Rien n'a ete ecrit/);
    assert.strictEqual(lire(r, 'un.html'), avant, 'la page a ete modifiee malgre l echec');
    fs.rmSync(r, { recursive: true, force: true });
  });
}

test('--check echoue sur une barre du haut modifiee a la main, sans reparer la page', () => {
  const r = monter();
  assert.strictEqual(lancer(r).code, 0);
  const f = path.join(r, 'un.html');
  fs.writeFileSync(f, lire(r, 'un.html').replace('</svg>Tarifs</a>', '</svg>Prix</a>'));
  const avant = lire(r, 'un.html');
  const c = lancer(r, ['--check']);
  assert.strictEqual(c.code, 1, c.sortie);
  assert.match(c.sortie, /un\.html — zone TOPBAR/);
  assert.strictEqual(lire(r, 'un.html'), avant, '--check a modifie la page');
  fs.rmSync(r, { recursive: true, force: true });
});

test('une page en fins de ligne CRLF les garde, et une deuxieme generation ne change plus rien', () => {
  const r = monter();
  const f = path.join(r, 'un.html');
  fs.writeFileSync(f, lire(r, 'un.html').replace(/\n/g, '\r\n'));
  assert.strictEqual(lancer(r).code, 0);
  const t = lire(r, 'un.html');
  assert.match(t, /<header class="topbar">/);
  assert.match(t, /<footer class="footer-bar">/);
  assert.doesNotMatch(t, /[^\r]\n/, 'un saut de ligne seul a ete ecrit dans une page CRLF');
  const deux = lancer(r);
  assert.strictEqual(deux.code, 0, deux.sortie);
  assert.match(deux.sortie, /Rien a changer/);
  assert.strictEqual(lire(r, 'un.html'), t);
  assert.strictEqual(lancer(r, ['--check']).code, 0);
  fs.rmSync(r, { recursive: true, force: true });
});
