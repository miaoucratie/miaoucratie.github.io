/* Données de la FAQ */

const ENTITES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', hellip: '…', laquo: '«', raquo: '»', ndash: '–' };

/* Texte lisible */
export function texteAffiche(html) {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/(p|li|div|h\d|ul|ol)>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m)
    .replace(/[\s  ]+/g, ' ')
    .trim();
}

/* Bloc div complet */
function blocDiv(html, debut) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = debut;
  let profondeur = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    profondeur += m[0] === '</div>' ? -1 : 1;
    if (profondeur === 0) return html.slice(debut, m.index + 6);
  }
  return null;
}

/* Questions et réponses */
export function questionsFaq(html) {
  const paires = [];
  const re = /<div class="acc-item"[^>]*>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const item = blocDiv(html, m.index);
    if (!item) throw new Error('question de la FAQ mal fermée');
    const q = item.match(/<span class="acc-question">([\s\S]*?)<\/span>/);
    const i = item.indexOf('<div class="acc-content">');
    if (!q || i === -1) throw new Error('question de la FAQ sans intitulé ou sans réponse');
    paires.push({ question: texteAffiche(q[1]), reponse: texteAffiche(blocDiv(item, i)) });
  }
  return paires;
}

/* Bloc pour Google */
export function blocFaq(html) {
  const donnees = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questionsFaq(html).map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.reponse },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(donnees, null, 2)}\n</script>`;
}
