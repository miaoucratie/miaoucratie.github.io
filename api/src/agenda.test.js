/**
 * Tests de l'agenda du jour de l'appli Indisponibilités.
 *
 * Flux iCal fourni en dur, sans appel réseau.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  adressePhysique, analyserIcal, aujourdhuiAParis, etatAgenda, evenementsDuJour, viderCacheAgenda,
} from './agenda.js';

const FLUX = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-TIMEZONE:Europe/Paris',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261020',
  'DTEND;VALUE=DATE:20261021',
  'RRULE:FREQ=DAILY;UNTIL=20261105',
  'EXDATE;VALUE=DATE:20261029',
  'UID:garde@google.com',
  'LOCATION:3 rue des Lilas\\, 35500 Vitré\\, France',
  'DESCRIPTION:Deux chats\\nClé chez la voisine',
  'SUMMARY:Garde chat A',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Rappel',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261025',
  'DTEND;VALUE=DATE:20261026',
  'RECURRENCE-ID;VALUE=DATE:20261025',
  'UID:garde@google.com',
  'LOCATION:3 rue des Lilas\\, 35500 Vitré\\, France',
  'SUMMARY:Garde chat A (deux passages)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260902T183000',
  'DTEND;TZID=Europe/Paris:20260902T193000',
  'RRULE:FREQ=WEEKLY;UNTIL=20261231T225959Z;BYDAY=WE,FR',
  'UID:cours@google.com',
  'SUMMARY:Cours du soir',
  'LOCATION:Maison des asso',
  ' ciations\\, 35500 Vitré',
  'DESCRIPTION:Une description assez longue pour être repliée par Google sur',
  '  deux lignes.',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261007T200000',
  'DTEND;TZID=Europe/Paris:20261007T210000',
  'RECURRENCE-ID;TZID=Europe/Paris:20261007T183000',
  'UID:cours@google.com',
  'SUMMARY:Cours du soir (décalé)',
  'LOCATION:Maison des associations\\, 35500 Vitré',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261013T183000',
  'DTEND;TZID=Europe/Paris:20261013T193000',
  'RECURRENCE-ID;TZID=Europe/Paris:20261014T183000',
  'UID:cours@google.com',
  'SUMMARY:Cours du soir (avancé au mardi)',
  'LOCATION:Maison des associations\\, 35500 Vitré',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261003T080000Z',
  'DTEND:20261003T093000Z',
  'UID:veto@google.com',
  'SUMMARY:Rendez-vous véto',
  'LOCATION:Clinique vétérinaire\\, 35220 Châteaubourg',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260901',
  'DTEND;VALUE=DATE:20260908',
  'ORGANIZER;CN=Bob:mailto:bob@example.com',
  'UID:tiers-vacances@google.com',
  'SUMMARY:Vacances Bretagne',
  'LOCATION:Saint-Malo',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260911T140000',
  'DTEND;TZID=Europe/Paris:20260911T150000',
  'ORGANIZER:mailto:Quelquun@Example.com',
  'UID:tiers-rdv@google.com',
  'SUMMARY:Point partenaire',
  'LOCATION:Visio',
  'DESCRIPTION:Lien privé',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260912T140000',
  'DTEND;TZID=Europe/Paris:20260912T150000',
  'ORGANIZER;CN=Miaoucratie:mailto:miaoucratie@gmail.com',
  'UID:moi@google.com',
  'SUMMARY:Atelier',
  'LOCATION:Domagné',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261114T220000',
  'DTEND;TZID=Europe/Paris:20261115T010000',
  'UID:nuit@google.com',
  'SUMMARY:Garde de nuit',
  'LOCATION:Vitré',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260920T090000',
  'DTEND;TZID=Europe/Paris:20260920T093000',
  'RRULE:FREQ=DAILY;COUNT=3',
  'UID:soins@google.com',
  'SUMMARY:Soins',
  'LOCATION:Domagné',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260901T090000',
  'DTEND;TZID=Europe/Paris:20260901T100000',
  'RRULE:FREQ=MONTHLY;BYDAY=1TU;BYSETPOS=1',
  'UID:regle-rare@google.com',
  'SUMMARY:Règle rare',
  'LOCATION:Domagné',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261012T183000',
  'DTEND;TZID=Europe/Paris:20261012T203000',
  'UID:formation@google.com',
  'SUMMARY:Éthologie générale',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261012T120000',
  'DTEND;TZID=Europe/Paris:20261012T130000',
  'UID:webinaire@google.com',
  'SUMMARY:Webinaire hydratation',
  'LOCATION:https://us02web.zoom.us/w/123',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261012T090000',
  'DTEND;TZID=Europe/Paris:20261012T091500',
  'UID:appel@google.com',
  'SUMMARY:Appel cliente',
  'LOCATION:+33 6 12 34 56 78',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261012T150000',
  'DTEND;TZID=Europe/Paris:20261012T160000',
  'UID:pv@google.com',
  'SUMMARY:PV chat C',
  'LOCATION:Vitré',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260401',
  'DTEND;VALUE=DATE:20260402',
  'RRULE:FREQ=DAILY;UNTIL=20260404',
  'UID:garde-visites@google.com',
  'SUMMARY:Garde chat B',
  'LOCATION:Rennes',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260402T170000',
  'DTEND;TZID=Europe/Paris:20260402T174000',
  'RECURRENCE-ID;TZID=Europe/Paris:19700101T010000',
  'UID:garde-visites@google.com',
  'SUMMARY:Garde chat B',
  'LOCATION:Rennes',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260403T190000',
  'DTEND;TZID=Europe/Paris:20260403T200000',
  'RECURRENCE-ID;TZID=Europe/Paris:19700101T010000',
  'UID:garde-visites@google.com',
  'SUMMARY:Garde chat B',
  'LOCATION:Rennes',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261109T183000',
  'DTEND;TZID=Europe/Paris:20261109T203000',
  'RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261103T225959Z;BYDAY=TU,TH',
  'UID:premier-jour@google.com',
  'SUMMARY:Cours déplacé',
  'LOCATION:Rennes',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const lire = async () => new Response(FLUX, { status: 200 });

async function jour(date, options = {}) {
  return evenementsDuJour('https://agenda.test/prive.ics', date, { lire, ...options });
}

/** Événements de la journée dont le titre commence par `debut`. */
async function seulement(debut, date, options) {
  return (await jour(date, options)).filter((e) => e.summary.startsWith(debut));
}

beforeEach(() => viderCacheAgenda());

describe('gardes en journée entière répétées chaque jour', () => {
  test('la garde apparaît au milieu de la période, pas seulement le premier jour', async () => {
    const evenements = await seulement('Garde', '2026-10-23');
    assert.deepEqual(evenements, [{
      id: 'garde@google.com-2026-10-23',
      summary: 'Garde chat A',
      start: '2026-10-23',
      end: '2026-10-24',
      allDay: true,
      location: '3 rue des Lilas, 35500 Vitré, France',
    }]);
  });

  test('le dernier jour de la répétition est compris, le lendemain non', async () => {
    assert.equal((await seulement('Garde', '2026-11-05')).length, 1);
    assert.equal((await seulement('Garde', '2026-11-06')).length, 0);
  });

  test('un jour exclu n apparaît pas', async () => {
    assert.deepEqual(await jour('2026-10-29'), []);
  });

  test('une occurrence modifiée remplace celle du jour', async () => {
    const [garde] = await jour('2026-10-25');
    assert.equal(garde.summary, 'Garde chat A (deux passages)');
  });

  test('la description n est jamais renvoyée : l appli ne l affiche pas', async () => {
    const [garde] = await seulement('Garde', '2026-10-21');
    assert.equal('description' in garde, false);
  });
});

describe('jours de garde passés en visite à heure fixe', () => {
  test('Google date le jour remplacé au 1er janvier 1970 : la visite prend la place de la garde ce jour-là', async () => {
    const resume = async (d) => (await seulement('Garde chat B', d)).map((e) => (e.allDay ? 'journée' : e.startTime));
    assert.deepEqual(await resume('2026-04-01'), ['journée']);
    assert.deepEqual(await resume('2026-04-02'), ['17:00']);
    assert.deepEqual(await resume('2026-04-03'), ['19:00']);
    assert.deepEqual(await resume('2026-04-04'), ['journée']);
  });

  test('le premier jour d une série compte même s il ne suit pas la règle', async () => {
    assert.deepEqual((await jour('2026-11-09')).map((e) => e.summary), ['Cours déplacé']);
    assert.deepEqual(await jour('2026-11-10'), []);
  });
});

describe('événements à heure fixe', () => {
  test('une répétition garde son heure de Paris en été', async () => {
    const [cours] = await jour('2026-09-09');
    assert.equal(cours.startTime, '18:30');
    assert.equal(cours.endTime, '19:30');
    assert.equal(cours.start, '2026-09-09T16:30:00.000Z');
  });

  test('et après le passage à l heure d hiver', async () => {
    const [cours] = await seulement('Cours', '2026-11-04');
    assert.equal(cours.startTime, '18:30');
    assert.equal(cours.start, '2026-11-04T17:30:00.000Z');
  });

  test('un lieu replié sur deux lignes est recollé', async () => {
    const [cours] = await jour('2026-09-09');
    assert.equal(cours.location, 'Maison des associations, 35500 Vitré');
  });

  test('une occurrence décalée le même jour prend son nouvel horaire', async () => {
    const evenements = await jour('2026-10-07');
    assert.equal(evenements.length, 1);
    assert.equal(evenements[0].summary, 'Cours du soir (décalé)');
    assert.equal(evenements[0].startTime, '20:00');
  });

  test('une occurrence déplacée à un autre jour apparaît à sa nouvelle date', async () => {
    const mardi = await jour('2026-10-13');
    assert.deepEqual(mardi.map((e) => e.summary), ['Cours du soir (avancé au mardi)']);
    assert.deepEqual(await jour('2026-10-14'), []);
  });

  test('un horaire en temps universel est affiché à l heure de Paris', async () => {
    const [veto] = await jour('2026-10-03');
    assert.equal(veto.startTime, '10:00');
    assert.equal(veto.endTime, '11:30');
  });

  test('un événement qui passe minuit apparaît sur les deux jours', async () => {
    assert.equal((await jour('2026-11-14')).length, 1);
    assert.equal((await jour('2026-11-15')).length, 1);
  });

  test('une répétition limitée en nombre s arrête au bon jour', async () => {
    assert.equal((await jour('2026-09-22')).filter((e) => e.summary === 'Soins').length, 1);
    assert.equal((await jour('2026-09-23')).filter((e) => e.summary === 'Soins').length, 0);
  });

  test('une règle de répétition non comprise ne bloque pas l agenda', async () => {
    const evenements = await jour('2026-09-01');
    assert.ok(evenements.some((e) => e.summary === 'Règle rare'));
  });
});

describe('seuls les déplacements apparaissent', () => {
  test('les invitations reçues n apparaissent pas, vacances comprises', async () => {
    assert.deepEqual(await jour('2026-09-03'), []);
    assert.deepEqual((await jour('2026-09-11')).map((e) => e.summary), ['Cours du soir']);
  });

  test('un événement dont l organisatrice est la propriétaire reste visible', async () => {
    const [atelier] = await jour('2026-09-12');
    assert.equal(atelier.summary, 'Atelier');
    assert.equal(atelier.location, 'Domagné');
  });

  test('formation sans lieu, visio et appel sont écartés, la visite reste', async () => {
    assert.deepEqual((await jour('2026-10-12')).map((e) => e.summary), ['PV chat C']);
  });

  test('ce qui compte comme une adresse physique', () => {
    for (const lieu of ['Vitré', '1 Rue des Lilas, 35000 Rennes, France', '15 Rés des Tilleuls']) {
      assert.equal(adressePhysique(lieu), true, lieu);
    }
    for (const lieu of [undefined, '', '  ', 'https://zoom.us/j/1', 'Réunion Microsoft Teams',
      'Google Meet (instructions dans la description)', 'Visio', 'En ligne', '0600000000', '+33600000000']) {
      assert.equal(adressePhysique(lieu), false, String(lieu));
    }
  });
});

describe('ordre et erreurs', () => {
  test('les journées entières passent avant les horaires', async () => {
    const evenements = await jour('2026-10-23');
    assert.deepEqual(evenements.map((e) => e.allDay), [true, false]);
  });

  test('une date mal formée est refusée', async () => {
    await assert.rejects(jour('2026-13-45'), { code: 'DATE_INVALIDE' });
    await assert.rejects(jour('demain'), { code: 'DATE_INVALIDE' });
  });

  test('un agenda injoignable est signalé', async () => {
    await assert.rejects(
      jour('2026-10-23', { lire: async () => new Response('', { status: 404 }) }),
      { code: 'AGENDA_INJOIGNABLE' },
    );
  });

  test('une réponse qui n est pas un agenda est signalée', async () => {
    await assert.rejects(
      jour('2026-10-23', { lire: async () => new Response('<html></html>', { status: 200 }) }),
      { code: 'AGENDA_ILLISIBLE' },
    );
  });

  test('si Google refuse, la dernière lecture réussie est servie', async () => {
    await jour('2026-10-23', { maintenant: 0 });
    const panne = async () => { throw new Error('réseau'); };
    const evenements = await seulement('Garde', '2026-10-23', { lire: panne, maintenant: 60 * 60 * 1000 });
    assert.equal(evenements.length, 1);
  });

  test('le flux n est relu qu après cinq minutes', async () => {
    let lectures = 0;
    const compter = async () => { lectures += 1; return new Response(FLUX, { status: 200 }); };
    await jour('2026-10-23', { lire: compter, maintenant: 0 });
    await jour('2026-10-24', { lire: compter, maintenant: 4 * 60 * 1000 });
    await jour('2026-10-24', { lire: compter, maintenant: 6 * 60 * 1000 });
    assert.equal(lectures, 2);
  });

  test('aujourd hui se calcule à l heure de Paris', () => {
    assert.equal(aujourdhuiAParis(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
  });

  test('un flux vide ne contient aucun événement', () => {
    assert.deepEqual(analyserIcal('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), []);
  });
});

describe('état de l agenda', () => {
  test('il dit seulement si l agenda est lu, et combien de répétitions restent incomprises', async () => {
    const etat = await etatAgenda('https://agenda.test/prive.ics', { lire });
    assert.deepEqual(etat, { ok: true, reglesNonComprises: 1 });
  });

  test('un agenda injoignable est une erreur', async () => {
    await assert.rejects(
      etatAgenda('https://agenda.test/prive.ics', { lire: async () => new Response('', { status: 500 }) }),
      { code: 'AGENDA_INJOIGNABLE' },
    );
  });
});
