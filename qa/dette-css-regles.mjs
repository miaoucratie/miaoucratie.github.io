/* Classement du CSS mort */

import { reglesCSS } from './css-regles.mjs';

/* Relevé dans la page */
export const RELEVE = (exclues) => {
  const out = { vues: [], visees: [], utiles: [], exclues: [] };
  const coupe = (texte, sep) => {
    const liste = [];
    let prof = 0, tampon = '';
    for (const c of texte) {
      if (c === '(') prof++;
      if (c === ')') prof--;
      if (c === sep && !prof) { liste.push(tampon); tampon = ''; } else tampon += c;
    }
    return [...liste, tampon];
  };
  const tous = [...document.querySelectorAll('*')];

  /* Déclarations telles qu'écrites dans la feuille */
  const net = (t) => t.replace(/(^|[\s,>+~(])\*(?=[:.[#])/g, '$1').replace(/\s+/g, '').replace(/'/g, '"')
    .replace(/\[([\w-]+)([~|^$*]?=)([^"\]]+)\]/g, '[$1$2"$3"]').replace(/(^|[^:]):(before|after|first-line|first-letter)\b/g, '$1::$2');
  const noms = (corps) => coupe(corps, ';').filter((d) => d.includes(':')).map((d) => {
    const n = d.slice(0, d.indexOf(':')).trim();
    return n.startsWith('--') ? n : n.toLowerCase();
  }).filter(Boolean);
  const declarations = (corps) => coupe(corps, ';').filter((d) => d.includes(':')).map((d) => {
    const nom = d.slice(0, d.indexOf(':')).trim();
    const valeur = d.slice(d.indexOf(':') + 1).trim();
    return `${nom}: ${valeur}`;
  });
  const lireSource = (texte) => {
    const css = texte.replace(/\/\*[\s\S]*?\*\//g, '');
    const liste = [], pile = [];
    let tampon = '', prof = 0;
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (c === '"' || c === "'") { const f = css.indexOf(c, i + 1); tampon += css.slice(i, f < 0 ? css.length : f + 1); i = f < 0 ? css.length : f; continue; }
      if (c === '(') prof++;
      if (c === ')') prof--;
      if (c === '{' && !prof) { pile.push({ tete: tampon.trim(), corps: '' }); tampon = ''; continue; }
      if (c === '}' && !prof) {
        const b = pile.pop();
        if (b) {
          b.corps += tampon;
          if (!b.tete.startsWith('@') && !pile.some((p) => /^@(-webkit-)?(keyframes|font-face)/.test(p.tete))) {
            const ctx = pile.filter((p) => p.tete.startsWith('@')).map((p) => net(p.tete.replace(/^@(media|supports)/, ''))).join('>');
            liste.push({ cle: `${ctx}|${net(b.tete)}`, ecrites: noms(b.corps), texte: declarations(b.corps) });
          }
        }
        tampon = '';
        continue;
      }
      if (c === ';' && !prof) { if (pile.length) pile[pile.length - 1].corps += `${tampon};`; tampon = ''; continue; }
      tampon += c;
    }
    return liste;
  };
  const sourceDe = (s) => {
    if (s.ownerNode?.tagName === 'STYLE') return s.ownerNode.textContent;
    try { const x = new XMLHttpRequest(); x.open('GET', s.href, false); x.send(); return x.status === 200 ? x.responseText : ''; } catch { return ''; }
  };
  const sources = new Map();
  const ecritesDe = (feuille, ctxNet, r) => {
    const src = sources.get(feuille);
    const cle = `${ctxNet}|${net(r.selectorText)}`;
    for (let j = src.curseur; j < src.liste.length; j++) {
      if (src.liste[j].cle === cle) { src.curseur = j + 1; return src.liste[j]; }
    }
    return { ecrites: noms(r.style.cssText), texte: null, ajoutee: true };
  };

  /* Propriétés réelles derrière un nom écrit */
  const longues = new Map();
  const longuesDe = (nom) => {
    if (!longues.has(nom)) { const t = document.createElement('div').style; t.setProperty(nom, 'initial'); longues.set(nom, [...t]); }
    return longues.get(nom);
  };

  const finir = () => document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.cancel(); } });
  /* Replis hors bloc @supports */
  const replis = new Map();
  const noterReplis = (regles, feuille, cond) => {
    for (const r of regles) {
      if (r instanceof CSSSupportsRule) noterReplis(r.cssRules, feuille, r.conditionText);
      else if (r.cssRules && !(r instanceof CSSStyleRule)) noterReplis(r.cssRules, feuille, cond);
      else if (cond && r instanceof CSSStyleRule) for (const l of r.style) replis.set(`${feuille}|${r.selectorText}|${l}`, cond);
    }
  };
  const AJOUTEE = 'règle ajoutée par un script, absente du fichier';
  const exclusion = (sel) => (/::-webkit-|::-moz-/.test(sel) ? 'pseudo-élément propre au navigateur, non mesurable' : /calculateur-page/.test(sel) ? 'règle du calculateur, page appelée à disparaître' : null);
  const parcourir = (regles, feuille, ctx, ctxNet) => {
    for (const r of regles) {
      if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule) {
        const actif = r instanceof CSSMediaRule ? matchMedia(r.conditionText).matches : CSS.supports(r.conditionText);
        const c = `${ctx}@${r instanceof CSSMediaRule ? 'media' : 'supports'} ${r.conditionText} { `;
        const cn = ctxNet ? `${ctxNet}>${net(r.conditionText)}` : net(r.conditionText);
        if (actif) { parcourir(r.cssRules, feuille, c, cn); continue; }
        const noter = (rs, cc, ccn) => {
          for (const x of rs) {
            if (x instanceof CSSStyleRule) {
              const { ecrites: ex, ajoutee: aj } = ecritesDe(feuille, ccn, x);
              const raison = aj ? AJOUTEE : exclusion(x.selectorText);
              for (const p of ex) {
                const k = `${feuille} | ${cc}${x.selectorText} | ${p}`;
                if (raison) out.exclues.push(`${k} | ${raison}`);
                else if (!longuesDe(p).length) out.exclues.push(`${k} | propriété inconnue de ce navigateur`);
                else out.vues.push(k);
              }
            } else if (x.cssRules) noter(x.cssRules, `${cc}@${x instanceof CSSMediaRule ? 'media' : 'supports'} ${x.conditionText} { `, `${ccn}>${net(x.conditionText)}`);
          }
        };
        noter(r.cssRules, c, cn);
        continue;
      }
      if (!(r instanceof CSSStyleRule)) continue;
      const sel = r.selectorText;
      const horsParentheses = (s, re) => { let prof = 0, sortie = ''; for (const morceau of s.split(/([()])/)) { if (morceau === '(') prof++; if (morceau === ')') prof--; sortie += prof === 0 && morceau !== ')' ? morceau.replace(re, '') : morceau; } return sortie; };
      /* Sélecteurs et pseudo-éléments */
      const parties = coupe(sel, ',').map((s) => ({
        pseudo: (s.match(/::?(before|after|marker|placeholder)\b/) || [])[1] || null,
        base: horsParentheses(s.replace(/::?(before|after|marker|placeholder|first-letter|first-line|selection)\b/g, ''), /:(hover|focus-visible|focus-within|focus|active)\b/g).trim() || '*',
      }));
      const base = parties.map((p) => p.base).join(', ');
      const { ecrites, texte: ecritesTexte, ajoutee } = ecritesDe(feuille, ctxNet, r);
      const raison = ajoutee ? AJOUTEE : exclusion(sel);
      let cibles;
      try { cibles = [...document.querySelectorAll(base.trim() || '*')]; } catch { cibles = []; }
      const presentes = new Set([...r.style]);
      ecrites.forEach((prop, rang) => {
        const cle = `${feuille} | ${ctx}${sel} | ${prop}`;
        if (raison) { out.exclues.push(`${cle} | ${raison}`); return; }
        const repli = ctx.includes('@supports') ? null : longuesDe(prop).map((l) => replis.get(`${feuille}|${sel}|${l}`)).find(Boolean);
        if (repli) { out.exclues.push(`${cle} | repli pour les navigateurs sans « ${repli} »`); return; }
        if (/^-(webkit|moz|ms)-/.test(prop) && ecrites.includes(prop.replace(/^-(webkit|moz|ms)-/, ''))) { out.exclues.push(`${cle} | préfixe de secours pour un autre navigateur`); return; }
        if (!longuesDe(prop).length) { out.exclues.push(`${cle} | propriété inconnue de ce navigateur`); return; }
        out.vues.push(cle);
        if (!cibles.length) return;
        out.visees.push(cle);
        /* Effet restant de la déclaration */
        const ensuite = new Set(ecrites.slice(rang + 1).flatMap(longuesDe));
        const effet = longuesDe(prop).filter((l) => presentes.has(l) && !ensuite.has(l));
        if (!effet.length) return;
        const portee = [];
        if (prop.startsWith('--')) tous.forEach((e) => portee.push([e, null]));
        else {
          const parPseudo = new Map();
          for (const { base: b, pseudo: ps } of parties) {
            let c = [];
            try { c = [...document.querySelectorAll(b)]; } catch { /* sélecteur hors DOM */ }
            const lot = parPseudo.get(ps) || new Set();
            c.forEach((x) => { lot.add(x); if (!ps) x.querySelectorAll('*').forEach((d) => lot.add(d)); });
            parPseudo.set(ps, lot);
          }
          for (const [ps, lot] of parPseudo) lot.forEach((e) => portee.push([e, ps]));
        }
        /* Hauteur de ligne avec la police */
        const lues = effet.includes('font-size') ? [...effet, 'line-height'] : effet;
        const lire = () => { finir(); return portee.map(([e, ps]) => { const s = getComputedStyle(e, ps ? `::${ps}` : null); return lues.map((l) => s.getPropertyValue(l)).join('|'); }); };
        const avant = lire();
        /* Retrait comme dans le fichier */
        const fidele = ecritesTexte && ecritesTexte.length === ecrites.length;
        /* Remise en place depuis le fichier */
        const origine = fidele ? ecritesTexte.join('; ') : r.style.cssText;
        if (fidele) {
          /* Préfixe de secours retiré aussi */
          const secours = (n) => n !== prop && n.replace(/^-(webkit|moz|ms)-/, '') === prop;
          r.style.cssText = ecritesTexte.filter((_, i) => i !== rang && !secours(ecrites[i])).join('; ');
        }
        else effet.forEach((l) => r.style.removeProperty(l));
        const apres = lire();
        r.style.cssText = origine;
        if (avant.some((v, i) => v !== apres[i])) out.utiles.push(cle);
      });
    }
  };
  for (const s of document.styleSheets) {
    const feuille = s.href ? s.href.split('/css/')[1] : s.ownerNode?.dataset?.feuille;
    if (!feuille || exclues.includes(feuille)) continue;
    sources.set(feuille, { liste: lireSource(sourceDe(s)), curseur: 0 });
    try { noterReplis(s.cssRules, feuille, ''); parcourir(s.cssRules, feuille, '', ''); } catch { /* feuille illisible */ }
  }
  return out;
};

/* Classement de tous les états */
export function classer(mesures) {
  const vues = new Set(), visees = new Set(), utiles = new Set(), exclues = new Set();
  for (const m of mesures) {
    (m.exclues || []).forEach((k) => exclues.add(k));
    m.vues.forEach((k) => vues.add(k));
    m.visees.forEach((k) => visees.add(k));
    m.utiles.forEach((k) => utiles.add(k));
  }
  return {
    vues, utiles, exclues: [...exclues].sort(),
    jamais: [...vues].filter((k) => !visees.has(k)).sort(),
    sansEffet: [...visees].filter((k) => !utiles.has(k)).sort(),
  };
}

/* Règles recopiées d'une feuille à l'autre */
export function recopiees(sources, chargements) {
  const proprietes = new Map();
  for (const [f, texte] of sources) {
    for (const r of reglesCSS(texte)) {
      if (r.arobase) continue;
      for (const d of r.corps.split(';')) {
        const i = d.indexOf(':');
        if (i < 0) continue;
        const cle = `${r.contexte} | ${r.selecteur.replace(/\s+/g, ' ').trim()} | ${d.slice(0, i).trim()}: ${d.slice(i + 1).replace(/\s+/g, ' ').trim()}`;
        if (!proprietes.has(cle)) proprietes.set(cle, new Set());
        proprietes.get(cle).add(f);
      }
    }
  }
  const constats = [];
  for (const [cle, feuilles] of proprietes) {
    if (feuilles.size < 2) continue;
    const liste = [...feuilles].sort();
    if (chargements.some((ch) => liste.filter((f) => ch.includes(f)).length > 1)) constats.push(`${liste.join(' + ')} | ${cle}`);
  }
  return constats.sort();
}
