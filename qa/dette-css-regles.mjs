/* Classement du CSS mort */

import { reglesCSS } from './css-regles.mjs';

/* Relevé dans la page */
export const RELEVE = (exclues) => {
  const out = { vues: [], visees: [], utiles: [], exclues: [] };
  const morceaux = (sel) => {
    const liste = [];
    let prof = 0, tampon = '';
    for (const c of sel) {
      if (c === '(') prof++;
      if (c === ')') prof--;
      if (c === ',' && !prof) { liste.push(tampon); tampon = ''; } else tampon += c;
    }
    return [...liste, tampon];
  };
  const tous = [...document.querySelectorAll('*')];
  const declarations = (style) => {
    const liste = [];
    let prof = 0, tampon = '';
    for (const c of style.cssText) {
      if (c === '(') prof++;
      if (c === ')') prof--;
      if (c === ';' && !prof) { liste.push(tampon); tampon = ''; } else tampon += c;
    }
    return liste.map((d) => d.slice(0, d.indexOf(':')).trim()).filter(Boolean);
  };
  const parcourir = (regles, feuille, ctx) => {
    for (const r of regles) {
      if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule) {
        const actif = r instanceof CSSMediaRule ? matchMedia(r.conditionText).matches : CSS.supports(r.conditionText);
        const c = `${ctx}@${r instanceof CSSMediaRule ? 'media' : 'supports'} ${r.conditionText} { `;
        if (actif) { parcourir(r.cssRules, feuille, c); continue; }
        const noter = (rs, cc) => { for (const x of rs) { if (x instanceof CSSStyleRule) for (const p of declarations(x.style)) { const k = `${feuille} | ${cc}${x.selectorText} | ${p}`; if (/::-webkit-|::-moz-/.test(x.selectorText)) out.exclues.push(`${k} | pseudo-élément propre au navigateur, non mesurable`); else if (/calculateur-page/.test(x.selectorText)) out.exclues.push(`${k} | règle du calculateur, page appelée à disparaître`); else out.vues.push(k); } else if (x.cssRules) noter(x.cssRules, cc); } };
        noter(r.cssRules, c);
        continue;
      }
      if (!(r instanceof CSSStyleRule)) continue;
      const sel = r.selectorText;
      const pseudo = (sel.match(/::?(before|after|marker|placeholder)\b/) || [])[1];
      const horsParentheses = (s, re) => { let prof = 0, sortie = ''; for (const morceau of s.split(/([()])/)) { if (morceau === '(') prof++; if (morceau === ')') prof--; sortie += prof === 0 && morceau !== ')' ? morceau.replace(re, '') : morceau; } return sortie; };
      const base = morceaux(sel).map((s) => horsParentheses(s.replace(/::?(before|after|marker|placeholder|first-letter|first-line|selection)\b/g, ''), /:(hover|focus-visible|focus-within|focus|active)\b/g).trim() || '*').join(', ');
      const exclue = /::-webkit-|::-moz-/.test(sel) ? 'pseudo-élément propre au navigateur, non mesurable' : /calculateur-page/.test(sel) ? 'règle du calculateur, page appelée à disparaître' : null;
      let cibles;
      try { cibles = [...document.querySelectorAll(base.trim() || '*')]; } catch { cibles = []; }
      for (const prop of declarations(r.style)) {
        const cle = `${feuille} | ${ctx}${sel} | ${prop}`;
        if (exclue) { out.exclues.push(`${cle} | ${exclue}`); continue; }
        out.vues.push(cle);
        if (!cibles.length) continue;
        out.visees.push(cle);
        const portee = prop.startsWith('--') ? tous : [...new Set(cibles.flatMap((c) => [c, ...c.querySelectorAll('*')]))];
        const longues = [...r.style].filter((l) => l === prop || l.startsWith(`${prop}-`));
        const lire = () => {
          document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.cancel(); } });
          return lireValeurs();
        };
        const lireValeurs = () => portee.map((e) => {
          const s = getComputedStyle(e, pseudo ? `::${pseudo}` : null);
          return (longues.length ? longues : [prop]).map((l) => s.getPropertyValue(l)).join('|');
        });
        const valeur = r.style.getPropertyValue(prop);
        const priorite = r.style.getPropertyPriority(prop);
        const avant = lire();
        r.style.removeProperty(prop);
        const apres = lire();
        r.style.setProperty(prop, valeur, priorite);
        if (avant.some((v, i) => v !== apres[i])) out.utiles.push(cle);
      }
    }
  };
  for (const s of document.styleSheets) {
    const feuille = s.href ? s.href.split('/css/')[1] : s.ownerNode?.dataset?.feuille;
    if (!feuille || exclues.includes(feuille)) continue;
    try { parcourir(s.cssRules, feuille, ''); } catch { /* feuille illisible */ }
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
