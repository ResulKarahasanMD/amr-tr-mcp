#!/usr/bin/env node
// MCP server for Türkiye's antimicrobial resistance surveillance data (UAMDS / HSGM).
// Offline and read-only: the numbers come from data/uamds.json, which extract/uamds_extract.py generates.
// If AMR_TR_LOCAL points to a CSV, the institution's own antibiogram is loaded as well.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadData, loadLocal } from "./lib/data.js";
import { resistance, status, trend } from "./lib/render.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = loadData(process.env.AMR_TR_DATA || join(HERE, "data", "uamds.json"));
const LOCAL = loadLocal(process.env.AMR_TR_LOCAL);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const text = (s) => ({ content: [{ type: "text", text: s }] });

// An error should come back as a tool error that guides the model, not as a protocol error.
const safe = (fn) => async (args) => {
  try { return text(await fn(args)); }
  catch (e) { return { isError: true, content: [{ type: "text", text: `Hata: ${e.message}` }] }; }
};

const server = new McpServer(
  { name: "amr-tr", version: "0.1.0" },
  {
    instructions:
      "amr-tr: Türkiye ulusal antimikrobiyal direnç sürveyans verisi (UAMDS/HSGM raporu + WHO GHO), çevrimdışı ve salt-okur. " +
      "KAPSAM SINIRI: veriler yalnız kan ve BOS izolatlarından, ulusal toplamdır ve yaklaşık yarısı yoğun bakım hastalarındandır. " +
      "İdrar, solunum, yara örnekleri ve toplum kökenli enfeksiyonlar için veri yoktur; bu sayıları o durumlara genellemeyin. " +
      "Bölge ya da hastane kırılımı yoktur; kurumun kendi antibiyogramı yüklüyse (AMR_TR_LOCAL) yerel karar için o önceliklidir. " +
      "Sayıları araç çıktısından aktarın, hatırlamayın; n, yıl ve kaynak sayfasını birlikte verin. Sunucu tedavi önermez.",
  },
);

const PATHOGEN = z.string().min(2).optional()
  .describe("Bakteri: 'E. coli', 'Klebsiella', 'MRSA', 'pnömokok'… Türkçe ya da İngilizce. İzlenenler amr_tr_status'ta.");
const ANTIBIOTIC = z.string().min(2).optional()
  .describe("Antibiyotik ya da sınıf: 'siprofloksasin', 'carbapenem', '3. kuşak sefalosporin', 'GSBL', 'MDR'…");

server.registerTool(
  "amr_tr_status",
  {
    title: "AMR-TR veri durumu",
    description:
      "Yüklü verinin kaynağını, yılını, kapsamını (kaç laboratuvar, kaç izolat, hangi örnekler), izlenen bakterileri ve " +
      "her biri için raporlanan antibiyotikleri listeler. Yerel antibiyogram CSV'sinin yüklenip yüklenmediğini de gösterir. " +
      "Veri güncelliğinden ya da bir bakterinin kapsanıp kapsanmadığından emin değilseniz önce bunu çağırın.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  safe(async () => status(DATA, LOCAL)),
);

server.registerTool(
  "amr_tr_resistance",
  {
    title: "Türkiye direnç oranı",
    description:
      "Bir bakteri ve/veya antibiyotik için Türkiye ulusal direnç yüzdesini (R %, varsa I %), test edilen izolat sayısını, " +
      "5 yıllık eğilimi ve kaynak sayfasını döner. Yalnız invaziv izolatları (kan, BOS) kapsar. Antibiyotik sınıfı sorulursa " +
      "(ör. 'karbapenem') sınıfın tek tek raporlanan üyeleri de gelir. En az bir parametre gerekli.",
    inputSchema: {
      pathogen: PATHOGEN,
      antibiotic: ANTIBIOTIC,
      include_trend: z.boolean().default(true).describe("5 yıllık eğilim satırlarını da ekle"),
    },
    annotations: READ_ONLY,
  },
  safe(async (a) => resistance(DATA, LOCAL, a)),
);

server.registerTool(
  "amr_tr_trend",
  {
    title: "Türkiye direnç eğilimi",
    description:
      "Rapordaki 5 yıllık özet tablosundan yıllara göre direnç yüzdesi ve izolat sayısını, raporun istatistiksel eğilim " +
      "değerlendirmesiyle (artış / azalış / anlamlı değil) döner. Parametre verilmezse tüm bakteri-antibiyotik çiftleri gelir.",
    inputSchema: { pathogen: PATHOGEN, antibiotic: ANTIBIOTIC },
    annotations: READ_ONLY,
  },
  safe(async (a) => trend(DATA, a)),
);

const transport = new StdioServerTransport();
await server.connect(transport);

// A stdio server depends on its client; when the client goes away, the process should exit too.
const bye = (code) => process.exit(code);
process.stdin.on("end", () => bye(0));
process.stdin.on("close", () => bye(0));
process.stdin.on("error", () => bye(0));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => bye(0));
