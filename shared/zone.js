/** Zone d'intervention */

(function (racine) {
  'use strict';

  /** Règles nommées */
  const REGLES = Object.freeze({
    standard: Object.freeze({
      origineSecours: Object.freeze([48.0572, -1.3365]),
      coefficientRoute: 1.35,
      inclusKm: 20,
      souplesseKm: 21.5,
      devisKm: 45,
      departement: '35',
      communesExclues: Object.freeze(['rennes']),
      codesExclus: Object.freeze(['35000']),
    }),
  });

  /** Distance à vol d'oiseau */
  function distanceKm(a, b) {
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  /** Distance routière estimée */
  function distanceRouteKm(origine, point, regle = REGLES.standard) {
    return distanceKm(origine, point) * regle.coefficientRoute;
  }

  /** Dans le département */
  function dansDepartement({ departement = '', code = '', postal = '' }, regle = REGLES.standard) {
    const d = regle.departement;
    return String(departement) === d || String(code).startsWith(d) || String(postal).startsWith(d);
  }

  /** Commune exclue */
  function communeExclue({ nomNormalise = '', code = '', postal = '' }, regle = REGLES.standard) {
    return regle.communesExclues.some((n) => nomNormalise.includes(n))
      || regle.codesExclus.includes(String(code)) || regle.codesExclus.includes(String(postal));
  }

  /** Verdict selon la distance */
  function verdictDistance(km, regle = REGLES.standard) {
    if (km <= regle.souplesseKm) return km > regle.inclusKm ? 'souplesse' : 'inclus';
    if (km <= regle.devisKm) return 'devis';
    return 'hors';
  }

  racine.MiaouZone = Object.freeze({
    REGLES,
    distanceKm,
    distanceRouteKm,
    dansDepartement,
    communeExclue,
    verdictDistance,
  });
})(typeof window !== 'undefined' ? window : globalThis);
