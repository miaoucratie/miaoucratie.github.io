/* Harnais et pages séparés */

import { execFileSync } from 'node:child_process';

/* Classement des fichiers */
export function classerFichiers(fichiers) {
  const harnais = fichiers.filter((f) => (f.startsWith('qa/') && !['qa/reference.json', 'qa/exceptions-css.json'].includes(f)) || f.startsWith('.github/'));
  const site = fichiers.filter((f) => /\.html$/.test(f) || /^(css|js|shared|images|scripts|data|gabarit)\//.test(f));
  return { harnais, site, melange: harnais.length > 0 && site.length > 0 };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const base = process.argv[2] || 'origin/main';
  const fichiers = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const { harnais, site, melange } = classerFichiers(fichiers);
  if (melange) {
    console.error(`Cette PR touche le harnais (${harnais.join(', ')}) et le site (${site.join(', ')}) : une PR pour chacun.`);
    process.exit(1);
  }
  console.log(`Harnais et site séparés : ${harnais.length} fichier(s) de harnais, ${site.length} fichier(s) du site.`);
}
