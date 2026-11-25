// Renders the data as text. Every output carries n, the year, the source page and the scope limitation.
import { basename } from "node:path";
import { MIN_N } from "./data.js";
import { antibioticTerms, fold, groupMembers, matchesAntibiotic, resolvePathogens } from "./match.js";

const num = (v) => String(v).replace(".", ",");
const CHANGE = { "↑": "↑ anlamlı artış", "↓": "↓ anlamlı azalış", "-": "anlamlı eğilim yok" };

export const LIMITS =
  "Sınır: yalnız kan ve BOS izolatları, ulusal toplam. İdrar, solunum ve yara örneği ile toplum kökenli " +
  "enfeksiyon verisi yok; bölge ya da hastane kırılımı yok.";

const source = (d, refs) => {
  const s = d.sources.uamds;
  const where = [...new Set(refs.map((r) => `Tablo ${r.table}, s. ${r.page}`))].join("; ");
  return `Kaynak: ${s.title}, ${s.publisher}, ${s.published}${where ? ` — ${where}` : ""}\n${s.url}`;
};

function rowLine(r, groups) {
  const members = groupMembers(r.antibiotic, groups);
  const v = [
    r.r_pct != null && `R %${num(r.r_pct)}`,
    r.i_pct != null && `I %${num(r.i_pct)}`,
    r.ir_pct != null && `I+R %${num(r.ir_pct)}`,
  ].filter(Boolean);
  return (
    `- ${r.antibiotic}${r.footnoted ? "*" : ""}${members.length ? ` (${members.join(", ")})` : ""}: ` +
    `${v.join(" · ")} — test edilen ${r.n} izolat` +
    (r.low_coverage ? " ⚠ izolatların %70'inden azı test edildi" : "")
  );
}

function trendLine(t, withPathogen) {
  const s = t.series.map((p) => `${p.year} %${num(p.r_pct)} (n=${p.n})`).join(" → ");
  return (
    `- ${withPathogen ? `${t.pathogen} / ` : ""}${t.antibiotic}: ${s} | ${CHANGE[t.change] ?? "eğilim bilgisi yok"}` +
    (t.verified ? "" : " [son yıl değerinin tek tek tablolarda karşılığı yok; çapraz doğrulanmadı]")
  );
}

// The WHO value and the report value come from the same national data; the difference is in the calculation rule.
const WHO_NOTE =
  "Not: WHO göstergesi sınıfın tek bir antibiyotiğine dayanıyor (GLASS ham sayılarıyla eşleşen üye yukarıda; " +
  "her yıl direnç yüzdesi en yüksek olan üye). UAMDS raporu ise sınıf düzeyi değeri verir. İki sayı birbirinin yerine kullanılmaz.";

function whoLine(w, uamds) {
  const m = w.basis && w.members.find((x) => x.antibiotic === w.basis);
  return [
    `- ${w.year}: %${num(w.r_pct)}${m ? ` = yalnız ${m.antibiotic} (${m.r}/${m.n})` : ""}`,
    w.class_level && `GLASS sınıf düzeyi %${num(w.class_level.r_pct)} (${w.class_level.r}/${w.class_level.n})` +
      (w.class_same_as ? ` [${w.class_same_as} satırıyla aynı sayılar, birleşik değer değil]` : ""),
    uamds != null && `UAMDS raporu %${num(uamds)}`,
  ].filter(Boolean).join(" · ");
}

function select(d, a) {
  const names = Object.keys(d.pathogens);
  if (!a.pathogen && !a.antibiotic) throw new Error("pathogen ya da antibiotic parametrelerinden en az biri gerekli.");
  const pathogens = a.pathogen ? resolvePathogens(a.pathogen, names) : names;
  if (!pathogens.length) throw new Error(`'${a.pathogen}' bu veri setinde yok. İzlenen bakteriler: ${names.join(", ")}.`);
  const terms = a.antibiotic ? antibioticTerms(a.antibiotic) : null;
  const keep = (p, abx) => !terms || matchesAntibiotic(terms, abx, d.pathogens[p]?.groups);
  return { pathogens, terms, keep };
}

export function status(d, local) {
  const s = d.scope, u = d.sources.uamds;
  const out = [
    `${u.title} — ${u.published} (${d.rows[0].year} verileri)`,
    `${u.url}`,
    `PDF sha256: ${u.sha256} | ayrıştırıcı: ${u.parser} | çıkarım tarihi: ${d.generated}`,
    "",
    `Kapsam: ${s.provinces} ilden ${s.labs} laboratuvar; ${s.isolates_submitted} izolat gönderildi, ` +
      `${s.isolates_analyzed} izolat analiz edildi (${s.dedup}). Örnek: ${s.specimens.join(" ve ")}. ` +
      `Standart: ${s.standard}. Tüm izolatların %${num(s.icu_share_pct)}'i yoğun bakımdan.`,
    LIMITS,
    "",
    "Bakteriler:",
    ...Object.entries(d.pathogens).map(([p, v]) => {
      const abx = d.rows.filter((r) => r.pathogen === p).map((r) => r.antibiotic);
      return `- ${p}: n=${v.n}, %${v.icu_pct} yoğun bakım (Tablo ${v.table}, s. ${v.page}) — ${abx.join(", ")}`;
    }),
    "",
    `Eğilim tablosu: ${d.trend.length} bakteri-antibiyotik çifti, ${d.trend[0].series[0].year}–${d.trend[0].series.at(-1).year}; ` +
      `${d.trend.filter((t) => t.verified).length} tanesinin son yıl değeri tek tek tablolarla eşleşti.`,
    `WHO GHO anlık görüntüsü: ${d.who.length} satır (${d.sources.who.retrieved})` +
      (d.sources.who.error ? ` — alınamadı: ${d.sources.who.error}` : ""),
    "",
    local.path
      ? `Yerel antibiyogram (AMR_TR_LOCAL): ${basename(local.path)} — ${local.rows.length} satır yüklendi` +
        (local.errors.length ? `, ${local.errors.length} sorun:\n${local.errors.map((e) => `  · ${e}`).join("\n")}` : "")
      : "Yerel antibiyogram: tanımlı değil (AMR_TR_LOCAL ile CSV verilebilir).",
  ];
  return out.join("\n");
}

export function resistance(d, local, a) {
  const { pathogens, keep } = select(d, a);
  const out = [], refs = [];
  for (const p of pathogens) {
    const info = d.pathogens[p];
    const rows = d.rows.filter((r) => r.pathogen === p && keep(p, r.antibiotic));
    const trends = a.include_trend === false ? [] : d.trend.filter((t) => t.pathogen === p && keep(p, t.antibiotic));
    const who = d.who.filter((w) => w.pathogen === p && keep(p, w.antibiotic));
    if (!rows.length && !trends.length) continue;
    refs.push(...rows, ...trends);
    out.push(`## ${p} — UAMDS ${info.year} (kan + BOS, ulusal; n=${info.n}, %${info.icu_pct} yoğun bakım)`);
    out.push(...rows.map((r) => rowLine(r, info.groups)));
    if (rows.some((r) => r.footnoted) && info.footnote) out.push(`* ${info.footnote}`);
    if (rows.some((r) => /çoklu ilaç/i.test(r.antibiotic)) && info.mdr_definition) out.push(`Tanım: ${info.mdr_definition}`);
    if (trends.length) out.push("Eğilim (R %):", ...trends.map((t) => trendLine(t, false)));
    if (who.length) {
      const same = (w) => d.trend.find((t) => t.pathogen === p && fold(t.antibiotic) === fold(w.antibiotic))
        ?.series.find((x) => x.year === w.year)?.r_pct;
      out.push("WHO GHO, SDG 3.d.2 (yalnız kan dolaşımı enfeksiyonu):", ...who.map((w) => whoLine(w, same(w))));
      if (who.some((w) => w.basis)) out.push(WHO_NOTE);
    }
    out.push("");
  }
  const mine = local.rows.filter(
    (r) => (!a.pathogen || resolvePathogens(r.pathogen, pathogens).length || pathogens.some((p) => resolvePathogens(p, [r.pathogen]).length))
      && keep(null, r.antibiotic),
  );
  if (mine.length) {
    out.push(`## Yerel antibiyogram (${basename(local.path)})`);
    out.push(...mine.map((r) => {
      const tag = [r.source, r.year, r.specimen, r.setting].filter(Boolean).join(", ");
      return `- ${r.pathogen} / ${r.antibiotic}: R %${num(r.r_pct)} — n=${r.n}${tag ? ` [${tag}]` : ""}` +
        (r.n < MIN_N ? ` ⚠ n<${MIN_N}: yüzde güvenilir değil` : "");
    }), "");
  }
  if (!out.length) {
    const avail = pathogens.map((p) => `${p}: ${d.rows.filter((r) => r.pathogen === p).map((r) => r.antibiotic).join(", ")}`);
    throw new Error(`'${a.antibiotic}' için kayıt yok. Raporlanan antibiyotikler —\n${avail.join("\n")}`);
  }
  if (refs.length) out.push(source(d, refs), LIMITS);
  return out.join("\n");
}

export function trend(d, a) {
  const all = !a.pathogen && !a.antibiotic;
  const { pathogens, keep } = all ? { pathogens: Object.keys(d.pathogens), keep: () => true } : select(d, a);
  const rows = d.trend.filter((t) => pathogens.includes(t.pathogen) && keep(t.pathogen, t.antibiotic));
  if (!rows.length) {
    const avail = d.trend.filter((t) => pathogens.includes(t.pathogen)).map((t) => `${t.pathogen} / ${t.antibiotic}`);
    throw new Error(`Eğilim tablosunda eşleşen satır yok. Bu bakteri(ler) için olanlar: ${avail.join("; ") || "yok"}.`);
  }
  return [
    `Direnç yüzdesi (R %), ${rows[0].series[0].year}–${rows[0].series.at(-1).year}; kan + BOS izolatları, ulusal`,
    ...rows.map((t) => trendLine(t, true)),
    "",
    "Eğilim işareti rapordaki istatistiksel anlamlılık değerlendirmesidir; bu sunucu yeniden hesaplamaz.",
    source(d, rows),
    LIMITS,
  ].join("\n");
}
