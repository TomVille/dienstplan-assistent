# Dienstplan-Assistent

Desktop-App (macOS) für den monatlichen Dienstplan eines kleinen Pflegeteams: Vorschlag erzeugen, Dienste per Hand verschieben, Stundenkonto und Hinweise immer im Blick, Excel- und Word-Export.

## Installation (Stine)

1. Unter **Releases** die neueste `.dmg` laden und öffnen, das Programm in den Ordner „Programme“ ziehen.
2. Beim ersten Start: Rechtsklick auf das Programm → **Öffnen** → „Öffnen“ bestätigen (die App ist nicht bei Apple registriert, deshalb fragt macOS einmal nach). Danach startet sie normal.
3. Die Daten liegen in `~/Library/Application Support/de.regiovision.dienstplan-assistent/dienstplan.sqlite`. Eine Sicherung als JSON gibt es in den Einstellungen.

Updates: Die App prüft beim Start, ob es eine neue Version gibt, und fragt, ob sie installiert werden soll. Die Daten bleiben dabei erhalten.

## Entwicklung (Tom)

Voraussetzungen: Node 22, Rust (stable), Xcode Command Line Tools.

```
npm install
npm run dev          # App mit Live-Reload starten
npm run build        # lokal bauen (src-tauri/target/release/bundle)
```

Neue Version veröffentlichen:

```
npm run release -- 1.1.0 "Was ist neu"
git push && git push origin v1.1.0
```

GitHub Actions baut dann die universelle macOS-App, signiert die Update-Datei und legt den Release mit `latest.json` an. Dafür müssen im Repo zwei Secrets gesetzt sein: `TAURI_SIGNING_PRIVATE_KEY` (Inhalt der Datei `.tauri-signing/dienstplan.key`) und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (leer lassen, wenn der Schlüssel ohne Passwort erzeugt wurde).

Die Oberfläche ist eine einzelne Datei `src/index.html`, die auch ohne App im Browser läuft (dann mit Browser-Speicher statt SQLite). Das Datenbankschema liegt in `src-tauri/migrations/`.
