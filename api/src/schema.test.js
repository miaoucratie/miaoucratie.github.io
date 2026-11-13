import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { descriptionDuSchema, migrations, sqliteDepuisSchema } from "./base-de-test.js";

const AJOUT_COLONNE = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi;
const CREATION_TABLE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
const CREATION_INDEX = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;

function ceQueCreeLaMigration(sql) {
  return {
    colonnes: [...sql.matchAll(AJOUT_COLONNE)].map(([, table, colonne]) => ({ table, colonne })),
    tables: [...sql.matchAll(CREATION_TABLE)].map(([, table]) => table),
    index: [...sql.matchAll(CREATION_INDEX)].map(([, index]) => index),
  };
}

describe("schéma et migrations", () => {
  test("le schéma se construit sur une base vide", () => {
    const { tables } = descriptionDuSchema(sqliteDepuisSchema());
    assert.deepEqual(
      tables.map(({ table }) => table),
      ["admin_login_attempts", "reservation_requests", "unavailability_periods"]
    );
  });

  test("il existe au moins une migration", () => {
    assert.ok(migrations().length > 0);
  });

  for (const { nom, sql } of migrations()) {
    test(`${nom} rend la base identique au schéma, colonne par colonne`, () => {
      const cree = ceQueCreeLaMigration(sql);
      assert.ok(
        cree.colonnes.length + cree.tables.length + cree.index.length > 0,
        `${nom} : aucune instruction reconnue`
      );

      const attendu = descriptionDuSchema(sqliteDepuisSchema());
      const base = sqliteDepuisSchema();

      for (const index of cree.index) base.exec(`DROP INDEX IF EXISTS ${index}`);
      for (const table of cree.tables) base.exec(`DROP TABLE IF EXISTS ${table}`);
      for (const { table, colonne } of cree.colonnes) {
        base.exec(`ALTER TABLE ${table} DROP COLUMN ${colonne}`);
      }

      const avant = descriptionDuSchema(base);
      assert.notDeepEqual(avant, attendu, `${nom} : le retrait n'a rien changé`);

      base.exec(sql);
      assert.deepEqual(descriptionDuSchema(base), attendu);
    });
  }
});
