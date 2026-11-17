import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPERE,
  commentairesDe,
  commentairesHTML,
  commentairesJS,
  constatsDe,
  sansCommentaires,
} from './commentaires.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(RACINE, 'qa', 'commentaires.mjs');
const textes = (liste) => liste.map((c) => c.texte);

describe('lexeur JavaScript', () => {
  test('chaînes, gabarits et expressions régulières', () => {
    const js = [
      "const a = '// pas un commentaire';",
      'const b = "/* pas non plus */";',
      'const c = `gabarit // ${\'/* ni */\'} fin /* rien */`;',
      'const d = `a${`b${"//"}c`}d /* toujours rien */`;',
      'const e = /\\/\\*[^*]*\\*\\//g;',
      "const f = s.replace(/\\/\\//g, '').split(/[/*]/);",
      'const g = x / 2 / y; // vrai',
      'const h = (y) / 2 / (z);',
      'const i = [1] / 1 / [2];',
      'const j = n++ / 2 / m--;',
      'function k(s) { return /\\/\\*/.test(s); }',
      'const l = { m: `${ {a: 1}.a }` /* bloc */ };',
      '/* fin */',
    ].join('\n');
    assert.deepEqual(textes(commentairesJS(js)), ['// vrai', '/* bloc */', '/* fin */']);
  });

  test('ligne de lancement', () => {
    const c = commentairesJS('#!/usr/bin/env node\nconst a = 1;\n');
    assert.deepEqual(c.map((x) => x.genre), ['#!']);
  });

  test('HTML avec script et style en ligne', () => {
    const html = [
      '<!-- Menu -->',
      '<style>.a { content: "/* non */"; } /* Carte */</style>',
      '<script>const u = "https://exemple.test"; // Lancement</script>',
      '<script type="application/ld+json">{"a": "// non"}</script>',
      '<!-- <script>// non</script> -->',
    ].join('\n');
    assert.deepEqual(textes(commentairesHTML(html)), [
      '<!-- Menu -->', '/* Carte */', '// Lancement', '<!-- <script>// non</script> -->',
    ]);
  });

  test('shell, YAML, TOML et SQL', () => {
    assert.deepEqual(textes(commentairesDe('a.sh', '#!/bin/sh\necho "# non" \'# non\' $# ${#x}\n# Lancement\nsh -c "a\n# non"\n')),
      ['#!/bin/sh', '# Lancement']);
    assert.deepEqual(textes(commentairesDe('a.yml', 'a: "l\'eau # non"\nb: x#non # Cache\n')), ['# Cache']);
    assert.deepEqual(textes(commentairesDe('a.toml', 'a = "# non" # Base\nb = """\n# non\n"""\n')), ['# Base']);
    assert.deepEqual(textes(commentairesDe('a.sql', "SELECT '-- non', 'l''a /* non */'; -- Purge\n")), ['-- Purge']);
  });
});

/* Fichiers JavaScript du dépôt */
function unitesJS() {
  const fichiers = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: RACINE, encoding: 'utf8' })
    .split('\n').filter((f) => /\.(m|c)?js$/.test(f));
  const unites = [];
  for (const f of [...new Set(fichiers)]) {
    const src = readFileSync(join(RACINE, f), 'utf8');
    unites.push({ nom: f, ext: extname(f), source: src, commentaires: commentairesJS(src) });
  }
  const pages = execFileSync('git', ['ls-files', '*.html'], { cwd: RACINE, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const p of pages) {
    const html = readFileSync(join(RACINE, p), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/ld\+json/.test(m[1]) || !m[2].trim()) continue;
      unites.push({ nom: `${p}:${html.slice(0, m.index).split('\n').length}`, ext: /module/.test(m[1]) ? '.mjs' : '.cjs', source: m[2], commentaires: commentairesJS(m[2]) });
    }
  }
  return unites;
}

describe('recompilation sans commentaires', () => {
  test('le code du dépôt, commentaires retirés, passe node --check', async () => {
    const lancer = promisify(execFile);
    const dossier = mkdtempSync(join(tmpdir(), 'commentaires-'));
    const unites = unitesJS();
    assert.ok(unites.length > 40, `${unites.length} unités seulement`);
    const verifier = async (u, k) => {
      for (const c of u.commentaires) assert.match(c.texte, /^(\/\/|\/\*|#!)/, `${u.nom} : ${c.texte.slice(0, 40)}`);
      const code = sansCommentaires(u.source, u.commentaires);
      const modes = u.ext === '.js' ? ['.mjs', '.cjs'] : [u.ext];
      for (const ext of modes) {
        const chemin = join(dossier, `u${k}${ext}`);
        writeFileSync(chemin, code);
        try { await lancer(process.execPath, ['--check', chemin]); return null; } catch (e) { if (ext === modes[modes.length - 1]) return `${u.nom} : ${String(e.stderr).split('\n').slice(0, 4).join(' | ')}`; }
      }
      return null;
    };
    const echecs = [];
    for (let k = 0; k < unites.length; k += 8) {
      const lot = await Promise.all(unites.slice(k, k + 8).map((u, j) => verifier(u, k + j)));
      echecs.push(...lot.filter(Boolean));
    }
    rmSync(dossier, { recursive: true, force: true });
    assert.deepEqual(echecs, []);
  });
});

describe('règles', () => {
  test('une étiquette passe', () => {
    for (const [f, src] of [
      ['a.js', '// Menu\nconst a = 1; /* Tarif d\'une visite */\n'],
      ['a.css', '/* Carrousel d\'avis */\n.a { color: red; }\n'],
      ['a.html', '<!-- ── Pied de page ── -->\n<footer></footer>\n'],
      ['a.sh', '#!/bin/sh\n# Lancement\necho ok\n'],
    ]) assert.deepEqual(constatsDe(f, src), [], f);
  });

  test('les repères du générateur passent, et eux seuls', () => {
    for (const nom of ['BLOG_GRID', 'BLOG_JSONLD', 'RELATED', 'BLOG_URLS', 'TOPBAR', 'FOOTER']) {
      for (const bout of ['START', 'END']) {
        const marque = `<!-- GENERATED:${nom}:${bout} -->`;
        assert.match(marque, REPERE);
        assert.deepEqual(constatsDe('a.html', `${marque}\n`), []);
      }
    }
    assert.deepEqual(constatsDe('a.html', '<!-- GENERATED:AUTRE:START -->\n')[0].regles, ['repere']);
  });

  test('un commentaire explicatif est refusé', () => {
    const cas = [
      ['/* Menu\n   du haut */', 'multiligne'],
      ['// Liste des pages exclues du contrôle du site', 'mots'],
      ['// Menu. Barre du haut', 'phrase'],
      ['// Hauteur = largeur', 'signe'],
      ['// Tarif → visite', 'signe'],
      ['// Tarif : calculé à la volée', 'signe'],
      ['// Bandeau — mobile', 'signe'],
      ['// Couche TITLES-V5', 'version'],
      ['// Barre parce que fixe', 'explication'],
      ['// Repli sinon vide', 'explication'],
      ['// Si absent', 'explication'],
      ['// Évite le décalage', 'explication'],
      ['// Correction du menu', 'explication'],
      ['// Faille du formulaire', 'interdit'],
      ['// Écrit par une IA', 'interdit'],
      ['// ──────────', 'vide'],
    ];
    for (const [src, regle] of cas) {
      const c = constatsDe('a.js', `${src}\nconst a = 1;\n`);
      assert.equal(c.length, 1, src);
      assert.ok(c[0].regles.includes(regle), `${src} : ${c[0].regles}`);
    }
  });

  test('deux commentaires de ligne qui se suivent font un bloc', () => {
    assert.deepEqual(constatsDe('a.js', '// Menu\n// Barre\nconst a = 1;\n')[0], { ligne: 1, regles: ['multiligne'] });
    assert.deepEqual(constatsDe('a.js', 'a(); // Menu\nb(); // Barre\n'), []);
  });
});

describe('commande', () => {
  const depot = (fichiers) => {
    const racine = mkdtempSync(join(tmpdir(), 'commentaires-depot-'));
    for (const [f, src] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(racine, f)), { recursive: true });
      writeFileSync(join(racine, f), src);
    }
    execFileSync('git', ['init', '-q'], { cwd: racine });
    return racine;
  };
  const lancer = (racine, args) => {
    try {
      return { code: 0, sortie: execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, COMMENTAIRES_RACINE: racine }, encoding: 'utf8', stdio: 'pipe' }) };
    } catch (e) {
      return { code: e.status, sortie: `${e.stdout}${e.stderr}` };
    }
  };

  test('--strict échoue sur un commentaire explicatif', () => {
    const r = depot({ 'js/a.js': '// Menu\nconst a = 1;\n/* On calcule la hauteur pour que le menu reste visible. */\n' });
    const s = lancer(r, ['--strict']);
    assert.equal(s.code, 1, s.sortie);
    assert.match(s.sortie, /^js\/a\.js:3 mots,explication$/m);
    assert.equal(lancer(r, []).code, 0);
    rmSync(r, { recursive: true, force: true });
  });

  test('--strict passe sur des étiquettes et des repères', () => {
    const r = depot({
      'a.html': '<!-- Menu -->\n<!-- GENERATED:RELATED:START -->\n<!-- GENERATED:RELATED:END -->\n',
      'b.sh': '#!/bin/sh\n# Lancement\n',
    });
    const s = lancer(r, ['--strict']);
    assert.equal(s.code, 0, s.sortie);
    rmSync(r, { recursive: true, force: true });
  });
});
