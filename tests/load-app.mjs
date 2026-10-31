// Lädt den App-Code (letzter <script> in src/index.html) mit Mini-DOM in node:vm und legt Interna auf window.__t.
import fs from "node:fs";
import vm from "node:vm";

const HTML = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const EXPOSE = 'window.__t={vorschlag:vorschlag,setMonth:setMonth,stats:stats,hints:hints,sollOf:sollOf,konto:konto,footer:footer,blocked:blocked,pdfBytes:pdfBytes,person:person,prevKey:prevKey,' +
  'get S(){return S},get cur(){return cur},get N(){return N},get HOL(){return HOL}};})();';

function el() {
  const e = { innerHTML: "", textContent: "", value: "", hidden: false, dataset: {}, style: {}, className: "", L: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener(t, f) { (e.L[t] = e.L[t] || []).push(f); },
    querySelector() { return el(); }, querySelectorAll() { return []; }, appendChild() {}, closest() { return null; }, focus() {}, remove() {}, click() {} };
  return e;
}

export async function loadApp({ XLSX } = {}) {
  const start = HTML.lastIndexOf("<script>");
  let js = HTML.slice(start + 8, HTML.lastIndexOf("</script>"));
  const patched = js.replace(/\}\)\(\);\s*$/, EXPOSE);
  if (patched === js) throw new Error("load-app: Ende des App-Scripts `})();` nicht gefunden – Injection fehlgeschlagen");
  const els = {}, store = {};
  const doc = { getElementById: (id) => els[id] || (els[id] = el()), querySelector: () => el(), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => el(), body: el() };
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  // FileReader-Stub: liefert sofort einen leeren Puffer (XLSX wird im Test gestubbt)
  function FileReader() {}
  FileReader.prototype.readAsArrayBuffer = function () { this.onload({ target: { result: new ArrayBuffer(0) } }); };
  FileReader.prototype.readAsText = function () { this.onload({ target: { result: "" } }); };
  const ctx = { window: win, document: doc, localStorage: win.localStorage, console, setTimeout() {}, clearTimeout() {},
    Promise, Date, JSON, Math, URL: {}, Blob: function () {}, navigator: {}, FileReader, XLSX };
  vm.createContext(ctx);
  vm.runInContext(patched, ctx);
  await new Promise((r) => setImmediate(r)); // initStore() ist async
  const t = win.__t;
  if (!t || !t.S) throw new Error("load-app: App nicht initialisiert (window.__t / S fehlt)");
  return { t, els, ctx };
}
