/**
 * Les regles de lecture du CSS, sans effet de bord.
 *
 * Pourquoi ce fichier separe : `css.mjs` lit le dossier et ecrit sur la sortie
 * des son import, ce qui le rend intestable. Les fonctions qui decident — un
 * commentaire est-il ferme, ce mot est-il un nom de classe, ce script
 * manipule-t-il cette classe — sont pures. Les sortir ici les rend testables
 * une par une, et `css-regles.test.js` fige les quatre erreurs qu'elles ont
 * deja produites.
 *
 * Aucune dependance, aucune lecture de fichier : on passe du texte, on rend
 * une valeur.
 */

/**
 * Un nom de classe CSS ne commence jamais par un chiffre.
 *
 * Sans cette contrainte, « @media (max-width: 63.99rem) » declare une classe
 * « 99rem » et « padding: 0.5rem » une classe « 5rem ». Le motif sert aux deux
 * recoupements de `css.mjs` : les deux sens doivent compter de la meme facon,
 * sinon ils se contredisent sur les memes classes.
 *
 * Le motif porte le drapeau `g` : `matchAll` l'exige. Un motif global garde un
 * `lastIndex`, mais `matchAll` travaille sur une copie — le reutiliser d'un
 * appel a l'autre est donc sans danger, contrairement a `test` ou `exec`.
 */
export const NOM_CLASSE = /\.(-?[_a-zA-Z][-\w]*)/g;

/** Noms de classes d'un texte quelconque, dans l'ordre de lecture. */
export function nomsDeClasses(texte) {
  return [...String(texte).matchAll(NOM_CLASSE)].map((m) => m[1]);
}

/**
 * Bibliotheques qui posent leurs propres classes et apportent leur feuille :
 * ni a declarer ni a poser de notre cote.
 */
const TIERS = [/^h-captcha/, /^hcaptcha/, /^leaflet/, /^flatpickr/];

export const estTiers = (nom) => TIERS.some((r) => r.test(nom));

/**
 * Commentaires ouverts et jamais fermes, par numero de ligne.
 *
 * Compter les « slash-etoile » et les « etoile-slash » du texte et comparer les
 * deux totaux ne marche pas : CSS n'imbrique pas les commentaires, donc une
 * ouverture ecrite DANS un commentaire n'ouvre rien, mais gonfle le total.
 * `article.css` portait ainsi un desequilibre permanent de 3 — trois bannieres
 * de section non terminees, chacune suivie d'un commentaire ordinaire — alors
 * que ses 146 commentaires sont tous fermes et qu'aucune accolade n'est avalee.
 * Un avertissement qui ne disparait jamais est un avertissement qu'on apprend
 * a ignorer.
 *
 * Les chaines sont suivies elles aussi : une ouverture dans « content: '/*' »
 * n'ouvre pas de commentaire.
 */
export function commentairesNonFermes(source) {
  const src = String(source);
  const ouverts = [];
  let etat = 'css', ligne = 1, i = 0;
  while (i < src.length) {
    if (src[i] === '\n') ligne++;
    if (etat === 'css') {
      if (src.startsWith('/*', i)) { ouverts.push(ligne); etat = 'commentaire'; i += 2; continue; }
      if (src[i] === '"' || src[i] === "'") { etat = src[i]; i += 1; continue; }
    } else if (etat === 'commentaire') {
      if (src.startsWith('*/', i)) { ouverts.pop(); etat = 'css'; i += 2; continue; }
    } else {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === etat) etat = 'css';
    }
    i++;
  }
  return ouverts;
}

/**
 * Selecteurs de premier niveau d'une feuille, commentaires retires.
 *
 * On ne descend pas dans les blocs : ce qui est a l'interieur est une
 * declaration, pas un selecteur, et « padding: 0.5rem » y ressemblerait a une
 * classe.
 */
export function selecteursDePremierNiveau(feuille) {
  const css = String(feuille).replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [];
  let tampon = '', prof = 0;
  for (const c of css) {
    if (c === '{') { if (prof === 0) sels.push(tampon.trim()); prof++; tampon = ''; }
    else if (c === '}') { prof = Math.max(0, prof - 1); tampon = ''; }
    else tampon += c;
  }
  return sels;
}

/**
 * Classes qu'un script manipule : ce sont des points d'accroche, ils n'ont
 * aucune raison de porter une regle CSS.
 *
 * On ne retient que les positions ou un nom de classe en est vraiment un.
 * Relever tous les mots du fichier laissait la moindre variable dedouaner une
 * classe morte du meme nom : « grille » est une variable de `carrousel.js`, et
 * cela suffisait a excuser la classe morte « grille » d'une page.
 *
 * Les quatre positions retenues sont celles que le site utilise reellement,
 * relevees en lisant ses six fichiers servis en entier.
 */
export function classesManipulees(source) {
  const src = String(source);
  const trouvees = new Set();
  const ajouter = (texte) => { for (const c of String(texte).split(/\s+/)) if (c) trouvees.add(c); };

  /* element.classList.add('x', 'y') */
  for (const m of src.matchAll(/classList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) ajouter(s[1]);
  }

  /* element.className = ... : toute l'expression, pas seulement une chaine
     collee au signe egal. « part.className = couvert ? "a" : "b" » pose deux
     classes, et un motif qui n'accepte qu'une chaine immediate les rate. */
  for (const m of src.matchAll(/\.className\s*\+?=\s*([^;\n]+)/g)) {
    for (const s of m[1].matchAll(/['"`]([^'"`]*)['"`]/g)) ajouter(s[1]);
  }

  /* un selecteur de classe dans une chaine : querySelector('.x'), closest('.x') */
  for (const m of src.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
    if (!m[1].includes('.')) continue;
    for (const nom of nomsDeClasses(m[1])) trouvees.add(nom);
  }

  /* du HTML fabrique dans une chaine : innerHTML = '<p class="x">' */
  for (const m of src.matchAll(/class=\\?["']([^"'\\]+)\\?["']/g)) ajouter(m[1]);

  return trouvees;
}

/**
 * Classes qui n'apparaissent JAMAIS dans un selecteur autrement qu'a cote
 * d'une classe tierce : elles appartiennent a cette bibliotheque.
 *
 * Une bibliotheque ne prefixe pas toujours tout. Flatpickr pose
 * « .numInputWrapper », « .cur-year », « .startRange », « .selected » — aucun
 * prefixe, et pourtant rien de nous. Le critere n'est donc pas le nom mais la
 * compagnie. Une liste ecrite a la main aurait vieilli au premier ajout.
 */
export function classesDeBibliotheque(selecteurs) {
  const toujoursAccompagnee = new Map();
  for (const s of selecteurs) {
    const noms = nomsDeClasses(s);
    const cotoieUnTiers = noms.some(estTiers);
    for (const n of noms) {
      if (estTiers(n)) continue;
      toujoursAccompagnee.set(n, (toujoursAccompagnee.get(n) ?? true) && cotoieUnTiers);
    }
  }
  const res = new Set();
  for (const [n, toujours] of toujoursAccompagnee) if (toujours) res.add(n);
  return res;
}
