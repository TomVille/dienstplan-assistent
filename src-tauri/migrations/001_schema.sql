-- Dienstplan-Assistent, Schema Version 1
CREATE TABLE IF NOT EXISTS personen (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  soll INTEGER NOT NULL DEFAULT 0,
  aktiv INTEGER NOT NULL DEFAULT 1,
  reihenfolge INTEGER NOT NULL DEFAULT 0,
  regeln TEXT NOT NULL DEFAULT '{}'      -- JSON: runMin, runMax, phasenMax, weMax, wePaar, weDienstMax, weStart, tage, muster, exakt, rest, manuell, off
);
CREATE TABLE IF NOT EXISTS monate (
  monat TEXT PRIMARY KEY,                -- 'YYYY-MM'
  vornacht TEXT,                         -- Person, die am letzten Tag des Vormonats Nacht hatte
  uebertrag TEXT NOT NULL DEFAULT '{}'   -- JSON {personId: stunden}
);
CREATE TABLE IF NOT EXISTS dienste (
  monat TEXT NOT NULL,
  tag INTEGER NOT NULL,
  person TEXT NOT NULL,
  PRIMARY KEY (monat, tag)
);
CREATE TABLE IF NOT EXISTS vorgaben (
  monat TEXT NOT NULL,
  person TEXT NOT NULL,
  tag INTEGER NOT NULL,
  art TEXT NOT NULL,                     -- 'U' Urlaub, 'F' Wunschfrei, 'T' Termin
  stichwort TEXT,
  PRIMARY KEY (monat, person, tag)
);
CREATE TABLE IF NOT EXISTS notizen (
  monat TEXT NOT NULL,
  tag INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (monat, tag)
);
CREATE TABLE IF NOT EXISTS abweichungen (
  monat TEXT NOT NULL,
  person TEXT NOT NULL,
  feld TEXT NOT NULL,                    -- soll, weMax, weDienstMax, runMax
  wert INTEGER NOT NULL,
  PRIMARY KEY (monat, person, feld)
);
CREATE TABLE IF NOT EXISTS einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert TEXT
);
