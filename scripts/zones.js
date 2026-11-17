/* Zones générées entre repères */

export function remplacerZone(texte, nom, contenu) {
  const debut = `<!-- GENERATED:${nom}:START -->`;
  const fin = `<!-- GENERATED:${nom}:END -->`;
  const nbD = texte.split(debut).length - 1;
  const nbF = texte.split(fin).length - 1;
  if (nbD !== 1 || nbF !== 1) {
    return { erreur: `marqueur ${nom} ambigu : ${nbD} balise(s) START et ${nbF} balise(s) END, il en faut exactement une de chaque` };
  }
  const i = texte.indexOf(debut);
  const j = texte.indexOf(fin);
  if (j < i) return { erreur: `marqueur ${nom} : END apparait avant START` };
  const avant = texte.slice(0, i + debut.length);
  const apres = texte.slice(j);
  /* Fin de ligne du fichier */
  const saut = texte.includes('\r\n') ? '\r\n' : '\n';
  const bloc = (contenu.trimEnd() + '\n').replace(/\r?\n/g, saut);
  const nouveau = avant + saut + bloc + apres;
  return { texte: nouveau, change: nouveau !== texte };
}
