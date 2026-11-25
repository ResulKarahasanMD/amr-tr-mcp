#!/usr/bin/env node
/**
 * Offline test: starts the server over stdio and exercises the tools against the real data/uamds.json.
 * The expected numbers were taken from the report's PDF text with a reader independent of the extractor (pypdf);
 * the K. pneumoniae rows were cross-checked only between the report's own two tables.
 *
 *   node test.mjs           # all of them
 *   node test.mjs yerel     # cases whose name contains 'yerel' (local)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];
const line = (t, rx) => t.split("\n").find((l) => rx.test(l)) || "";

const CASES = [
  ["status", "amr_tr_status", {}, (t) => /36 ilden 60 laboratuvar/.test(t) && /27671 izolat analiz/.test(t) && /%49,6/.test(t) && /E\. faecium: n=2832, %61/.test(t)],
  ["ecoli-en", "amr_tr_resistance", { pathogen: "E. coli", antibiotic: "ciprofloxacin" }, (t) => /R %52 — test edilen 5431/.test(line(t, /^- Florokinolonlar/)) && /siprofloksasin/.test(t) && !/Amikasin/.test(t)],
  ["ecoli-3gc-who", "amr_tr_resistance", { pathogen: "Escherichia coli", antibiotic: "3. kuşak sefalosporin" }, (t) => /R %61 — test edilen 5916/.test(t) && /2020 %53 \(n=4340\).*2024 %61 \(n=5916\).*artış/.test(t) && /2023: %56,42 = yalnız seftriakson \(3113\/5518\) · GLASS sınıf düzeyi %58,88 \(3528\/5992\) · UAMDS raporu %59/.test(t) && /2021: %53,77 = yalnız sefotaksim \(371\/690\)/.test(t)],
  ["mrsa-who", "amr_tr_resistance", { pathogen: "S. aureus", antibiotic: "MRSA" }, (t) => /2023: %32,58 = yalnız sefoksitin \(402\/1234\) · GLASS sınıf düzeyi %31,01 \(1294\/4173\) · UAMDS raporu %31/.test(t) && /2021: %30,99 = yalnız oksasilin \(877\/2830\)/.test(t) && /birbirinin yerine kullanılmaz/.test(t)],
  ["ecoli-dusuk-kapsam", "amr_tr_resistance", { pathogen: "e coli", antibiotic: "kolistin" }, (t) => /Kolistin\*: R %2 — test edilen 1050 izolat ⚠/.test(t) && /sıvı mikrodilüsyon/.test(t)],
  ["kleb-sinif", "amr_tr_resistance", { pathogen: "klebsiella", antibiotic: "carbapenem" }, (t) => /R %59/.test(line(t, /^- Karbapenemler/)) && /R %64/.test(line(t, /^- Ertapenem/)) && /%48.*%49.*%52.*%55.*%59/.test(t)],
  ["pseudo-RI", "amr_tr_resistance", { pathogen: "Pseudomonas", antibiotic: "meropenem" }, (t) => /^- Meropenem: R %31 · I %11 — test edilen 2042/m.test(t)],
  ["pseudo-dogrulanmamis", "amr_tr_trend", { pathogen: "P. aeruginosa", antibiotic: "karbapenem" }, (t) => /2024 %42 \(n=2125\)/.test(t) && /çapraz doğrulanmadı/.test(t)],
  ["acineto", "amr_tr_resistance", { pathogen: "Acinetobacter baumannii" }, (t) => /R %90 — test edilen 2584/.test(line(t, /^- Karbapenemler/)) && /%76 yoğun bakım/.test(t) && /Tanım: Çoklu ilaç direnci/.test(t)],
  ["mrsa", "amr_tr_resistance", { pathogen: "MRSA", antibiotic: "methicillin" }, (t) => /^- MRSA\*: R %35 · I %0 — test edilen 4371/m.test(t) && /sefoksitin/.test(t)],
  ["pnomokok-IR", "amr_tr_resistance", { pathogen: "pnömokok", antibiotic: "penisilin" }, (t) => /I\+R %61 — test edilen 247/.test(t) && !/K\. pneumoniae/.test(t)],
  ["belirsiz-tur", "amr_tr_resistance", { pathogen: "pneumoniae", antibiotic: "florokinolon" }, (t) => /## K\. pneumoniae/.test(t) && /## S\. pneumoniae/.test(t) && /R %2 · I %97/.test(t)],
  ["enterokok", "amr_tr_resistance", { pathogen: "enterokok", antibiotic: "vankomisin" }, (t) => /R %1 — test edilen 2822/.test(t) && /R %15 — test edilen 2827/.test(t)],
  ["yalniz-antibiyotik", "amr_tr_resistance", { antibiotic: "amikasin", include_trend: false }, (t) => /## E\. coli/.test(t) && /## Acinetobacter/.test(t) && /R %84 — test edilen 2556/.test(t) && !/Eğilim/.test(t)],
  ["kaynak-ve-sinir", "amr_tr_resistance", { pathogen: "E. faecalis" }, (t) => /Tablo 9, s\. 15/.test(t) && /hsgm\.saglik\.gov\.tr/.test(t) && /İdrar, solunum/.test(t)],
  ["egilim-hepsi", "amr_tr_trend", {}, (t) => (t.match(/^- /gm) || []).length === 26],
  ["hata-bilinmeyen-bakteri", "amr_tr_resistance", { pathogen: "Candida auris" }, (t, r) => r.isError && /İzlenen bakteriler: E\. coli/.test(t)],
  ["hata-bilinmeyen-ilac", "amr_tr_resistance", { pathogen: "E. coli", antibiotic: "fosfomisin" }, (t, r) => r.isError && /Raporlanan antibiyotikler/.test(t)],
  ["hata-parametresiz", "amr_tr_resistance", {}, (t, r) => r.isError && /en az biri/.test(t)],
];

// Synthetic local antibiogram: it does NOT belong to a real institution; it only exercises the CSV code path.
const LOCAL_CSV = [
  "source;year;specimen;setting;pathogen;antibiotic;n;r_pct",
  "SENTETIK-TEST;2025;idrar;poliklinik;E. coli;Siprofloksasin;412;38,5",
  "SENTETIK-TEST;2025;idrar;poliklinik;E. coli;Fosfomisin;12;0",
  "SENTETIK-TEST;2025;idrar;poliklinik;E. coli;Nitrofurantoin;abc;3",
  "SENTETIK-TEST;2025;kan;YBÜ;K. pneumoniae;Meropenem;95;140",
].join("\n");
const LOCAL_CASES = [
  ["yerel-status", "amr_tr_status", {}, (t) => /2 satır yüklendi, 2 sorun/.test(t) && /satır 4: n geçersiz/.test(t) && /satır 5: r_pct geçersiz/.test(t)],
  ["yerel-eslesme", "amr_tr_resistance", { pathogen: "E. coli", antibiotic: "ciprofloxacin" }, (t) => /E\. coli \/ Siprofloksasin: R %38,5 — n=412 \[SENTETIK-TEST, 2025, idrar, poliklinik\]/.test(t) && /R %52 — test edilen 5431/.test(t)],
  ["yerel-kucuk-n", "amr_tr_resistance", { pathogen: "E. coli", antibiotic: "fosfomisin" }, (t, r) => !r.isError && /n=12.*⚠ n<30/.test(t)],
];

let fail = 0;
async function run(cases, env) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(HERE, "index.js")], env: { ...process.env, ...env } });
  const client = new Client({ name: "amr-tr-test", version: "0" });
  await client.connect(transport);
  const pid = transport.pid;
  const tools = (await client.listTools()).tools.map((t) => t.name).sort().join(",");
  if (tools !== "amr_tr_resistance,amr_tr_status,amr_tr_trend") { fail++; console.log(`✗ araç listesi: ${tools}`); }
  for (const [name, tool, args, check] of cases) {
    if (filter && !name.includes(filter)) continue;
    const r = await client.callTool({ name: tool, arguments: args });
    const t = r.content.map((c) => c.text).join("\n");
    const ok = Boolean(check(t, r));
    if (!ok) fail++;
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) console.log(t.split("\n").map((l) => `    ${l}`).join("\n"));
  }
  await client.close();
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0); } catch { return console.log(`✓ istemci kapanınca sunucu çıktı (pid ${pid})`); }
    await new Promise((res) => setTimeout(res, 100));
  }
  fail++;
  console.log(`✗ sunucu hâlâ ayakta (pid ${pid})`);
  try { process.kill(pid, "SIGKILL"); } catch {}
}

await run(CASES, { AMR_TR_LOCAL: "" });
const dir = mkdtempSync(join(tmpdir(), "amr-tr-"));
try {
  writeFileSync(join(dir, "sentetik.csv"), LOCAL_CSV);
  await run(LOCAL_CASES, { AMR_TR_LOCAL: join(dir, "sentetik.csv") });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} vaka başarısız` : "\nhepsi geçti");
process.exit(fail ? 1 : 0);
