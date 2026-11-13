import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INTERDIT, texteVisible } from './redaction.mjs';

const interdit = (texte) => INTERDIT.some(([re]) => [...texte.matchAll(re)].length > 0);

describe('formulations refusees', () => {
  for (const phrase of [
    'Je ne suis pas psychologue, mais je connais les chats.',
    'Je ne suis pas une psychologue.',
    'Je ne suis pas psy.',
    'Je ne suis ni psychologue ni vétérinaire.',
    'Sans être psychologue, je connais les chats.',
    "N'étant pas psychologue, je ne peux pas.",
    'Je ne suis pas psychiatre.',
    'Je ne suis pas thérapeute.',
    'Je ne suis pas therapeute.',
    'Ce n’est pas une psychothérapeute.',
    'Les thérapeutes du deuil.',
  ]) {
    test(phrase, () => assert.equal(interdit(phrase), true));
  }
});

describe('formulations permises', () => {
  for (const phrase of [
    "Ce n'est ni une thérapie, ni un accompagnement psychologique.",
    'des psys, des éthologues, des comportementalistes félins',
    'Au-delà du bien-être psychologique, il y a des raisons pratiques.',
    'un effet thérapeutique',
  ]) {
    test(phrase, () => assert.equal(interdit(phrase), false));
  }
});

test('espece-de-deuil.html', () => {
  const html = readFileSync(new URL('../espece-de-deuil.html', import.meta.url), 'utf8');
  assert.equal(interdit(texteVisible(html)), false);
});
