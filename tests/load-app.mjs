// Lädt den App-Code (letzter <script> in src/index.html) mit Mini-DOM in node:vm und legt Interna auf window.__t.
import fs from "node:fs";
import vm from "node:vm";

const HTML = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const EXPOSE = 'window.__t={vorschlag:vorschlag,setMonth:setMonth,stats:stats,hints:hints,sollOf:sollOf,rulesOf:rulesOf,konto:konto,footer:footer,blocked:blocked,pdfBytes:pdfBytes,person:person,prevKey:prevKey,assign:assign,save:save,renderPlan:renderPlan,' +
  'get S(){return S},get cur(){return cur},get N(){return N},get HOL(){return HOL},get FER(){return FER}};})();';

function el() {
  const e = { innerHTML: "", textContent: "", value: "", hidden: false, dataset: {}, style: {}, className: "", L: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener(t, f) { (e.L[t] = e.L[t] || []).push(f); },
    querySelector() { return el(); }, querySelectorAll() { return []; }, appendChild() {}, closest() { return null; }, focus() {}, remove() {}, click() {} };
  return e;
}

// tauri: Stub für window.__TAURI__ (DB-Modus); noInit: Start darf scheitern (z. B. Datenbankfehler)
export async function loadApp({ XLSX, store: seed, tauri, noInit } = {}) {
  const start = HTML.lastIndexOf("<script>");
  let js = HTML.slice(start + 8, HTML.lastIndexOf("</script>"));
  const patched = js.replace(/\}\)\(\);\s*$/, EXPOSE);
  if (patched === js) throw new Error("load-app: Ende des App-Scripts `})();` nicht gefunden – Injection fehlgeschlagen");
  const els = {}, store = { ...(seed || {}) }; // seed: vorbelegter localStorage
  const doc = { getElementById: (id) => els[id] || (els[id] = el()), querySelector: () => el(), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => el(), body: el() };
  const ls = { calls: 0 }, timers = new Map(); let tid = 0;
  const win = { __TAURI__: tauri, localStorage: { getItem: (k) => (ls.calls++, store[k] ?? null), setItem: (k, v) => { ls.calls++; store[k] = v; } } };
  // FileReader-Stub: liefert sofort einen leeren Puffer (XLSX wird im Test gestubbt)
  function FileReader() {}
  FileReader.prototype.readAsArrayBuffer = function () { this.onload({ target: { result: new ArrayBuffer(0) } }); };
  FileReader.prototype.readAsText = function () { this.onload({ target: { result: "" } }); };
  const ctx = { window: win, document: doc, localStorage: win.localStorage, console, setTimeout: (f) => (timers.set(++tid, f), tid), clearTimeout: (i) => timers.delete(i),
    Promise, Date, JSON, Math, URL: {}, Blob: function () {}, navigator: {}, FileReader, XLSX };
  vm.createContext(ctx);
  vm.runInContext(patched, ctx);
  await new Promise((r) => setImmediate(r)); // initStore() ist async
  const t = win.__t;
  if (!t || (!t.S && !noInit)) throw new Error("load-app: App nicht initialisiert (window.__t / S fehlt)");
  // fällige Timer (z. B. Speicher-Debounce) ausführen und async Folgearbeit abwarten
  async function flush() { const fs_ = [...timers.values()]; timers.clear(); fs_.forEach((f) => f()); await new Promise((r) => setImmediate(r)); }
  return { t, els, ctx, ls, flush };
}
