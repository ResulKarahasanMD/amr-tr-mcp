// Veri yükleme: çıkarıcının ürettiği JSON ve isteğe bağlı yerel antibiyogram CSV'si.
import { readFileSync } from "node:fs";

export const loadData = (path) => JSON.parse(readFileSync(path, "utf8"));

export const MIN_N = 30; // CLSI M39: 30'dan az izolatla yüzde raporlanmaz

function parseCsv(text) {
  const head = text.slice(0, text.indexOf("\n") + 1 || undefined);
  const sep = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * Beklenen başlık: pathogen, antibiotic, n, r_pct  (+ isteğe bağlı source, year, specimen, setting)
 * Ayırıcı virgül ya da noktalı virgül; ondalık virgül kabul edilir. Geçersiz satır atlanır ve raporlanır.
 */
export function loadLocal(path) {
  if (!path) return { path: null, rows: [], errors: [] };
  let text;
  try { text = readFileSync(path, "utf8").replace(/^﻿/, ""); }
  catch (e) { return { path, rows: [], errors: [`dosya okunamadı: ${e.message}`] }; }
  const [header, ...lines] = parseCsv(text);
  const cols = (header || []).map((h) => h.trim().toLowerCase());
  const missing = ["pathogen", "antibiotic", "n", "r_pct"].filter((c) => !cols.includes(c));
  if (missing.length) return { path, rows: [], errors: [`eksik sütun: ${missing.join(", ")}`] };
  const rows = [], errors = [];
  lines.forEach((line, i) => {
    const r = Object.fromEntries(cols.map((c, j) => [c, (line[j] ?? "").trim()]));
    const n = Number(r.n), pct = Number(r.r_pct.replace(",", "."));
    const bad =
      !r.pathogen || !r.antibiotic ? "bakteri/antibiyotik boş"
      : !Number.isInteger(n) || n < 1 ? `n geçersiz ('${r.n}')`
      : r.r_pct === "" || !Number.isFinite(pct) || pct < 0 || pct > 100 ? `r_pct geçersiz ('${r.r_pct}')`
      : null;
    if (bad) errors.push(`satır ${i + 2}: ${bad}`);
    else rows.push({ ...r, n, r_pct: pct, year: r.year ? Number(r.year) : null });
  });
  return { path, rows, errors };
}
