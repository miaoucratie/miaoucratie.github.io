/**
 * Controle redactionnel du site Miaoucratie.
 *
 *   node qa/redaction.mjs            liste les constats
 *   node qa/redaction.mjs --strict   sort en erreur s'il reste un interdit
 *
 * Pourquoi ce fichier : certaines formulations ont ete explicitement bannies,
 * et une regle qui repose sur la memoire finit toujours par etre oubliee. Un
 * controle qui rend un chiffre, non. Chaque nouvelle interdiction s'ajoute
 * ici, pas dans une note.
 *
 * INTERDIT  : fait echouer le controle. Tolerance zero.
 * A VERIFIER: signale sans faire echouer. Le mot peut etre legitime selon le
 *             contexte, mais il est rare sous la plume d'Irina.
 *
 * Aucune dependance : le site est en HTML statique.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
/* « maquette-*.html » : pages de travail, ignorees par Git, jamais publiees.
   Elles n'ont pas a etre auditees comme des pages du site. */
const EXCLUES = new Set(['admin-indisponibilites.html', 'cgv.html', 'mentions-legales.html']);

/* ── Formulations bannies ────────────────────────────────────────────────
   Chaque entree porte la raison, pour qu'on sache pourquoi elle est la. */
const INTERDIT = [
  [/chez (mes|vos) chats/gi, 'La selection ne se resume pas aux chats d\'Irina ni a ceux des clients'],
  [/ce que j'emporte chez/gi, 'Faux : elle n\'emporte pas tout en visite'],
  [/je ne vends ni/gi, 'On ne se definit pas par ce qu\'on ne vend pas'],
  [/ce que vaut cet article/gi, 'Poser la question revient a admettre que l\'article pourrait ne rien valoir'],
  [/\d+\s*(sources?|references?)\b(?![^<]*<\/li>)/gi, 'Ne jamais afficher un nombre de sources'],
  [/\d+\s*min de lecture/gi, 'Compteur qui devient faux des que le texte change'],
  [/\b\d+ objets? et \d+ lectures?/gi, 'Compteur qui devient faux des qu\'un produit entre ou sort'],
  [/—/g, 'Tiret cadratin : signature d\'ecriture automatique, absent de la charte'],
  /* Le reste du tableau 6.19, qui n'etait pas outille. Chaque motif est ecrit
     assez large pour attraper la variante, pas seulement la phrase d'origine :
     « ceux qui passent en famille d'accueil » avait survecu parce que la liste
     ne connaissait que « chez ceux qui passent ». */
  [/pass(e|ent|ait|aient)\s+en famille d'accueil/gi, 'Un chat ne « passe » pas en famille d\'accueil'],
  [/sur mes gardes/gi, 'Ne sonne pas humain, ce n\'est pas sa voix'],
  [/produits sont adopt/gi, 'Adoptes par qui : la phrase ne veut rien dire ici'],
  [/ce qu'ils usent/gi, 'Formule artificielle'],
  [/une partie des choses que j'utilise/gi, 'Ni attractif, ni precis'],
  [/pour etre reproduit chez vous|pour être reproduit chez vous/gi, 'Le lecteur n\'a rien a reproduire'],
  [/voici comment je m'y prends/gi, 'Recentre inutilement sur elle'],
  [/chats nourris au commerce/gi, 'Maladroit au point d\'etre incomprehensible'],
  [/j'applique chez les chats/gi, 'Elle va chez eux, ils ne vivent pas chez elle'],
  [/cette grille reste utile/gi, 'Pose sa grille en reference'],
  [/certains liens sont affili/gi, 'Factuellement faux : tous les liens Amazon le sont'],
  [/qui ecrit\s*\?|qui écrit\s*\?/gi, 'Exces de zele, hors sujet'],
  [/la science du chat en clair/gi, 'Presomptueux'],
  [/aucun chat ne sert de test|sert de test/gi, 'Presenter un chat comme servant de test est pejoratif'],
];

/* Libelles de bouton.
   On ne bannit pas un verbe : « Reserver une garde » et « Lire l'article sur
   Ouest-France » sont de bons libelles, concrets, et ce sont ceux du site.
   On bannit les libelles GENERIQUES, ceux qui ne disent rien de la destination.
   La liste est exacte, pas un prefixe, pour ne pas produire de faux positifs. */
const CTA_GENERIQUE = new Set([
  'voir', 'voir plus', "voir l'article", 'voir le produit', 'voir sur amazon',
  'ouvrir', "ouvrir l'article", 'en savoir plus', 'decouvrir', 'découvrir',
  'cliquez ici', 'cliquer ici', "lire l'article", 'lire la suite', 'lire plus',
  'parcourir', 'apprendre', 'trouver', 'revenir au blog', 'verifier', 'vérifier',
  'acceder', 'accéder', 'consulter', 'explorer', 'continuer', 'suite',
]);
const MOTS_MAX = 4;

/* Injonction d'achat.
   « Aucune injonction du type "Commandez...". On ne dit jamais au lecteur de
   commander quoi que ce soit. » Les verbes de service du site — reserver une
   garde, prendre contact — restent la convention validee : ils declenchent une
   action chez Miaoucratie, pas un achat chez un tiers. Ce sont les verbes
   d'achat qui sont bannis, a l'infinitif comme a l'imperatif. */
const CTA_INJONCTION = /^(command|achet|acquer|profit)/i;

/* Associations indissociables.
   Un retour a la ligne ne doit jamais separer une valeur de son unite, un
   guillemet du mot qu'il ouvre, ni une ponctuation double du mot qui la
   precede. « 10 » en fin de ligne et « % » au debut de la suivante est un
   defaut, pas une fatalite : il se corrige a la source avec une espace
   insecable. Le controle cherche les espaces ORDINAIRES dans ces positions. */
const PAGES_BLOG = new Set(['coulisses-miaoucratie.html', 'etiquette-nourriture-chat.html', 'croquettes-et-patee.html', 'ce-que-jutilise.html']);
const INSECABLES = [
  [/(\d) (%)/g, 'une valeur et son pourcentage peuvent se retrouver sur deux lignes'],
  /* « 3 L'eau » n'est pas trois litres : c'est le numero d'une etape suivi
     d'un mot. L'apostrophe exclut le cas. */
  [/(\d) (g|kg|mg|ml|cl|L|kcal|cm|mm|km|h|min|€|\$)(?![\wéèêà'’])/g, 'une valeur et son unite peuvent se retrouver sur deux lignes'],
  [/(\d) (ans?|mois|jours?|semaines?|heures?|minutes?|secondes?|fois|chats?|chatons?|tubes?|croquettes?|adultes?|animaux)\b/g, 'une valeur et ce qu\'elle compte peuvent se retrouver sur deux lignes'],
  [/« /g, 'un guillemet ouvrant peut rester seul en fin de ligne'],
  [/ »/g, 'un guillemet fermant peut passer seul a la ligne'],
  [/ ([:;!?])/g, 'une ponctuation double peut passer seule a la ligne'],
];

/* Mots rares sous sa plume : 1 a 4 occurrences sur 23 204 mots de corpus. */
const A_VERIFIER = [
  [/\bfranchement\b/gi, '1 occurrence dans tout son corpus'],
  [/\b[ée]videmment\b/gi, '1 occurrence'],
  [/\ben revanche\b/gi, '4 occurrences'],
  [/\bpourtant\b/gi, '1 occurrence'],
  [/\bdu coup\b/gi, '3 occurrences'],
  [/ce n'est pas [^.]{3,60}, c'est /gi, '2 occurrences : structure a ne pas systematiser'],
  [/\bvoici (ce que|comment|les)\b/gi, 'Phrase qui annonce au lieu de dire'],
  [/\bil est important de\b|\bil convient de\b|\bnotons que\b|\ben effet\b|\bpar ailleurs\b/gi, 'Transition creuse'],
];

/* L'espace insecable est conservee telle quelle, en U+00A0, et non ramenee a
   une espace ordinaire : c'est precisement la difference que le controle des
   coupures doit voir. La replier ici reviendrait a signaler comme fautives
   toutes les insecables deja posees. */
const texteVisible = (html) => {
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
  /* Bloquant sur les pages du blog, ou la correction est faite et garantie.
     Signale seulement ailleurs : les sept autres pages sont hors du perimetre
     du chantier, et le meme traitement s'y applique le jour ou Irina le
     demande — le script est ecrit et teste, il tourne en une commande. */
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
    if (CTA_GENERIQUE.has(nu)) noter(page, 'INTERDIT', lib, 'libelle de bouton', 'Libelle generique : il ne dit rien de la destination');
    if (lib.includes(',')) noter(page, 'INTERDIT', lib, 'libelle de bouton', 'Aucune virgule dans un libelle de bouton');
    if (CTA_INJONCTION.test(nu)) noter(page, 'INTERDIT', lib, 'libelle de bouton', "Injonction d'achat : on n'ecrit jamais au lecteur de commander");
    const nbMots = lib.split(/\s+/).length;
    if (nbMots > MOTS_MAX) noter(page, 'A VERIFIER', lib, 'libelle de bouton', `${nbMots} mots, la norme du site est 3`);
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
