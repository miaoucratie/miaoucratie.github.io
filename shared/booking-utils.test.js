/* Règles de réservation */
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
  availableSegments,
  sanitizeReservationPayload,
  adresseComplete,
  validateReservationPayload,
  validateUnavailabilityPayload,
  formatDateFr,
  separerPassees,
  demandesRecentes,
  validerDatesEnCours,
  shiftIsoDay,
  partsIso,
  nombreDeJours,
  compterJours,
  complementSegments,
} from './booking-utils.js';

/* Demande de référence */
const demandeValide = {
  nom: 'Essai',
  prenom: 'Claire',
  telephone: '06 39 98 12 34',
  email: 'Claire.Essai@Example.FR',
  commune: 'Domagné',
  nombreChats: '2',
  dateDebut: '2030-07-10',
  dateFin: '2030-07-18',
  frequence: '1 visite par jour',
};

describe('nettoyage du texte', () => {
  test('replie les espaces multiples et coupe les bords', () => {
    assert.equal(normalizeWhitespace('  Claire   Essai \n'), 'Claire Essai');
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

describe('jours couverts d une periode', () => {
  const seg = (s, e) => ({ startDate: s, endDate: e });

  test('rend la periode entiere quand rien ne la bloque', () => {
    assert.deepEqual(availableSegments('2030-07-10', '2030-07-18', []), [seg('2030-07-10', '2030-07-18')]);
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

  test('observations : 1500 caractères au plus', () => {
    const s = sanitizeReservationPayload({ observations: 'a'.repeat(1600) });
    assert.equal(s.observations.length, 1500);
  });

  test('met l adresse en minuscules', () => {
    assert.equal(sanitizeReservationPayload(demandeValide).email, 'claire.essai@example.fr');
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
    assert.ok(valider({ email: 'claire.essai' }).errors.email);
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

  test('refuse le champ website rempli', () => {
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

describe('adresse complete', () => {
  test('assemble la rue, le code postal et la commune sans parentheses', () => {
    assert.equal(
      adresseComplete({ adresse: ' 1  rue de l\'Exemple ', commune: 'Domagné (35113)', communeCodePostal: '35113' }),
      '1 rue de l\'Exemple, 35113 Domagné'
    );
  });

  test('garde une commune tapee a la main, sans code postal', () => {
    assert.equal(
      adresseComplete({ adresse: '2 impasse de l\'Essai', commune: 'st jean sur vilaine', communeCodePostal: '' }),
      '2 impasse de l\'Essai, st jean sur vilaine'
    );
  });

  test('reste vide sans rue', () => {
    assert.equal(adresseComplete({ adresse: '  ', commune: 'Domagné (35113)', communeCodePostal: '35113' }), '');
  });

  test('l adresse est facultative et bornee a 200 caracteres', () => {
    assert.equal(sanitizeReservationPayload({}).adresse, '');
    assert.equal(sanitizeReservationPayload({ adresse: 'a'.repeat(300) }).adresse.length, 200);
  });
});

describe('dates en cours de saisie', () => {
  const jour = { minDate: '2030-01-10' };
  const DEBUT_INVALIDE = 'Merci de choisir une date de début valide.';
  const PASSEE = 'Les dates passées ne sont pas disponibles.';
  const FIN_INVALIDE = 'Merci de choisir une date de fin valide.';
  const INVERSEES = 'La date de fin doit être postérieure ou égale à la date de début.';

  const cas = [
    ['rien de saisi', '', '', {}],
    ['debut seul', '2030-01-12', '', {}],
    ['fin seule', '', '2030-01-12', {}],
    ['fin seule, deja passee', '', '2030-01-02', {}],
    ['fin seule, illisible', '', 'bientot', { dateFin: FIN_INVALIDE }],
    ['debut illisible', 'demain', '2030-01-12', { dateDebut: DEBUT_INVALIDE }],
    ['debut impossible', '2030-02-30', '', { dateDebut: DEBUT_INVALIDE }],
    ['debut passe, fin vide', '2030-01-09', '', { dateDebut: PASSEE }],
    ['debut passe et dates inversees', '2030-01-09', '2030-01-01', { dateDebut: PASSEE }],
    ['debut aujourd hui', '2030-01-10', '2030-01-10', {}],
    ['garde d un seul jour', '2030-01-15', '2030-01-15', {}],
    ['fin la veille du debut', '2030-01-15', '2030-01-14', { dateFin: INVERSEES }],
    ['fin illisible', '2030-01-15', 'pas une date', { dateFin: FIN_INVALIDE }],
    ['periode longue', '2030-01-15', '2031-01-15', {}],
    ['format francais', '15/01/2030', '20/01/2030', {}],
    ['format francais inverse', '15/01/2030', '14/01/2030', { dateFin: INVERSEES }],
    ['valeurs nulles', null, null, {}],
  ];

  for (const [nom, debut, fin, attendu] of cas) {
    test(nom, () => {
      const r = validerDatesEnCours(debut, fin, jour);
      assert.deepEqual(r.errors, attendu);
      assert.equal(r.isValid, Object.keys(attendu).length === 0);
    });
  }

  test('s arrete a la premiere erreur', () => {
    assert.equal(Object.keys(validerDatesEnCours('demain', 'bientot', jour).errors).length, 1);
  });

  test('prend la date du jour au moment de l appel', () => {
    assert.deepEqual(validerDatesEnCours('2030-01-09', '', { now: new Date(2030, 0, 9, 12) }).errors, {});
    assert.deepEqual(validerDatesEnCours('2030-01-09', '', { now: new Date(2030, 0, 10, 0, 5) }).errors, { dateDebut: PASSEE });
  });

  test('memes messages que la regle d envoi', () => {
    const envoi = (modif) => validateReservationPayload({ ...demandeValide, ...modif }, [], jour).errors;
    assert.equal(validerDatesEnCours('2030-01-09', '', jour).errors.dateDebut, envoi({ dateDebut: '2030-01-09' }).dateDebut);
    assert.equal(validerDatesEnCours('x', '', jour).errors.dateDebut, envoi({ dateDebut: 'x' }).dateDebut);
    assert.equal(validerDatesEnCours('', 'x', jour).errors.dateFin, envoi({ dateFin: 'x' }).dateFin);
    assert.equal(validerDatesEnCours('2030-07-18', '2030-07-10', jour).errors.dateFin, envoi({ dateFin: '2030-07-01' }).dateFin);
  });
});

describe('jours d une periode', () => {
  const seg = (s, e) => ({ startDate: s, endDate: e });

  test('decale d un jour en avant et en arriere', () => {
    assert.equal(shiftIsoDay('2030-07-10', 1), '2030-07-11');
    assert.equal(shiftIsoDay('2030-07-10', -1), '2030-07-09');
    assert.equal(shiftIsoDay('2030-07-10', 7), '2030-07-17');
  });

  test('franchit les fins de mois, d annee et le 29 fevrier', () => {
    assert.equal(shiftIsoDay('2030-01-31', 1), '2030-02-01');
    assert.equal(shiftIsoDay('2030-12-31', 1), '2031-01-01');
    assert.equal(shiftIsoDay('2028-03-01', -1), '2028-02-29');
    assert.equal(shiftIsoDay('2030-03-01', -1), '2030-02-28');
  });

  test('rend une chaine vide sur une date illisible', () => {
    assert.equal(shiftIsoDay('bientot', 1), '');
  });

  test('lit l annee, le mois et le jour', () => {
    assert.deepEqual(partsIso('2030-07-01'), { annee: 2030, mois: 7, jour: 1 });
  });

  test('compte les jours bornes comprises', () => {
    assert.equal(nombreDeJours('2030-07-10', '2030-07-10'), 1);
    assert.equal(nombreDeJours('2030-07-10', '2030-07-18'), 9);
    assert.equal(nombreDeJours('2030-12-30', '2031-01-02'), 4);
    assert.equal(nombreDeJours('2028-02-28', '2028-03-01'), 3);
  });

  test('ignore le changement d heure', () => {
    assert.equal(nombreDeJours('2030-03-30', '2030-04-01'), 3);
    assert.equal(nombreDeJours('2030-10-26', '2030-10-28'), 3);
  });

  test('additionne les jours de plusieurs morceaux', () => {
    assert.equal(compterJours([]), 0);
    assert.equal(compterJours([seg('2030-07-10', '2030-07-12'), seg('2030-07-16', '2030-07-18')]), 6);
  });

  test('rend les trous entre les morceaux couverts', () => {
    const r = complementSegments('2030-07-10', '2030-07-18', [seg('2030-07-10', '2030-07-12'), seg('2030-07-16', '2030-07-18')]);
    assert.deepEqual(r, [seg('2030-07-13', '2030-07-15')]);
  });

  test('rend le debut et la fin non couverts', () => {
    const r = complementSegments('2030-07-10', '2030-07-18', [seg('2030-07-13', '2030-07-15')]);
    assert.deepEqual(r, [seg('2030-07-10', '2030-07-12'), seg('2030-07-16', '2030-07-18')]);
  });

  test('rend toute la periode sans morceau couvert', () => {
    assert.deepEqual(complementSegments('2030-07-10', '2030-07-14', []), [seg('2030-07-10', '2030-07-14')]);
  });

  test('ne rend rien quand tout est couvert', () => {
    assert.deepEqual(complementSegments('2030-07-10', '2030-07-14', [seg('2030-07-10', '2030-07-14')]), []);
  });

  test('complete exactement les jours couverts', () => {
    const indispo = [seg('2030-07-30', '2030-08-02'), seg('2030-08-06', '2030-08-06')];
    const couverts = availableSegments('2030-07-28', '2030-08-08', indispo);
    const trous = complementSegments('2030-07-28', '2030-08-08', couverts);
    assert.deepEqual(trous, indispo);
    assert.equal(compterJours(couverts) + compterJours(trous), nombreDeJours('2030-07-28', '2030-08-08'));
  });
});

describe('tri de l ecran d administration', () => {
  const jour = '2026-11-08';

  test('une periode qui finit aujourd hui est encore a venir', () => {
    const { aVenir, passees } = separerPassees([
      { startDate: '2026-11-01', endDate: '2026-11-08' },
      { startDate: '2026-11-01', endDate: '2026-11-07' },
    ], jour);
    assert.deepEqual(aVenir.map((p) => p.endDate), ['2026-11-08']);
    assert.deepEqual(passees.map((p) => p.endDate), ['2026-11-07']);
  });

  test('a venir : la plus proche d abord ; passees : la plus recente d abord', () => {
    const { aVenir, passees } = separerPassees([
      { startDate: '2027-02-15', endDate: '2027-02-22' },
      { startDate: '2026-07-01', endDate: '2026-07-14' },
      { startDate: '2026-12-24', endDate: '2026-12-26' },
      { startDate: '2026-08-10', endDate: '2026-08-20' },
    ], jour);
    assert.deepEqual(aVenir.map((p) => p.startDate), ['2026-12-24', '2027-02-15']);
    assert.deepEqual(passees.map((p) => p.startDate), ['2026-08-10', '2026-07-01']);
  });

  const maintenant = new Date('2026-11-08T09:00:00Z');
  const recue = (id, soumiseLe) => ({ id, soumiseLe });

  test('seules les demandes des 30 derniers jours restent, la plus recente d abord', () => {
    const liste = demandesRecentes([
      recue('octobre', '2026-10-28 21:04:33'),
      recue('mai', '2026-05-15 10:00:00'),
      recue('hier', '2026-11-07 18:42:10'),
    ], maintenant);
    assert.deepEqual(liste.map((d) => d.id), ['hier', 'octobre']);
  });

  test('la limite est a 30 jours pile, heure comprise', () => {
    const liste = demandesRecentes([
      recue('dedans', '2026-10-09 09:00:00'),
      recue('dehors', '2026-10-09 08:59:59'),
    ], maintenant);
    assert.deepEqual(liste.map((d) => d.id), ['dedans']);
  });

  test('une date de reception illisible est gardee', () => {
    assert.equal(demandesRecentes([recue('sans-date', '')], maintenant).length, 1);
  });
});
