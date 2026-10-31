import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load-app.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Realm vergleichbar machen

// Monat sauber setzen (m 0-basiert)
function fresh(t, y, m) {
  t.setMonth(y, m);
  const c = t.cur;
  c.plan = {}; c.vg = {}; c.termin = {}; c.notes = {}; c.uebertrag = {}; c.ovr = {}; c.prevNight = "";
  return c;
}

test("Stunden: 20 h pro Dienst, 5 h am Monatsletzten, +15 h für Vornacht", async () => {
  const { t } = await loadApp();
  const c = fresh(t, 2026, 10); // November: 30 Tage
  c.plan = { 1: "laura", 2: "laura", 30: "laura", 5: "marie" };
  let s = t.stats();
  assert.equal(s.laura.h, 45);
  assert.equal(s.laura.n, 3);
  assert.equal(s.marie.h, 20);
  assert.equal(s.steffi.h, 0);
  c.prevNight = "steffi";
  c.uebertrag = { steffi: 7 };
  s = t.stats();
  assert.equal(s.steffi.h, 15);
  assert.equal(s.steffi.n, 0);
  assert.equal(s.steffi.ist, 22);
  assert.equal(s.stine.soll, 168);
});

test("Monats-Soll-Abweichung wirkt in Konto, Bilanz und Fußzeile", async () => {
  const { t, els } = await loadApp();
  const c = fresh(t, 2026, 10);
  c.ovr = { stine: { soll: 100 } };
  assert.equal(t.sollOf(t.person("stine")), 100);
  t.konto();
  const stine = els.konto.innerHTML.split('<div class="person">').find((x) => x.includes(">Stine<"));
  assert.ok(stine, "Stine fehlt im Konto");
  assert.match(stine, /\/ 100 h/);
  // 120 + 144 + 168 + 100 statt 120 + 144 + 168 + 168
  assert.match(els.bilanz.innerHTML, /Soll-Summe Team<\/dt><dd>532 h/);
  assert.ok(t.footer().some((l) => l.startsWith("Stine ") && l.includes("/100 Std.")), t.footer().join(" | "));
});

test("Übertrag nutzt das Monats-Soll des Vormonats, sonst das feste Soll", async () => {
  const { t, els } = await loadApp();
  // Oktober 2026 (31 Tage) vor dem Wechsel anlegen
  t.S.months["2026-10"] = {
    plan: { 1: "stine", 2: "stine", 31: "stine", 10: "marie" }, // Stine 45 h, Marie 20 h
    vg: {}, termin: {}, notes: {}, prevNight: "stine",            // Stine +15 h
    uebertrag: { stine: 10, marie: -4 },
    ovr: { stine: { soll: 100 } },
  };
  const c = fresh(t, 2026, 10);
  assert.equal(t.prevKey(), "2026-10");
  els.btnUebertrag.L.click[0]();
  assert.equal(c.uebertrag.stine, 45 + 15 + 10 - 100);
  assert.equal(c.uebertrag.marie, 20 - 4 - 144);
  assert.equal(c.uebertrag.laura, 0 - 120);
});

const VG = {
  stine: { 12: "U", 13: "U", 14: "U" },
  laura: { 3: "F", 20: "T" },
  marie: { 9: "F", 16: "T" },
  steffi: { 25: "U", 26: "U", 6: "T" },
};
for (const [y, m] of [[2026, 10], [2026, 11], [2027, 1]]) {
  test(`Vorschlag ${y}-${m + 1}: Vorgaben werden eingehalten`, async () => {
    const { t } = await loadApp();
    const c = fresh(t, y, m);
    c.vg = plain(VG);
    const plan = plain(t.vorschlag());
    assert.ok(Object.keys(plan).length >= t.N - 2, `Plan fast leer: ${Object.keys(plan).length}/${t.N} Tage`);
    const ids = t.S.persons.filter((p) => p.aktiv).map((p) => p.id);
    for (const [d, pid] of Object.entries(plan)) {
      assert.ok(ids.includes(pid), `Tag ${d}: unbekannte/inaktive Person ${pid}`);
      assert.ok(!t.blocked(pid, +d), `Tag ${d}: ${pid} trotz U/F (am Tag oder Folgetag) eingeplant`);
    }
    for (const [pid, days] of Object.entries(VG))
      for (const [d, v] of Object.entries(days))
        if (v === "T" && +d <= t.N) assert.equal(plan[d], pid, `Termin-Tag ${d} gehört ${pid}`);
  });
}

test("Hinweis: Dienst am Urlaubstag ist kritisch", async () => {
  const { t } = await loadApp();
  const c = fresh(t, 2026, 10);
  c.vg = { stine: { 12: "U" } };
  c.plan = { 12: "stine" };
  const crit = t.hints(t.stats()).filter((h) => h[0] === "crit").map((h) => h[1]);
  assert.ok(crit.some((x) => x.includes("Stine am 12.") && x.includes("Urlaub")), crit.join(" | "));
});

test("Excel-Import: Notizen werden zusammengeführt, Auto-Texte nicht doppelt übernommen", async () => {
  let aoa;
  const XLSX = { read: () => ({ SheetNames: ["P"], Sheets: { P: {} } }), utils: { sheet_to_json: () => aoa } };
  const { t, els } = await loadApp({ XLSX });
  const c = fresh(t, 2026, 11); // Dezember 2026
  c.notes = { 3: "alt", 5: "bleibt" };
  c.vg = { laura: { 20: "T" } };
  c.termin = { laura: { 20: "EEG" } };
  const hol25 = t.HOL[25];
  assert.ok(hol25, "25.12. sollte Feiertag sein");
  aoa = [
    ["Dienstplan Dezember 2026"],
    ["Datum", "Tag", "Früh", "Spät", "Nacht", "Notiz"],
    ["3.", "Do", "", "", "Laura", "neu"],
    ["20.", "So", "", "", "Laura", "EEG, Zahnarzt"],
    ["25.", "Fr", "", "", "Marie", hol25],
  ];
  els.fileXls.files = [{ name: "plan.xlsx" }];
  els.fileXls.L.change[0].call(els.fileXls);
  assert.deepEqual(plain(t.cur.plan), { 3: "laura", 20: "laura", 25: "marie" });
  assert.deepEqual(plain(t.cur.notes), { 3: "neu", 5: "bleibt", 20: "Zahnarzt" });
});

test("PDF-Export: gültige Struktur, xref-Offsets stimmen, Umlaute als WinAnsi", async () => {
  const { t } = await loadApp();
  const c = fresh(t, 2026, 11);
  for (let d = 1; d <= 31; d++) c.plan[d] = d % 2 ? "laura" : "marie";
  c.notes = { 3: "Arzttermin (Zähne) bei Dr. Müller – bitte früher kommen, sonst Ärger mit der Übergabe" };
  const u = t.pdfBytes();
  const s = Buffer.from(u).toString("latin1");
  assert.ok(s.startsWith("%PDF-"));
  assert.ok(s.endsWith("%%EOF"));
  const xr = +s.match(/startxref\n(\d+)/)[1];
  assert.ok(s.startsWith("xref", xr));
  const offs = [...s.slice(xr).matchAll(/(\d{10}) 00000 n /g)].map((m) => +m[1]);
  assert.equal(offs.length, 6);
  offs.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o), `Objekt ${i + 1} an Offset ${o}`));
  assert.ok(u.includes(0xe4), "ä als 0xE4");
  assert.ok(s.includes("\\(Z"), "Klammern escaped");
  assert.ok(u.includes(0x85), "lange Notiz mit … gekürzt");
  const len = +s.match(/\/Length (\d+)/)[1], st = s.indexOf("stream\n") + 7;
  assert.equal(s.slice(st + len, st + len + 10), "\nendstream");
});

// ---------- strenge Regeln im Vorschlag ----------
const weKey = (y, m, d) => { const w = new Date(y, m, d).getDay(); return w === 5 ? d + 1 : w === 6 ? d : w === 0 ? d - 1 : null; };
const isoEven = (y, m, d) => { const t = new Date(Date.UTC(y, m, d)), n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7) % 2 === 0; };
function runsOf(plan, pid, N) { const r = []; for (let d = 1; d <= N; d++) if (plan[d] === pid && plan[d - 1] !== pid) { let e = d; while (plan[e + 1] === pid) e++; r.push([d, e]); } return r; }
// erlaubte Hinweise: leere Tage, Vornacht, Soll nicht erreicht, weiche WE-Empfehlung ohne eigene Regel
const ALLOWED = [/ohne Besetzung/, /Vormonats unbekannt/, / statt genau /, / h, Ziel /, /möglichst max\. 2/];

for (const [y, m] of [[2026, 10], [2026, 11], [2027, 1], [2027, 3]]) for (const withVg of [false, true]) {
  test(`Vorschlag ${y}-${m + 1}${withVg ? " mit Vorgaben" : ""}: Regeln werden streng eingehalten`, async () => {
    const { t } = await loadApp();
    const c = fresh(t, y, m);
    if (withVg) c.vg = plain(VG);
    c.plan = t.vorschlag();
    const plan = plain(c.plan), N = t.N, s = t.stats();
    const isT = (pid, [a, b]) => { for (let d = a; d <= b; d++) if (withVg && (VG[pid] || {})[d] === "T") return true; return false; };
    const dow = (d) => new Date(y, m, d).getDay();
    if (!withVg) {
      const bad = t.hints(s).filter((h) => h[0] !== "ok" && !ALLOWED.some((r) => r.test(h[1])));
      assert.deepEqual(plain(bad), []);
    }
    for (const r of runsOf(plan, "steffi", N)) {
      assert.ok(r[1] - r[0] + 1 <= 4, `Steffi ${r} länger als 4`);
      if (!isT("steffi", r)) assert.ok(r[1] - r[0] + 1 >= 3, `Steffi ${r} kürzer als 3`);
    }
    for (const p of t.S.persons) {
      if (p.weMax == null) continue;
      const we = new Set(); for (let d = 1; d <= N; d++) if (plan[d] === p.id && weKey(y, m, d) !== null) we.add(weKey(y, m, d));
      assert.ok(we.size <= p.weMax, `${p.name} ${we.size} Wochenenden`);
    }
    for (const r of runsOf(plan, "laura", N)) if (!isT("laura", r))
      assert.ok(r[1] - r[0] === 2 && dow(r[0]) === 4 && isoEven(y, m, r[0]), `Laura ${r} ist kein ganzer Do–Sa-Block in gerader KW`);
    let pairs = 0;
    for (const r of runsOf(plan, "marie", N)) {
      if (isT("marie", r)) continue;
      if (r[1] === r[0] + 1 && dow(r[0]) === 6) { pairs++; continue; }
      assert.ok(r[0] === r[1] && dow(r[0]) >= 1 && dow(r[0]) <= 4, `Marie ${r} ist kein Einzeldienst Mo–Do`);
    }
    assert.ok(pairs <= 1, `Marie ${pairs} Sa+So-Paare`);
    // niemand außer „füllt Rest“ über dem gerundeten Ziel (mehr als einen halben Dienst bzw. halben Muster-Block drüber)
    for (const p of t.S.persons) if (!p.rest) assert.ok(s[p.id].h - t.sollOf(p) < (p.muster ? p.muster.len * 10 : 10), `${p.name} ${s[p.id].h} h bei Soll ${t.sollOf(p)}`);
  });
}

test("Stundenziel: auf den nächsten ganzen Dienst gerundet, mit Übertrag und Vornacht", async () => {
  const { t } = await loadApp();
  for (const p of t.S.persons) if (p.id !== "stine") p.aktiv = false;
  // Dezember 2026: 20 h je Dienst, der 31. zählt 5 h. [Übertrag, Vornacht, nächstmögliche Plan-Stunden]
  // 168 → 165 (8×20+5); 168+12 = 180 → 180; 168−30 = 138 → 140; 168−5−15 = 148 → 145
  for (const [ueb, pn, want] of [[0, "", 165], [-12, "", 180], [30, "", 140], [5, "stine", 145]]) {
    const c = fresh(t, 2026, 11);
    c.uebertrag = { stine: ueb }; c.prevNight = pn;
    c.plan = t.vorschlag();
    const h = t.stats().stine.h - (pn ? 15 : 0);
    assert.equal(h, want, `Übertrag ${ueb}, Vornacht ${pn || "-"}`);
  }
});

test("Hinweis: Sa+So am Stück ist bei „nur als Sa+So“ kein Verstoß gegen Einzeldienste", async () => {
  const { t } = await loadApp();
  const c = fresh(t, 2026, 10); // 7./8. November 2026 = Sa/So
  c.plan = { 7: "marie", 8: "marie", 10: "marie" };
  const w = () => t.hints(t.stats()).map((h) => h[1]).filter((x) => x.includes("Marie hat mehr als einen Dienst"));
  assert.deepEqual(plain(w()), []);
  c.plan = { 10: "marie", 11: "marie" };
  assert.equal(w().length, 1);
});

test("Marie: alte Regel Mo–Do bekommt einmalig Sa+So, bewusst entfernt bleibt entfernt", async () => {
  const KEY = "dienstplan-assistent-v1";
  const old = { persons: [{ id: "marie", name: "Marie", soll: 144, aktiv: true, runMax: 1, weMax: 1, wePaar: true, weStart: 6, tage: [1, 2, 3, 4], off: {} }], months: {} };
  let { t } = await loadApp({ store: { [KEY]: JSON.stringify(old) } });
  const p = t.person("marie");
  assert.deepEqual(plain(p.tage).sort(), [0, 1, 2, 3, 4, 6]);
  assert.equal(t.rulesOf(p).fix1, 1, "Merker wird mit den Regeln gespeichert (auch in der Datenbank)");
  p.tage = [1, 2, 3, 4]; // später bewusst wieder entfernt
  ({ t } = await loadApp({ store: { [KEY]: JSON.stringify(t.S) } }));
  assert.deepEqual(plain(t.person("marie").tage), [1, 2, 3, 4]);
  ({ t } = await loadApp()); // Neuinstallation: Sa+So schon in der Vorlage
  assert.deepEqual(plain(t.person("marie").tage).sort(), [0, 1, 2, 3, 4, 6]);
});

// ---------- App-Modus (Tauri + SQLite) ----------
function fakeTauri({ loadFails } = {}) {
  const f = { invokes: [], fail: false };
  const db = { execute: async () => { throw new Error("DB.execute darf zum Speichern nicht mehr benutzt werden"); },
    select: async (q) => (q.includes("FROM personen") ? [{ id: "stine", name: "Stine", soll: 168, aktiv: 1, regeln: "{}" }] : []) };
  f.tauri = {
    sql: { Database: { load: async () => { if (loadFails) throw new Error("kaputt"); return db; } } },
    core: { invoke: async (cmd, args) => { if (f.fail) throw "Platte voll"; f.invokes.push([cmd, plain(args)]); } },
  };
  return f;
}
const dienste = (inv) => Object.values(inv[1].data.months).map((m) => m.dienste);

test("Speichern: Monatswechsel direkt nach Änderung – beide Monate landen in EINEM save_data", async () => {
  const f = fakeTauri();
  const { t, els, flush } = await loadApp({ tauri: f.tauri });
  t.assign(3, "stine");
  els.nextM.L.click[0]();
  t.assign(4, "stine");
  assert.equal(f.invokes.length, 0, "erst nach dem Debounce speichern");
  await flush();
  assert.equal(f.invokes.length, 1);
  const [cmd, args] = f.invokes[0];
  assert.equal(cmd, "save_data");
  assert.equal(args.data.replace_all, false);
  assert.deepEqual(args.data.persons.map((p) => p.id), ["stine"]);
  assert.deepEqual(dienste(f.invokes[0]).sort(), [[[3, "stine"]], [[4, "stine"]]]);
  assert.match(els.status.textContent, /^Gespeichert/);
});

test("Speichern: Fehler → Monate bleiben vorgemerkt und werden beim nächsten Mal mitgeschrieben", async () => {
  const f = fakeTauri();
  const { t, els, flush } = await loadApp({ tauri: f.tauri });
  f.fail = true;
  t.assign(3, "stine");
  await flush();
  assert.equal(f.invokes.length, 0);
  assert.match(els.status.textContent, /Speichern fehlgeschlagen: Platte voll/);
  f.fail = false;
  els.nextM.L.click[0]();
  t.assign(4, "stine");
  await flush();
  assert.equal(f.invokes.length, 1);
  assert.deepEqual(dienste(f.invokes[0]).sort(), [[[3, "stine"]], [[4, "stine"]]]);
});

test("Datenbank startet nicht: kein Monat, klare Meldung, kein Browser-Speicher", async () => {
  const f = fakeTauri({ loadFails: true });
  const { t, els, ls } = await loadApp({ tauri: f.tauri, noInit: true });
  assert.equal(t.S, undefined);
  assert.equal(els.rows?.innerHTML || "", "");
  assert.equal(els.monthLabel?.textContent || "", "");
  assert.match(els.status.textContent, /Datenbank nicht erreichbar/);
  assert.equal(ls.calls, 0, "localStorage darf nicht benutzt werden");
});

// ---------- Hinweise, Rückgängig, Escaping ----------
test("Hinweis „genau“ rechnet mit Übertrag; jeder Personen-Hinweis trägt die Person-ID", async () => {
  const { t } = await loadApp();
  const c = fresh(t, 2026, 10);
  const stine = t.person("stine");
  stine.exakt = true;
  c.ovr = { stine: { soll: 120 } };
  c.uebertrag = { stine: 20 };
  c.plan = { 2: "stine", 3: "stine", 4: "stine", 5: "stine", 6: "stine" }; // 5 × 20 h = 100 h, + 20 h Übertrag = 120 h
  let h = plain(t.hints(t.stats()));
  assert.ok(!h.some((x) => x[2] === "stine" && x[1].includes("statt genau")), h.map((x) => x[1]).join(" | "));
  // viele Verstöße verschiedener Personen erzeugen
  c.vg = { laura: { 10: "T" }, marie: { 12: "U" } };
  c.plan = { 1: "marie", 2: "marie", 3: "marie", 10: "steffi", 12: "marie", 14: "laura", 20: "stine" };
  h = plain(t.hints(t.stats()));
  const names = t.S.persons.map((p) => [p.id, p.name]);
  let n = 0;
  for (const x of h) {
    const hit = names.filter(([, nm]) => x[1].includes(nm));
    if (!hit.length) continue;
    n++;
    assert.ok(hit.some(([id]) => id === x[2]), `Hinweis ohne passende Person-ID: ${JSON.stringify(x)}`);
  }
  assert.ok(n >= 4, `zu wenige Personen-Hinweise: ${n}`);
});

test("Rückgängig nach Excel-Import stellt Notizen wieder her", async () => {
  const XLSX = { read: () => ({ SheetNames: ["P"], Sheets: { P: {} } }), utils: { sheet_to_json: () => [
    ["Dienstplan Dezember 2026"], ["Datum", "Tag", "Früh", "Spät", "Nacht", "Notiz"], ["3.", "Do", "", "", "Laura", "neu"]] } };
  const { t, els } = await loadApp({ XLSX });
  const c = fresh(t, 2026, 11);
  c.notes = { 3: "alt", 5: "bleibt" };
  els.fileXls.files = [{ name: "plan.xlsx" }];
  els.fileXls.L.change[0].call(els.fileXls);
  assert.deepEqual(plain(t.cur.notes), { 3: "neu", 5: "bleibt" });
  els.btnUndo.L.click[0]();
  assert.deepEqual(plain(t.cur.plan), {});
  assert.deepEqual(plain(t.cur.notes), { 3: "alt", 5: "bleibt" });
});

test("Rückgängig nach Zuteilen lässt später bearbeitete Notizen in Ruhe", async () => {
  const { t, els } = await loadApp();
  const c = fresh(t, 2026, 10);
  c.notes = { 1: "a" };
  t.assign(3, "laura");
  t.cur.notes[7] = "später";
  els.btnUndo.L.click[0]();
  assert.deepEqual(plain(t.cur.plan), {});
  assert.deepEqual(plain(t.cur.notes), { 1: "a", 7: "später" });
});

test("Namen werden in der Plantabelle escaped", async () => {
  const { t, els } = await loadApp();
  const c = fresh(t, 2026, 10);
  t.S.persons.push({ id: "x", name: "<b>X", soll: 0, aktiv: true, off: {} });
  c.plan = { 2: "x", 3: "x" };
  t.renderPlan();
  assert.ok(els.rows.innerHTML.includes("&lt;b&gt;X"));
  assert.ok(!els.rows.innerHTML.includes("<b>X"), "roher Name im HTML");
});
