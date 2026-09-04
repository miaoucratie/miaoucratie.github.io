/**
 * Tests de shared/booking-utils.js.
 *
 * Ce module est le seul garde-fou entre le formulaire de reservation et la
 * boite mail : reservation.html ne valide rien en JavaScript, tout se joue
 * dans le Worker Cloudflare qui importe ce fichier. Une erreur ici se paie en
 * garde double, pas en pixel.
 *
 * Fonctions pures, sans DOM ni reseau : node --test suffit, aucune dependance.
 *
 *   npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWhitespace,
  safeText,
  safeMultilineText,
  parseIsoDateParts,
  isoFromDate,
  normalizeDateInput,
  isIsoDate,
  todayIso,
  dateRangeOverlaps,
  mergeRanges,
  rangeCollidesWithUnavailable,
  availableSegments,
  countCoveredDays,
  sanitizeReservationPayload,
  validateReservationPayload,
  validateUnavailabilityPayload,
  formatDateFr,
  buildReservationSubject,
} from './booking-utils.js';

/** Demande valide de reference : chaque test n'en modifie qu'un aspect. */
const demandeValide = {
  nom: 'Durand',
  prenom: 'Claire',
  telephone: '06 12 34 56 78',
  email: 'Claire.Durand@Example.FR',
  commune: 'Domagné',
  nombreChats: '2',
  dateDebut: '2030-07-10',
  dateFin: '2030-07-18',
  frequence: '1 visite par jour',
};

describe('nettoyage du texte', () => {
  test('replie les espaces multiples et coupe les bords', () => {
    assert.equal(normalizeWhitespace('  Claire   Durand \n'), 'Claire Durand');
  });

  test('tronque a la longueur demandee', () => {
    assert.equal(safeText('abcdef', 3), 'abc');
  });

  test('le texte multiligne garde ses paragraphes mais pas les lignes vides en trop', () => {
    assert.equal(safeMultilineText('Un\r\n\n\n\nDeux'), 'Un\n\nDeux');
  });
});

describe('lecture des dates', () => {
  test('accepte une date ISO reelle', () => {
    assert.deepEqual(parseIsoDateParts('2026-02-28').day, 28);
  });

  test('refuse un 30 fevrier, que Date() accepterait en debordant sur mars', () => {
    assert.equal(parseIsoDateParts('2026-02-30'), null);
  });

  test('refuse un mois 13', () => {
    assert.equal(parseIsoDateParts('2026-13-01'), null);
  });

  test('accepte le 29 fevrier d une annee bissextile', () => {
    assert.ok(parseIsoDateParts('2028-02-29'));
  });

  test('convertit le format francais', () => {
    assert.equal(normalizeDateInput('18/07/2030'), '2030-07-18');
    assert.equal(normalizeDateInput('18-07-2030'), '2030-07-18');
  });

  test('rejette une date francaise impossible', () => {
    assert.equal(normalizeDateInput('31/02/2030'), '');
  });

  test('accepte un objet Date', () => {
    assert.equal(normalizeDateInput(new Date(Date.UTC(2030, 6, 18))), '2030-07-18');
  });

  test('rend une chaine vide sur une saisie libre', () => {
    assert.equal(normalizeDateInput('la semaine prochaine'), '');
    assert.equal(normalizeDateInput(''), '');
  });

  test('isoFromDate refuse une date invalide', () => {
    assert.equal(isoFromDate(new Date('n importe quoi')), '');
    assert.equal(isoFromDate('2030-07-18'), '');
  });

  test('formatDateFr fait l aller-retour', () => {
    assert.equal(formatDateFr('2030-07-18'), '18/07/2030');
    assert.equal(formatDateFr('pas une date'), '');
  });

  test('todayIso rend une date au format ISO', () => {
    assert.ok(isIsoDate(todayIso(new Date(2030, 6, 18))));
  });
});

describe('chevauchement de periodes', () => {
  test('deux periodes qui se recouvrent se chevauchent', () => {
    assert.equal(dateRangeOverlaps('2030-07-10', '2030-07-18', '2030-07-15', '2030-07-20'), true);
  });

  test('un seul jour commun suffit', () => {
    assert.equal(dateRangeOverlaps('2030-07-10', '2030-07-15', '2030-07-15', '2030-07-20'), true);
  });

  test('deux periodes qui se suivent sans se toucher ne se chevauchent pas', () => {
    assert.equal(dateRangeOverlaps('2030-07-10', '2030-07-14', '2030-07-15', '2030-07-20'), false);
  });
});

describe('fusion des indisponibilites', () => {
  test('fusionne deux periodes qui se recouvrent', () => {
    const r = mergeRanges([
      { startDate: '2030-07-10', endDate: '2030-07-15' },
      { startDate: '2030-07-12', endDate: '2030-07-20' },
    ]);
    assert.equal(r.length, 1);
    assert.equal(r[0].startDate, '2030-07-10');
    assert.equal(r[0].endDate, '2030-07-20');
  });

  test('fusionne deux periodes contigues : le 15 puis le 16', () => {
    const r = mergeRanges([
      { startDate: '2030-07-10', endDate: '2030-07-15' },
      { startDate: '2030-07-16', endDate: '2030-07-20' },
    ]);
    assert.equal(r.length, 1, 'un jour de battement ne doit pas laisser deux blocs');
  });

  test('laisse separees deux periodes avec un jour libre entre elles', () => {
    const r = mergeRanges([
      { startDate: '2030-07-10', endDate: '2030-07-15' },
      { startDate: '2030-07-17', endDate: '2030-07-20' },
    ]);
    assert.equal(r.length, 2);
  });

  test('trie avant de fusionner, meme si les periodes arrivent en desordre', () => {
    const r = mergeRanges([
      { startDate: '2030-08-01', endDate: '2030-08-05' },
      { startDate: '2030-07-10', endDate: '2030-07-15' },
    ]);
    assert.equal(r[0].startDate, '2030-07-10');
    assert.equal(r.length, 2);
  });

  test('reunit les commentaires des periodes fusionnees', () => {
    const r = mergeRanges([
      { startDate: '2030-07-10', endDate: '2030-07-15', comment: 'Vacances' },
      { startDate: '2030-07-12', endDate: '2030-07-20', comment: 'Formation' },
    ]);
    assert.equal(r[0].comment, 'Vacances · Formation');
  });

  test('ignore les periodes dont une date est invalide', () => {
    const r = mergeRanges([
      { startDate: '2030-07-10', endDate: '2030-07-15' },
      { startDate: 'bientot', endDate: '2030-07-20' },
    ]);
    assert.equal(r.length, 1);
  });

  test('rend un tableau vide sans entree exploitable', () => {
    assert.deepEqual(mergeRanges([]), []);
    assert.deepEqual(mergeRanges([{ startDate: 'x', endDate: 'y' }]), []);
  });
});

describe('collision avec une indisponibilite', () => {
  const indispo = [{ startDate: '2030-07-14', endDate: '2030-07-16' }];

  test('detecte une demande qui empiete', () => {
    assert.equal(rangeCollidesWithUnavailable('2030-07-10', '2030-07-15', indispo), true);
  });

  test('detecte une demande entierement contenue dans l indisponibilite', () => {
    assert.equal(rangeCollidesWithUnavailable('2030-07-15', '2030-07-15', indispo), true);
  });

  test('laisse passer une demande qui s arrete la veille', () => {
    assert.equal(rangeCollidesWithUnavailable('2030-07-10', '2030-07-13', indispo), false);
  });

  test('laisse passer une demande qui commence le lendemain', () => {
    assert.equal(rangeCollidesWithUnavailable('2030-07-17', '2030-07-20', indispo), false);
  });

  test('ne bloque rien si la demande n a pas de dates lisibles', () => {
    assert.equal(rangeCollidesWithUnavailable('', '', indispo), false);
  });
});

describe('jours couverts d une periode', () => {
  const seg = (s, e) => ({ startDate: s, endDate: e });

  test('rend la periode entiere quand rien ne la bloque', () => {
    assert.deepEqual(availableSegments('2030-07-10', '2030-07-18', []), [seg('2030-07-10', '2030-07-18')]);
    assert.equal(countCoveredDays('2030-07-10', '2030-07-18', []), 9);
  });

  test('coupe la fin quand l absence commence en cours de sejour', () => {
    const r = availableSegments('2030-07-10', '2030-07-18', [seg('2030-07-15', '2030-07-25')]);
    assert.deepEqual(r, [seg('2030-07-10', '2030-07-14')]);
  });

  test('coupe le debut quand l absence court deja', () => {
    const r = availableSegments('2030-07-10', '2030-07-18', [seg('2030-07-01', '2030-07-12')]);
    assert.deepEqual(r, [seg('2030-07-13', '2030-07-18')]);
  });

  test('rend deux morceaux quand l absence tombe au milieu', () => {
    const r = availableSegments('2030-07-10', '2030-07-18', [seg('2030-07-13', '2030-07-15')]);
    assert.deepEqual(r, [seg('2030-07-10', '2030-07-12'), seg('2030-07-16', '2030-07-18')]);
    assert.equal(countCoveredDays('2030-07-10', '2030-07-18', [seg('2030-07-13', '2030-07-15')]), 6);
  });

  test('rend trois morceaux quand deux absences trouent le sejour', () => {
    const r = availableSegments('2030-07-01', '2030-07-20', [
      seg('2030-07-05', '2030-07-07'),
      seg('2030-07-12', '2030-07-13'),
    ]);
    assert.deepEqual(r, [
      seg('2030-07-01', '2030-07-04'),
      seg('2030-07-08', '2030-07-11'),
      seg('2030-07-14', '2030-07-20'),
    ]);
  });

  test('ne rend rien quand la periode est entierement bloquee', () => {
    assert.deepEqual(availableSegments('2030-07-10', '2030-07-18', [seg('2030-07-01', '2030-07-31')]), []);
    assert.equal(countCoveredDays('2030-07-10', '2030-07-18', [seg('2030-07-01', '2030-07-31')]), 0);
  });

  test('traite deux absences qui se touchent comme une seule', () => {
    const r = availableSegments('2030-07-01', '2030-07-20', [
      seg('2030-07-05', '2030-07-10'),
      seg('2030-07-11', '2030-07-15'),
    ]);
    assert.deepEqual(r, [seg('2030-07-01', '2030-07-04'), seg('2030-07-16', '2030-07-20')]);
  });

  test('accepte une garde d un seul jour', () => {
    assert.deepEqual(availableSegments('2030-07-10', '2030-07-10', []), [seg('2030-07-10', '2030-07-10')]);
    assert.equal(countCoveredDays('2030-07-10', '2030-07-10', []), 1);
  });

  test('ne rend rien sur des dates illisibles ou inversees', () => {
    assert.deepEqual(availableSegments('', '2030-07-18', []), []);
    assert.deepEqual(availableSegments('2030-07-18', '2030-07-10', []), []);
  });

  test('ignore une indisponibilite illisible', () => {
    const r = availableSegments('2030-07-10', '2030-07-18', [seg('pas-une-date', '2030-07-15')]);
    assert.deepEqual(r, [seg('2030-07-10', '2030-07-18')]);
  });

  test('franchit un changement d heure sans decaler les bornes', () => {
    const r = availableSegments('2030-10-20', '2030-11-05', [seg('2030-10-26', '2030-10-28')]);
    assert.deepEqual(r, [seg('2030-10-20', '2030-10-25'), seg('2030-10-29', '2030-11-05')]);
  });
});

describe('nettoyage de la demande', () => {
  test('accepte les noms de champs du formulaire comme ceux de l API', () => {
    const s = sanitizeReservationPayload({ nombre_chats: '3', date_debut: '2030-07-10', contact_email: 'A@B.FR' });
    assert.equal(s.nombreChats, 3);
    assert.equal(s.dateDebut, '2030-07-10');
    assert.equal(s.email, 'a@b.fr');
  });

  test('met l adresse en minuscules', () => {
    assert.equal(sanitizeReservationPayload(demandeValide).email, 'claire.durand@example.fr');
  });

  test('traduit l intitule affiche de la frequence « autre »', () => {
    assert.equal(sanitizeReservationPayload({ frequence: 'Autre besoin à préciser' }).frequence, 'autre');
  });

  test('rend NaN quand le nombre de chats n est pas un nombre', () => {
    assert.ok(Number.isNaN(sanitizeReservationPayload({ nombreChats: 'deux' }).nombreChats));
  });
});

describe('validation de la demande', () => {
  const valider = (modif = {}, indispo = []) =>
    validateReservationPayload({ ...demandeValide, ...modif }, indispo, { now: '2030-01-01' });

  test('une demande complete passe', () => {
    const r = valider();
    assert.equal(r.isValid, true, `erreurs inattendues : ${JSON.stringify(r.errors)}`);
  });

  test('exige le nom, le prenom, la commune', () => {
    assert.ok(valider({ nom: '' }).errors.nom);
    assert.ok(valider({ prenom: '  ' }).errors.prenom);
    assert.ok(valider({ commune: '' }).errors.commune);
  });

  test('refuse un telephone trop court', () => {
    assert.ok(valider({ telephone: '06 12' }).errors.telephone);
  });

  test('accepte un WhatsApp vide mais refuse un WhatsApp incomplet', () => {
    assert.equal(valider({ whatsapp: '' }).isValid, true);
    assert.ok(valider({ whatsapp: '06 12' }).errors.whatsapp);
  });

  test('refuse une adresse e-mail malformee', () => {
    assert.ok(valider({ email: 'claire.durand' }).errors.email);
    assert.ok(valider({ email: 'claire@' }).errors.email);
  });

  test('refuse un nombre de chats absent, nul ou non entier', () => {
    assert.ok(valider({ nombreChats: '' }).errors.nombreChats);
    assert.ok(valider({ nombreChats: '0' }).errors.nombreChats);
    assert.ok(valider({ nombreChats: 'deux' }).errors.nombreChats);
  });

  test('refuse une date de debut passee', () => {
    const r = validateReservationPayload(
      { ...demandeValide, dateDebut: '2029-12-31', dateFin: '2030-01-05' },
      [], { minDate: '2030-01-01' },
    );
    assert.ok(r.errors.dateDebut);
  });

  test('refuse une date de fin anterieure au debut', () => {
    assert.ok(valider({ dateFin: '2030-07-01' }).errors.dateFin);
  });

  test('accepte une garde d une seule journee', () => {
    assert.equal(valider({ dateFin: demandeValide.dateDebut }).isValid, true);
  });

  test('refuse une frequence hors liste', () => {
    assert.ok(valider({ frequence: '3 visites par jour' }).errors.frequence);
  });

  test('exige la precision quand la frequence est « autre »', () => {
    assert.ok(valider({ frequence: 'autre' }).errors.autreFrequence);
    assert.equal(valider({ frequence: 'autre', autreFrequence: 'Deux visites le week-end' }).isValid, true);
  });

  test('refuse une periode dont aucun jour n est couvert', () => {
    const r = valider({}, [{ startDate: '2030-07-01', endDate: '2030-07-31' }]);
    assert.ok(r.errors.dateRange);
  });

  test('accepte une periode partiellement couverte', () => {
    const r = valider({}, [{ startDate: '2030-07-12', endDate: '2030-07-14' }]);
    assert.equal(r.isValid, true, `erreurs inattendues : ${JSON.stringify(r.errors)}`);
  });

  test('accepte une periode a cote d une indisponibilite', () => {
    const r = valider({}, [{ startDate: '2030-08-01', endDate: '2030-08-10' }]);
    assert.equal(r.isValid, true);
  });

  test('bloque un envoi automatise ayant rempli le champ piege', () => {
    assert.ok(valider({ website: 'http://spam.example' }).errors.honeypot);
  });
});

describe('validation des indisponibilites', () => {
  test('une periode coherente passe', () => {
    assert.equal(validateUnavailabilityPayload({ startDate: '2030-07-10', endDate: '2030-07-15' }).isValid, true);
  });

  test('refuse une fin anterieure au debut', () => {
    assert.ok(validateUnavailabilityPayload({ startDate: '2030-07-15', endDate: '2030-07-10' }).errors.endDate);
  });

  test('refuse des dates illisibles', () => {
    const r = validateUnavailabilityPayload({ startDate: 'demain', endDate: '' });
    assert.ok(r.errors.startDate);
    assert.ok(r.errors.endDate);
  });
});

describe('objet du message', () => {
  test('reprend le prenom, le nom et les deux dates', () => {
    const sujet = buildReservationSubject(demandeValide);
    assert.match(sujet, /Claire/);
    assert.match(sujet, /Durand/);
    assert.match(sujet, /2030-07-10/);
    assert.match(sujet, /2030-07-18/);
  });
});
