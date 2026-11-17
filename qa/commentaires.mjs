/* Contrôle des commentaires */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentairesCSS } from './css-regles.mjs';

const RACINE = process.env.COMMENTAIRES_RACINE
  ? resolve(process.env.COMMENTAIRES_RACINE)
  : join(dirname(fileURLToPath(import.meta.url)), '..');

/* Langage par extension */
const LANGAGES = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js',
  '.css': 'css', '.html': 'html', '.sql': 'sql',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.sh': 'sh',
};

/* Repères du générateur du blog */
export const REPERE = /^<!-- GENERATED:(BLOG_GRID|BLOG_JSONLD|RELATED|BLOG_URLS|TOPBAR|FOOTER|FAQ_JSONLD):(START|END) -->$/;

/* Lexeur JavaScript */
const MOTS_AVANT_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

export function commentairesJS(source, decalage = 0) {
  const src = String(source);
  const n = src.length;
  const trouves = [];
  const gabarits = [];
  let i = 0, accolades = 0, regexPossible = true;
  const noter = (genre, debut, fin) => trouves.push({ genre, debut: debut + decalage, fin: fin + decalage, texte: src.slice(debut, fin) });
  const finDeLigne = (j) => { const k = src.indexOf('\n', j); return k < 0 ? n : k; };

  const lireChaine = (q) => {
    let j = i + 1;
    while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
    return j + 1;
  };
  const lireGabarit = (j) => {
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') return { fin: j + 1, ouvre: false };
      if (src[j] === '$' && src[j + 1] === '{') return { fin: j + 2, ouvre: true };
      j++;
    }
    return { fin: n, ouvre: false };
  };
  const reprendre = (g) => {
    i = g.fin;
    if (g.ouvre) { gabarits.push(accolades); regexPossible = true; } else regexPossible = false;
  };
  const lireRegex = () => {
    let j = i + 1, classe = false;
    while (j < n && src[j] !== '\n') {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '[') classe = true;
      else if (src[j] === ']') classe = false;
      else if (src[j] === '/' && !classe) break;
      j++;
    }
    if (j >= n || src[j] !== '/') return -1;
    j++;
    while (j < n && /[a-z]/i.test(src[j])) j++;
    return j;
  };

  if (src.startsWith('#!')) { const j = finDeLigne(0); noter('#!', 0, j); i = j; }

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const j = finDeLigne(i); noter('//', i, j); i = j; continue; }
    if (c === '/' && d === '*') {
      const k = src.indexOf('*/', i + 2);
      const j = k < 0 ? n : k + 2;
      noter('/*', i, j); i = j; continue;
    }
    if (c === '"' || c === "'") { i = lireChaine(c); regexPossible = false; continue; }
    if (c === '`') { reprendre(lireGabarit(i + 1)); continue; }
    if (c === '}' && gabarits.length && gabarits[gabarits.length - 1] === accolades) {
      gabarits.pop();
      reprendre(lireGabarit(i + 1));
      continue;
    }
    if (c === '/' && regexPossible) {
      const j = lireRegex();
      if (j > 0) { i = j; regexPossible = false; continue; }
    }
    if (/[\p{ID_Continue}$#\\]/u.test(c)) {
      let j = i + 1;
      while (j < n && /[\p{ID_Continue}$‌‍]/u.test(src[j])) j++;
      const mot = src.slice(i, j);
      regexPossible = MOTS_AVANT_REGEX.has(mot);
      i = j; continue;
    }
    if (c === '{') accolades++;
    else if (c === '}') accolades--;
    if ((c === '+' || c === '-') && d === c) { i += 2; continue; }
    if (!/\s/.test(c)) regexPossible = !(c === ')' || c === ']');
    i++;
  }
  return trouves;
}

/* Code sans commentaires */
export function sansCommentaires(source, commentaires) {
  let code = String(source);
  for (const c of commentaires) {
    code = code.slice(0, c.debut) + code.slice(c.debut, c.fin).replace(/[^\n]/g, ' ') + code.slice(c.fin);
  }
  return code;
}

/* Lexeur HTML */
const TYPES_JS = new Set(['', 'module', 'text/javascript', 'application/javascript']);

export function commentairesHTML(source) {
  const src = String(source);
  const n = src.length;
  const trouves = [];
  const ouvrante = /<(script|style)\b([^>]*)>/iy;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const k = src.indexOf('-->', lt + 4);
      const j = k < 0 ? n : k + 3;
      trouves.push({ genre: '<!--', debut: lt, fin: j, texte: src.slice(lt, j) });
      i = j; continue;
    }
    ouvrante.lastIndex = lt;
    const m = ouvrante.exec(src);
    if (!m) { i = lt + 1; continue; }
    const debut = lt + m[0].length;
    const k = src.slice(debut).search(new RegExp(`</${m[1]}\\s*>`, 'i'));
    const fin = k < 0 ? n : debut + k;
    const corps = src.slice(debut, fin);
    if (m[1].toLowerCase() === 'style') {
      for (const c of commentairesCSS(corps)) {
        trouves.push({ genre: '/*', debut: debut + c.debut, fin: debut + c.fin, texte: c.texte });
      }
    } else {
      const type = (m[2].match(/\btype\s*=\s*["']?([^"'\s>]*)/i) || [])[1] || '';
      if (TYPES_JS.has(type.toLowerCase())) trouves.push(...commentairesJS(corps, debut));
    }
    i = fin;
  }
  return trouves;
}

/* Lexeur SQL */
export function commentairesSQL(source) {
  const src = String(source);
  const n = src.length;
  const trouves = [];
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) { if (src[j] === c) { if (src[j + 1] === c) { j += 2; continue; } break; } j++; }
      i = j + 1; continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i); if (j < 0) j = n;
      trouves.push({ genre: '--', debut: i, fin: j, texte: src.slice(i, j) });
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      const j = k < 0 ? n : k + 2;
      trouves.push({ genre: '/*', debut: i, fin: j, texte: src.slice(i, j) });
      i = j; continue;
    }
    i++;
  }
  return trouves;
}

/* Lexeur shell, YAML et TOML */
export function commentairesDiese(source, langage) {
  const src = String(source);
  const n = src.length;
  const trouves = [];
  let i = 0, guillemet = null, heredoc = null;
  const debutDeMot = (j) => j === 0 || /[\s;&|()<>]/.test(src[j - 1]);
  const debutDeValeur = (j) => j === 0 || /[\s[{,:]/.test(src[j - 1]);

  if (langage === 'sh' && src.startsWith('#!')) {
    let j = src.indexOf('\n'); if (j < 0) j = n;
    trouves.push({ genre: '#!', debut: 0, fin: j, texte: src.slice(0, j) });
    i = j;
  }

  while (i < n) {
    const c = src[i];
    if (heredoc && c === '\n') {
      let j = i + 1;
      while (j < n) {
        let k = src.indexOf('\n', j); if (k < 0) k = n;
        const ligne = src.slice(j, k);
        j = k + 1;
        if ((heredoc.tabs ? ligne.replace(/^\t+/, '') : ligne) === heredoc.fin) break;
      }
      heredoc = null; i = j; continue;
    }
    if (guillemet) {
      if (guillemet.length === 3) {
        if (src.startsWith(guillemet, i)) { i += 3; guillemet = null; continue; }
        if (guillemet === '"""' && c === '\\') { i += 2; continue; }
      } else if (c === '\\' && guillemet === '"') { i += 2; continue; }
      else if (c === guillemet) {
        if (langage === 'yaml' && c === "'" && src[i + 1] === "'") { i += 2; continue; }
        guillemet = null;
      }
      i++; continue;
    }
    if (langage === 'toml' && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      guillemet = src.slice(i, i + 3); i += 3; continue;
    }
    if (c === '"' || c === "'") {
      if (langage !== 'yaml' || debutDeValeur(i)) guillemet = c;
      i++; continue;
    }
    if (langage === 'sh' && c === '\\') { i += 2; continue; }
    if (langage === 'sh' && src.startsWith('<<', i)) {
      const m = /^<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(src.slice(i, i + 80));
      if (m) { heredoc = { fin: m[3], tabs: m[1] === '-' }; i += m[0].length; continue; }
    }
    const ouvre = c === '#' && (langage === 'toml' || (langage === 'sh' ? debutDeMot(i) : (i === 0 || /\s/.test(src[i - 1]))));
    if (ouvre) {
      let j = src.indexOf('\n', i); if (j < 0) j = n;
      trouves.push({ genre: '#', debut: i, fin: j, texte: src.slice(i, j) });
      i = j; continue;
    }
    i++;
  }
  return trouves;
}

/* Commentaires d'un fichier */
export function commentairesDe(fichier, source) {
  const langage = LANGAGES[extname(fichier).toLowerCase()];
  if (langage === 'js') return commentairesJS(source);
  if (langage === 'css') return commentairesCSS(source).map((c) => ({ genre: '/*', debut: c.debut, fin: c.fin, texte: c.texte }));
  if (langage === 'html') return commentairesHTML(source);
  if (langage === 'sql') return commentairesSQL(source);
  if (langage) return commentairesDiese(source, langage);
  return null;
}

/* Contenu lisible */
const DECOR = /^[\s\u2500-\u257f*#=~_-]+|[\s\u2500-\u257f*#=~_-]+$/g;

function contenu(c) {
  let t = c.texte;
  if (c.genre === '<!--') t = t.slice(4, t.endsWith('-->') ? -3 : undefined);
  else if (c.genre === '/*') t = t.slice(2, t.endsWith('*/') ? -2 : undefined);
  else if (c.genre === '//' || c.genre === '--') t = t.slice(2);
  else if (c.genre === '#') t = t.slice(1);
  return t.split('\n').map((l) => l.replace(DECOR, '').trim()).filter(Boolean);
}

/* Règles */
const MOTS_MAX = 6;
const MOT = (liste) => `(?<![\\p{L}\\p{N}])(?:${liste.join('|')})(?![\\p{L}\\p{N}])`;
const EXPLICATION = new RegExp(`(?<![\\p{L}\\p{N}])(?:parce qu|pour qu|lorsqu|puisqu)(?:e(?![\\p{L}\\p{N}])|['’])|${MOT([
  'pourquoi', 'afin', 'sinon', '[ée]vit(?:e|es|ent|er|é|ée|és|ées|ant)?', 'car',
  'calcul(?:e|es|ent|er|é|ée|és|ées|s)?', 'quand', 'donc', 'ainsi', 'permet\\p{L}*', 'sert', 'servent',
  'attention', 'corrig\\p{L}*', 'correct(?:ion|ions|if|ifs)', 'cass(?:e|é|ée|és|ées|es)', 'bugs?', 'fixme', 'todo', 'hack\\p{L}*',
  'contournement', 'remplac\\p{L}*', 'ancien\\p{L}*', 'd[ée]sormais', 'auparavant', 'doit', 'doivent',
  'devrait', 'faut', 'jamais', 'toujours',
  'because', 'otherwise', 'avoid\\p{L}*', 'workaround', 'legacy', 'deprecated',
])}`, 'iu');
const SI_EN_TETE = /(?:^|[,;:(]\s*|(?:m[eê]me|sauf)\s+)(?:si|s['’]ils?)(?![\p{L}\p{N}])/iu;
const INTERDITS = [
  new RegExp(MOT(['faille\\p{L}*', 'vuln[ée]rab\\p{L}*', 's[ée]curit\\p{L}*']), 'iu'),
  new RegExp(MOT(['IA', 'AI']), 'u'),
];

export function reglesEnfreintes(lignesPhysiques, lignes) {
  const t = lignes.join(' ');
  const r = [];
  if (!lignes.length) return ['vide'];
  if (lignesPhysiques > 1) r.push('multiligne');
  if (t.split(/\s+/).filter((m) => /[\p{L}\p{N}]/u.test(m)).length > MOTS_MAX) r.push('mots');
  if (/[.;](?=\s+\S)/.test(t.replace(/^\d+(\s+bis)?\.\s/, ''))) r.push('phrase');
  if (/=|→|—|->|:\s+\S/.test(t)) r.push('signe');
  if (/(?<![\p{L}\p{N}])[vV]\d+(\.\d+)*(?![\p{L}\p{N}])|\b\d+\.\d+\.\d+\b|§/u.test(t)) r.push('version');
  if (EXPLICATION.test(t) || SI_EN_TETE.test(t)) r.push('explication');
  if (INTERDITS.some((x) => x.test(t))) r.push('interdit');
  return r;
}

/* Constats d'un fichier */
export function constatsDe(fichier, source) {
  const trouves = commentairesDe(fichier, source);
  if (!trouves) return [];
  const src = String(source);
  const debuts = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') debuts.push(k + 1);
  const ligneDe = (p) => { let a = 0, b = debuts.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (debuts[m] <= p) a = m; else b = m - 1; } return a + 1; };
  const seul = (c) => !src.slice(debuts[ligneDe(c.debut) - 1], c.debut).trim();

  const blocs = [];
  for (const c of trouves.sort((a, b) => a.debut - b.debut)) {
    const ligne = ligneDe(c.debut), fin = ligneDe(Math.max(c.debut, c.fin - 1));
    const prec = blocs[blocs.length - 1];
    const parLigne = c.genre === '//' || c.genre === '#' || c.genre === '--';
    if (prec && parLigne && prec.genre === c.genre && prec.seul && seul(c) && ligne === prec.fin + 1) {
      prec.fin = ligne; prec.lignes.push(...contenu(c));
      continue;
    }
    blocs.push({ ...c, ligne, fin, seul: seul(c), lignes: contenu(c) });
  }

  const constats = [];
  for (const b of blocs) {
    if (b.genre === '#!' && b.ligne === 1) continue;
    if (b.genre === '<!--' && REPERE.test(b.texte)) continue;
    const regles = reglesEnfreintes(b.fin - b.ligne + 1, b.lignes);
    if (/GENERATED/.test(b.texte)) regles.push('repere');
    if (regles.length) constats.push({ ligne: b.ligne, regles });
  }
  return constats;
}

/* Relevé du dépôt */
export function releve(racine = RACINE) {
  const fichiers = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: racine, encoding: 'utf8' })
    .split('\n').filter((f) => f && LANGAGES[extname(f).toLowerCase()] && existsSync(join(racine, f)));
  const lignes = [];
  for (const f of [...new Set(fichiers)].sort()) {
    for (const c of constatsDe(f, readFileSync(join(racine, f), 'utf8'))) lignes.push(`${f}:${c.ligne} ${c.regles.join(',')}`);
  }
  return lignes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const lignes = releve();
  for (const l of lignes) console.log(l);
  console.log(`\n${lignes.length} commentaire(s) hors règle\n`);
  if (process.argv.includes('--strict') && lignes.length) {
    console.error(`Contrôle des commentaires en échec : ${lignes.length} commentaire(s).`);
    process.exit(1);
  }
}
