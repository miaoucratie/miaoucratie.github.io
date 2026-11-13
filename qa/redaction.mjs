/**
 * Controle redactionnel.
 *
 *   node qa/redaction.mjs            liste les constats
 *   node qa/redaction.mjs --strict   sort en erreur s'il reste un interdit
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Pages exclues */
const EXCLUES = new Set(['admin-indisponibilites.html', 'cgv.html', 'mentions-legales.html']);

/* ── Formulations bannies ── */
export const INTERDIT = [
  [/chez (mes|vos) chats/gi, 'Formulation refusee'],
  [/ce que j'emporte chez/gi, 'Formulation refusee'],
  [/je ne vends ni/gi, 'Formulation refusee'],
  [/ce que vaut cet article/gi, 'Formulation refusee'],
  [/\d+\s*(sources?|references?)\b(?![^<]*<\/li>)/gi, 'Nombre de sources'],
  [/\d+\s*min de lecture/gi, 'Compteur'],
  [/\b\d+ objets? et \d+ lectures?/gi, 'Compteur'],
  [/—/g, 'Tiret cadratin'],
  [/pass(e|ent|ait|aient)\s+en famille d'accueil/gi, 'Formulation refusee'],
  [/sur mes gardes/gi, 'Formulation refusee'],
  [/produits sont adopt/gi, 'Formulation refusee'],
  [/ce qu'ils usent/gi, 'Formulation refusee'],
  [/une partie des choses que j'utilise/gi, 'Formulation refusee'],
  [/pour etre reproduit chez vous|pour être reproduit chez vous/gi, 'Formulation refusee'],
  [/voici comment je m'y prends/gi, 'Formulation refusee'],
  [/chats nourris au commerce/gi, 'Formulation refusee'],
  [/j'applique chez les chats/gi, 'Formulation refusee'],
  [/cette grille reste utile/gi, 'Formulation refusee'],
  [/certains liens sont affili/gi, 'Formulation refusee'],
  [/qui ecrit\s*\?|qui écrit\s*\?/gi, 'Formulation refusee'],
  [/la science du chat en clair/gi, 'Formulation refusee'],
  [/aucun chat ne sert de test|sert de test/gi, 'Formulation refusee'],
  [/\b(pas|ni|sans [eê]tre)\s+(une?\s+)?psy(chologue|chiatre)?\b/gi, 'Formulation refusee'],
  [/th[ée]rapeute/gi, 'Formulation refusee'],
];

/* Libelles de bouton */
const CTA_GENERIQUE = new Set([
  'voir', 'voir plus', "voir l'article", 'voir le produit', 'voir sur amazon',
  'ouvrir', "ouvrir l'article", 'en savoir plus', 'decouvrir', 'découvrir',
  'cliquez ici', 'cliquer ici', "lire l'article", 'lire la suite', 'lire plus',
  'parcourir', 'apprendre', 'trouver', 'revenir au blog', 'verifier', 'vérifier',
  'acceder', 'accéder', 'consulter', 'explorer', 'continuer', 'suite',
]);
const MOTS_MAX = 4;

/* Injonction d'achat */
const CTA_INJONCTION = /^(command|achet|acquer|profit)/i;

/* Insecables */
const PAGES_BLOG = new Set(['coulisses-miaoucratie.html', 'etiquette-nourriture-chat.html', 'croquettes-et-patee.html', 'ce-que-jutilise.html']);
const INSECABLES = [
  [/(\d) (%)/g, 'Insecable manquante'],
  /* Numero d'etape exclu */
  [/(\d) (g|kg|mg|ml|cl|L|kcal|cm|mm|km|h|min|€|\$)(?![\wéèêà'’])/g, 'Insecable manquante'],
  [/(\d) (ans?|mois|jours?|semaines?|heures?|minutes?|secondes?|fois|chats?|chatons?|tubes?|croquettes?|adultes?|animaux)\b/g, 'Insecable manquante'],
  [/« /g, 'Insecable manquante'],
  [/ »/g, 'Insecable manquante'],
  [/ ([:;!?])/g, 'Insecable manquante'],
];

/* Mots rares */
const A_VERIFIER = [
  [/\bfranchement\b/gi, 'Mot rare'],
  [/\b[ée]videmment\b/gi, 'Mot rare'],
  [/\ben revanche\b/gi, 'Mot rare'],
  [/\bpourtant\b/gi, 'Mot rare'],
  [/\bdu coup\b/gi, 'Mot rare'],
  [/ce n'est pas [^.]{3,60}, c'est /gi, 'Structure repetee'],
  [/\bvoici (ce que|comment|les)\b/gi, 'Phrase qui annonce'],
  [/\bil est important de\b|\bil convient de\b|\bnotons que\b|\ben effet\b|\bpar ailleurs\b/gi, 'Transition creuse'],
];

/* Texte visible */
export const texteVisible = (html) => {
  const corps = html.slice(html.indexOf('<body'));
  return corps
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/⁠/g, '')
    .replace(/[^\S ]+/g, ' ');
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const pages = readdirSync(RACINE).filter((f) => f.endsWith('.html') && !f.startsWith('maquette-') && !EXCLUES.has(f)).sort();

  let interdits = 0, aVerifier = 0;
  const parPage = new Map();
  const noter = (page, gravite, motif, extrait, raison) => {
    if (!parPage.has(page)) parPage.set(page, []);
    parPage.get(page).push({ gravite, motif, extrait, raison });
    if (gravite === 'INTERDIT') interdits++; else aVerifier++;
  };

  for (const page of pages) {
    const html = readFileSync(join(RACINE, page), 'utf8');
    const txt = texteVisible(html);

    for (const [re, raison] of INTERDIT) {
      for (const m of txt.matchAll(re)) {
        const d = Math.max(0, m.index - 40);
        noter(page, 'INTERDIT', m[0].trim(), '…' + txt.slice(d, m.index + m[0].length + 40).trim() + '…', raison);
      }
    }
    /* Bloquant sur le blog */
    for (const [re, raison] of INSECABLES) {
      for (const m of txt.matchAll(re)) {
        const d = Math.max(0, m.index - 40);
        noter(page, PAGES_BLOG.has(page) ? 'INTERDIT' : 'A VERIFIER', m[0].trim(),
          '…' + txt.slice(d, m.index + m[0].length + 40).trim() + '…', raison);
      }
    }
    for (const [re, raison] of A_VERIFIER) {
      for (const m of txt.matchAll(re)) {
        const d = Math.max(0, m.index - 40);
        noter(page, 'A VERIFIER', m[0].trim(), '…' + txt.slice(d, m.index + m[0].length + 40).trim() + '…', raison);
      }
    }

    /* Libelles de bouton */
    for (const m of html.matchAll(/<(a|span|button)[^>]*class="[^"]*(btn-primary|cq-ghost)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const lib = m[3].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (!lib) continue;
      const nu = lib.toLowerCase().replace(/\s+/g, ' ').trim();
      if (CTA_GENERIQUE.has(nu)) noter(page, 'INTERDIT', lib, 'libelle de bouton', 'Libelle generique');
      if (lib.includes(',')) noter(page, 'INTERDIT', lib, 'libelle de bouton', 'Virgule dans un bouton');
      if (CTA_INJONCTION.test(nu)) noter(page, 'INTERDIT', lib, 'libelle de bouton', "Injonction d'achat");
      const nbMots = lib.split(/\s+/).length;
      if (nbMots > MOTS_MAX) noter(page, 'A VERIFIER', lib, 'libelle de bouton', 'Libelle trop long');
    }
  }

  console.log(`\nControle redactionnel — ${pages.length} pages\n`);
  if (parPage.size === 0) {
    console.log('  Aucun constat.\n');
  } else {
    for (const [page, liste] of [...parPage].sort()) {
      console.log(`  ${page}`);
      for (const c of liste) {
        console.log(`    ${c.gravite === 'INTERDIT' ? '✗' : '!'} « ${c.motif} » — ${c.raison}`);
        console.log(`        ${c.extrait}`);
      }
      console.log('');
    }
  }
  console.log(`  ${interdits} interdit(s), ${aVerifier} a verifier\n`);

  if (process.argv.includes('--strict') && interdits > 0) {
    console.error(`Controle redactionnel en echec : ${interdits} formulation(s) interdite(s).`);
    process.exit(1);
  }
}
