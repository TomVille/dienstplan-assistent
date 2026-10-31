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
