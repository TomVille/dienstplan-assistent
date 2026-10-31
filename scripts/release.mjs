// Setzt die Versionsnummer an allen drei Stellen und legt den Git-Tag an.
// Aufruf: npm run release -- 1.1.0 "Kurzer Text, was neu ist"
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const [, , version, note] = process.argv;
if (!/^\d+\.\d+\.\d+$/.test(version || "")) { console.error("Aufruf: npm run release -- 1.1.0 \"Was ist neu\""); process.exit(1); }
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, "utf8")));
edit("package.json", s => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/tauri.conf.json", s => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/Cargo.toml", s => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));
edit("src/index.html", s => s.replace(/var APP_VERSION="[^"]+"/, `var APP_VERSION="${version}"`));
const date = new Date().toISOString().slice(0, 10);
edit("CHANGELOG.md", s => s.replace("# Änderungen\n", `# Änderungen\n\n## ${version} (${date})\n- ${note || "Kleinere Verbesserungen"}\n`));
execSync(`git add -A && git commit -m "Version ${version}" && git tag v${version}`, { stdio: "inherit" });
console.log(`\nFertig. Jetzt: git push && git push origin v${version}\nGitHub baut dann die App und veröffentlicht sie; die installierten Programme bekommen das Update beim nächsten Start angeboten.`);
