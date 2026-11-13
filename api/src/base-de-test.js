// Base D1 de test

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DOSSIER_API = new URL("../", import.meta.url);

export const SCHEMA = readFileSync(new URL("schema.sql", DOSSIER_API), "utf8");

export function migrations() {
  const dossier = new URL("migrations/", DOSSIER_API);
  return readdirSync(dossier)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .map((nom) => ({ nom, sql: readFileSync(new URL(nom, dossier), "utf8") }));
}

export function sqliteDepuisSchema() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  return sqlite;
}

export function baseD1(sqlite = sqliteDepuisSchema()) {
  const requetes = [];

  const preparer = (sql, valeurs = []) => ({
    bind: (...nouvelles) => preparer(sql, nouvelles),
    async first() {
      const ligne = sqlite.prepare(sql).get(...valeurs);
      return ligne ? { ...ligne } : null;
    },
    async all() {
      const lignes = sqlite.prepare(sql).all(...valeurs).map((ligne) => ({ ...ligne }));
      return { success: true, results: lignes, meta: {} };
    },
    async run() {
      const { changes, lastInsertRowid } = sqlite.prepare(sql).run(...valeurs);
      return {
        success: true,
        results: [],
        meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) },
      };
    },
  });

  return {
    sqlite,
    requetes,
    prepare(sql) {
      requetes.push(sql);
      return preparer(sql);
    },
  };
}

// Schéma comparable
export function descriptionDuSchema(sqlite) {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(({ name }) => ({
      table: name,
      colonnes: sqlite
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map(({ name: colonne, type, notnull, dflt_value, pk }) => ({ colonne, type, notnull, dflt_value, pk }))
        .sort((a, b) => a.colonne.localeCompare(b.colonne)),
    }));

  const index = sqlite
    .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
    .all()
    .map(({ name, tbl_name }) => ({
      index: name,
      table: tbl_name,
      colonnes: sqlite.prepare(`PRAGMA index_info(${name})`).all().map(({ name: colonne }) => colonne),
    }));

  return { tables, index };
}
