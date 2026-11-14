/* Règles de lecture du CSS */

export const NOM_CLASSE = /\.(-?[_a-zA-Z][-\w]*)/g;

export function nomsDeClasses(texte) {
  return [...String(texte).matchAll(NOM_CLASSE)].map((m) => m[1]);
}

/* Bibliothèques tierces */
const TIERS = [/^leaflet/, /^flatpickr/];

export const estTiers = (nom) => TIERS.some((r) => r.test(nom));

/* Commentaires d'une feuille */
export function commentairesCSS(source) {
  const src = String(source);
  const trouves = [];
  let etat = 'css', ligne = 1, i = 0, ouvert = null;
  while (i < src.length) {
    if (src[i] === '\n') ligne++;
    if (etat === 'css') {
      if (src.startsWith('/*', i)) { ouvert = { ligne, debut: i }; etat = 'commentaire'; i += 2; continue; }
      if (src[i] === '"' || src[i] === "'") { etat = src[i]; i += 1; continue; }
    } else if (etat === 'commentaire') {
      if (src.startsWith('*/', i)) {
        trouves.push({ ...ouvert, fin: i + 2, texte: src.slice(ouvert.debut, i + 2), ferme: true });
        ouvert = null; etat = 'css'; i += 2; continue;
      }
    } else {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === etat) etat = 'css';
    }
    i++;
  }
  if (ouvert) trouves.push({ ...ouvert, fin: src.length, texte: src.slice(ouvert.debut), ferme: false });
  return trouves;
}

export function commentairesNonFermes(source) {
  return commentairesCSS(source).filter((c) => !c.ferme).map((c) => c.ligne);
}

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

/* Classes manipulées par un script */
export function classesManipulees(source) {
  const src = String(source);
  const trouvees = new Set();
  const ajouter = (texte) => { for (const c of String(texte).split(/\s+/)) if (c) trouvees.add(c); };

  /* classList */
  for (const m of src.matchAll(/classList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) ajouter(s[1]);
  }

  /* className */
  for (const m of src.matchAll(/\.className\s*\+?=\s*([^;\n]+)/g)) {
    for (const s of m[1].matchAll(/['"`]([^'"`]*)['"`]/g)) ajouter(s[1]);
  }

  /* Sélecteur dans une chaîne */
  for (const m of src.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
    if (!m[1].includes('.')) continue;
    for (const nom of nomsDeClasses(m[1])) trouvees.add(nom);
  }

  /* HTML fabriqué */
  for (const m of src.matchAll(/class=\\?["']([^"'\\]+)\\?["']/g)) ajouter(m[1]);

  return trouvees;
}

/* Classes propres à une bibliothèque */
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
