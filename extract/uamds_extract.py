#!/usr/bin/env python3
"""UAMDS yıllık raporundan (HSGM) direnç tablolarını çıkarır ve data/uamds.json yazar.

    uv run --with pypdf python extract/uamds_extract.py              # rapor URL'den, bellekte
    uv run --with pypdf python extract/uamds_extract.py --pdf x.pdf   # yerel kopyadan

PDF diske yazılmaz; sha256'sı çıktıya kaydedilir. Hiçbir sayı elle girilmez:
- Sütun düzeni her tablonun kendi başlık satırından okunur (Sayı / R / I / IR).
- 5 yıllık özet tablosundaki satırların bakterisi, son yıl sütunu tek tek tablolarla
  eşleştirilerek bulunur; bu aynı zamanda iki tablonun birbirini doğrulamasıdır.
Uyuşmazlık ya da çözülemeyen satır varsa dosya yazılmaz, çıkış kodu 1.
"""
import argparse
import datetime
import hashlib
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

import pypdf

REPORT_URL = (
    "https://hsgm.saglik.gov.tr/depo/birimler/mikrobiyoloji-referans-laboratuvarlari-ve-"
    "biyolojik-urunler-db/Dokumanlar/Raporlar/UAMDS_Raporu_2024_verileri.pdf"
)
GHO_URL = "https://ghoapi.azureedge.net/api/{code}?$filter=SpatialDim%20eq%20%27TUR%27"
GHO_CODES = {
    "AMR_INFECT_ECOLI": ("E. coli", "3. kuşak sefalosporinler"),
    "AMR_INFECT_MRSA": ("S. aureus", "MRSA"),
}
# WHO veri portalının (data.who.int/dashboards/amr) arkasındaki açık OData ucu; Türkiye M49 kodu 792.
# Aynı tabloda 2024 satırları 2023'ün birebir kopyası (2026-09-27); yalnız GHO'da karşılığı olan yıllar kullanılır.
GLASS_URL = (
    "https://xmart-api-public.who.int/DATA_/RELAY_GLASS_AMR_CTA?$filter="
    "DIM_GEO_CODE_M49%20eq%20%27792%27"
    "%20and%20(IND_GRP_CODE%20eq%20%27AMR_CTA_RESISTANT_IND%27%20or%20IND_GRP_CODE%20eq%20%27AMR_CTA_SDG_IND%27)"
    "%20and%20(IND_CODE%20eq%20%27RESISTANT%27%20or%20IND_CODE%20eq%20%27INTERPRETABLEAST%27)"
)
GLASS = {
    "AMR_INFECT_ECOLI": ("Escherichia coli", "Third-generation cephalosporins",
                         {"Cefotaxime": "sefotaksim", "Ceftriaxone": "seftriakson", "Ceftazidime": "seftazidim"}),
    "AMR_INFECT_MRSA": ("Staphylococcus aureus", "Methicillin", {"Oxacillin": "oksasilin", "Cefoxitin": "sefoksitin"}),
}
# hsgm.saglik.gov.tr, User-Agent'ında "extract" geçen isteklere 403 dönüyor (2026-09-27'de denendi).
UA = {"User-Agent": "amr-tr-mcp/0.1 (+UAMDS rapor okuyucu)"}

FOLD = str.maketrans("İIıŞşĞğÜüÖöÇç", "iiissgguuoocc")
VAL = r"(?:\d+(?:[.,]\d+)?\*{0,2}|-)"
COLS = {"Sayı": "n", "R (%)": "r_pct", "I (%)": "i_pct", "IR (%)": "ir_pct"}
CAPTION = re.compile(r"Tablo\s+(\d+)\.\s*UAMDS\s+(\d{4})\s+yılı\s+(.+?)\s+izolatlarında\s+antibiyotik")
TREND_CAPTION = re.compile(r"Tablo\s+(\d+)\.\s*UAMDS\s+(\d{4})-(\d{4})\s+yılı\s+izolatlarının\s+bakteri\s+türüne")
RUN = re.compile(r"(?<![\w.,])\d+(?:\s+\d+){9}(?![\w.,%])")
ARROWS = {"↑": "artış", "↓": "azalış", "-": "anlamlı eğilim yok"}


def fold(s):
    return re.sub(r"[^a-z0-9]", "", s.translate(FOLD).lower())


def num(v):
    return int(v) if v == int(v) else v


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def cell(tok):
    if tok == "-":
        return None, False
    low = tok.endswith("**")
    return num(float(tok.rstrip("*").replace(",", "."))), low


def parse_tables(pages):
    """Bakteri başına tablolar: [{table, page, year, pathogen, cols, rows, notes}]"""
    tables, cur = [], None
    for pno, txt in enumerate(pages, 1):
        for line in (ln.strip() for ln in txt.splitlines()):
            if TREND_CAPTION.search(line) or re.match(r"^\d+\.\d+\.\s", line):
                cur = None
                continue
            m = CAPTION.search(line)
            if m:
                cur = dict(table=int(m[1]), page=pno, year=int(m[2]), pathogen=m[3].strip(), cols=None, rows=[], notes=[])
                tables.append(cur)
                continue
            if not cur or not line or line.isdigit():  # yalnız rakam = sayfa numarası
                continue
            if cur["cols"] is None:
                if "Antibiyotik" in line and "Sayı" in line:
                    cur["cols"] = [COLS[c] for c in re.findall(r"Sayı|IR \(%\)|R \(%\)|I \(%\)", line)]
                continue
            k = len(cur["cols"])
            m = re.match(rf"^(?P<name>.*?[^\W\d_].*?)\s+(?P<vals>{VAL}(?:\s+{VAL}){{{k - 1}}})$", line)
            if not m:
                cur["notes"].append(line)
                continue
            row = dict(antibiotic=m["name"].replace("*", "").strip(), footnoted="*" in m["name"], low_coverage=False)
            for key, tok in zip(cur["cols"], m["vals"].split()):
                row[key], low = cell(tok)
                row["low_coverage"] |= low
            if not isinstance(row["n"], int):
                raise SystemExit(f"HATA: Tablo {cur['table']} '{line}': Sayı tam sayı değil")
            cur["rows"].append(row)
    return tables


def parse_notes(notes):
    blob = re.sub(r"\s+", " ", " ".join(notes))
    groups = {}
    for name, members in re.findall(r"([A-ZÇĞİÖŞÜ][^.*]*?) grubu ([^.]*?)(?:den|dan|ten|tan) oluş(?:ur|maktadır)", blob):
        groups[name.strip()] = [x.strip() for x in re.split(r",| ve ", members) if x.strip()]
    # "3. kuşak" içindeki nokta cümle sonu değil
    mdr = re.search(r"Çoklu ilaç direnci[;,]\s*(?:[^.]|(?<=\d)\.)*?(?:olmasıdır|tanımlanmıştır)\.", blob)
    note = re.search(r"(?<!\*)\*(?!\*)\s*(.+?)(?=\s*\*\*|$)", blob)  # tek yıldızlı dipnot
    return groups, mdr[0] if mdr else None, note[1].strip() if note else None


def parse_trend(pages, tables):
    full = "\n".join(pages)
    m = TREND_CAPTION.search(full)
    if not m:
        raise SystemExit("HATA: 5 yıllık özet tablosu bulunamadı")
    page = next(i for i, t in enumerate(pages, 1) if TREND_CAPTION.search(t))
    end = re.search(r"[“\"]↑ ve ↓[”\"]", full[m.end():])
    block = full[m.end(): m.end() + end.start()] if end else full[m.end():]
    cut = block.rfind("R (%)")
    header, body = block[:cut], block[cut + len("R (%)"):]
    years = [int(y) for y in re.findall(r"\b(20\d{2})\b", header)][:5]
    if years != list(range(int(m[2]), int(m[3]) + 1)) or header.count("Sayı") != len(years):
        raise SystemExit(f"HATA: özet tablo başlığı beklenen düzende değil (yıllar={years}, Sayı={header.count('Sayı')})")

    last = years[-1]
    by_key = {}
    for t in tables:
        if t["year"] != last:
            continue
        for r in t["rows"]:
            val = r.get("r_pct") if r.get("r_pct") is not None else r.get("ir_pct")
            by_key.setdefault((fold(r["antibiotic"]), r["n"], val), []).append((t["pathogen"], r["antibiotic"]))
    names = {t["pathogen"] for t in tables}
    prefix = {p: re.compile(r"\s*".join(re.escape(c) for c in p.replace(" ", "")) + r"\s*") for p in names}

    runs = list(RUN.finditer(body))
    out, problems = [], []
    for i, run in enumerate(runs):
        label = body[runs[i - 1].end() if i else 0: run.start()].split()
        after = body[run.end(): runs[i + 1].start() if i + 1 < len(runs) else len(body)].split()
        if i and label and label[0] in ARROWS:
            label = label[1:]
        arrow = after[0] if after and after[0] in ARROWS else None
        text = ""
        for tok in label:
            text += tok if text.endswith("-") and len(text) > 1 else (" " if text else "") + tok
        explicit = next((p for p, rx in prefix.items() if rx.match(text)), None)
        abx = (text[prefix[explicit].match(text).end():] if explicit else text).replace("*", "").strip()
        v = [int(x) for x in run[0].split()]
        hits = by_key.get((fold(abx), v[8], v[9]), [])
        if explicit:
            hits = [h for h in hits if h[0] == explicit] or hits
        pathogen = hits[0][0] if len(hits) == 1 else explicit
        where = f"özet tablo satırı '{text}' ({last}: n={v[8]}, R={v[9]})"
        if len(hits) > 1:
            problems.append(f"{where}: birden çok tabloyla eşleşiyor {hits}")
        elif hits and explicit and hits[0][0] != explicit:
            problems.append(f"{where}: etiket {explicit}, eşleşen tablo {hits[0][0]}")
        elif not pathogen:
            problems.append(f"{where}: bakteri belirlenemedi")
        elif not hits:
            same = [r for t in tables if t["pathogen"] == pathogen and t["year"] == last
                    for r in t["rows"] if fold(r["antibiotic"]) == fold(abx)]
            if same:
                problems.append(f"{where}: {pathogen} tablosunda n={same[0]['n']}, R={same[0].get('r_pct')}")
        if arrow is None:
            problems.append(f"{where}: eğilim işareti okunamadı")
        out.append(dict(
            pathogen=pathogen, antibiotic=hits[0][1] if len(hits) == 1 else abx, table=int(m[1]), page=page,
            series=[dict(year=y, n=v[2 * j], r_pct=v[2 * j + 1]) for j, y in enumerate(years)],
            change=arrow, change_text=ARROWS.get(arrow), verified=len(hits) == 1,
        ))
    return out, problems


def parse_scope(pages):
    lines = (ln.strip() for p in pages for ln in p.splitlines())
    flat = re.sub(r"\s+", " ", " ".join(ln for ln in lines if not ln.isdigit()))

    def grab(rx, cast=int):
        m = re.search(rx, flat)
        return cast(m[1].replace(",", ".")) if m else None

    per = {}
    for n, name, icu in re.findall(
        r"toplam (\d+) ([A-Z][^0-9]{2,30}?) izolatı analizlere dahil edilmiştir\. Bu [^%]{0,40}?izolatlarının ?% ?(\d+)[’'](?:\w+) yoğun bakım", flat
    ):
        per[fold(name)] = dict(n=int(n), icu_pct=int(icu))  # pypdf "E. fae cium" gibi boşluk ekleyebiliyor
    scope = dict(
        specimens=["kan", "BOS"], level="ulusal (sentinel)", standard="EUCAST",
        dedup="hasta başına ilk izolat",
        provinces=grab(r"toplam (\d+) ilden \d+ laboratuvar"),
        labs=grab(r"toplam \d+ ilden (\d+) laboratuvar"),
        isolates_submitted=grab(r"toplam (\d+) \(kan ve BOS"),
        isolates_analyzed=grab(r"analizlerine toplam (\d+) izolat"),
        icu_share_pct=grab(r"izolatların %([\d,]+)[’']\w+ yoğun bakım", float),
    )
    published = re.search(r"\((\d{4}) Verileri\)\s*(\w+ \d{4})", flat)
    return scope, per, published[2] if published else None


def fetch_glass_counts():
    """GLASS'a bildirilen ham sayılar (kan, tüm hastalar): {(yıl, bakteri, antibiyotik): {"r", "n"}}"""
    counts, url = {}, GLASS_URL
    while url:
        j = json.loads(fetch(url))
        for r in j["value"]:
            d = {r[f"DIM_{i}_CODE"]: r[f"DIM_MEMBER_{i}_CODE"] for i in range(1, 10) if r.get(f"DIM_{i}_CODE")}
            if d.get("DIM_DEMOGRAPHIC") != "Total" or d.get("DIM_SPECIMEN_TYPE") != "BLOOD" or r["VALUE_NUMERIC"] is None:
                continue
            key = (int(r["DIM_TIME"]), d["DIM_PATHOGENNAME"], d["DIM_ABTARGET"])
            counts.setdefault(key, {})["r" if r["IND_CODE"] == "RESISTANT" else "n"] = int(r["VALUE_NUMERIC"])
        url = j.get("@odata.nextLink")
    return counts


def fetch_who():
    rows = []
    for code, (pathogen, abx) in GHO_CODES.items():
        for r in json.loads(fetch(GHO_URL.format(code=code)))["value"]:
            if r["SpatialDim"] == "TUR" and r.get("NumericValue") is not None:
                rows.append(dict(indicator=code, pathogen=pathogen, antibiotic=abx, year=r["TimeDim"], r_pct=round(r["NumericValue"], 2)))
    # GHO değeri hangi sayılardan geliyor? Ham GLASS sayılarıyla eşleştir; eşleşmezse basis boş kalır.
    counts = fetch_glass_counts()
    for w in rows:
        name, cls, members = GLASS[w["indicator"]]

        def entry(key, label):
            c = counts.get((w["year"], name, key)) or {}
            return dict(antibiotic=label, r=c["r"], n=c["n"], r_pct=round(100 * c["r"] / c["n"], 2)) if c.get("n") and "r" in c else None

        w["members"] = [e for e in (entry(k, tr) for k, tr in members.items()) if e]
        w["basis"] = next((e["antibiotic"] for e in w["members"] if e["r_pct"] == w["r_pct"]), None)
        w["basis_is_highest"] = bool(w["basis"]) and w["r_pct"] == max(e["r_pct"] for e in w["members"])
        w["class_level"] = c = entry(cls, cls)
        # Sınıf satırı bir üyeyle aynı sayıları taşıyorsa birleşik ("en az birine dirençli") değer değildir.
        w["class_same_as"] = next((e["antibiotic"] for e in w["members"] if c and (e["r"], e["n"]) == (c["r"], c["n"])), None)
    return sorted(rows, key=lambda r: (r["indicator"], r["year"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", help="URL yerine yerel PDF")
    ap.add_argument("--url", default=REPORT_URL)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "uamds.json"))
    ap.add_argument("--no-who", action="store_true", help="WHO GHO anlık görüntüsünü alma")
    a = ap.parse_args()

    raw = Path(a.pdf).read_bytes() if a.pdf else fetch(a.url)
    pages = [p.extract_text() or "" for p in pypdf.PdfReader(io.BytesIO(raw)).pages]
    tables = parse_tables(pages)
    problems = [f"Tablo {t['table']} ({t['pathogen']}): satır okunamadı" for t in tables if not t["rows"]]
    trend, tp = parse_trend(pages, tables)
    problems += tp
    scope, per, published = parse_scope(pages)

    pathogens, rows = {}, []
    for t in tables:
        groups, mdr, note = parse_notes(t["notes"])
        pathogens[t["pathogen"]] = dict(table=t["table"], page=t["page"], year=t["year"], groups=groups,
                                        mdr_definition=mdr, footnote=note, **per.get(fold(t["pathogen"]), {}))
        if fold(t["pathogen"]) not in per:
            problems.append(f"{t['pathogen']}: izolat sayısı ve YBÜ oranı metinden okunamadı")
        rows += [dict(pathogen=t["pathogen"], year=t["year"], table=t["table"], page=t["page"], **r) for r in t["rows"]]

    who, who_error = [], None
    if not a.no_who:
        try:
            who = fetch_who()
        except Exception as e:  # ağ yoksa rapor verisi yine de yazılır
            who_error = str(e)

    print(f"pdf: {len(raw)} bayt, {len(pages)} sayfa, sha256 {hashlib.sha256(raw).hexdigest()[:16]}…")
    for t in tables:
        print(f"  Tablo {t['table']} s.{t['page']} {t['pathogen']}: sütun={t['cols']} satır={len(t['rows'])}")
    ok = sum(r["verified"] for r in trend)
    print(f"  özet tablo: {len(trend)} satır, {ok} tanesi tek tek tablolarla doğrulandı")
    for r in trend:
        if not r["verified"]:
            print(f"    doğrulanamayan: {r['pathogen']} / {r['antibiotic']}")
    print(f"  WHO GHO: {len(who)} satır" + (f" (HATA: {who_error})" if who_error else ""))
    for w in who:
        c = w["class_level"]
        print(f"    {w['pathogen']} {w['year']}: %{w['r_pct']} = {w['basis'] or 'EŞLEŞME YOK'}"
              f"{' (en yüksek üye)' if w['basis_is_highest'] else ''}; sınıf düzeyi "
              + (f"%{c['r_pct']} ({c['r']}/{c['n']})" if c else "yok")
              + (f" [= {w['class_same_as']} satırı]" if w["class_same_as"] else ""))
    if problems:
        print("\n".join(["SORUNLAR:"] + [f"  - {p}" for p in problems]), file=sys.stderr)
        sys.exit(1)

    doc = dict(
        schema=1, generated=datetime.date.today().isoformat(),
        sources=dict(
            uamds=dict(title="Ulusal Antimikrobiyal Direnç Sürveyans (UAMDS) Ağı Yıllık Raporu", publisher="T.C. Sağlık Bakanlığı HSGM",
                       published=published, url=a.url, local_pdf=bool(a.pdf), sha256=hashlib.sha256(raw).hexdigest(),
                       bytes=len(raw), pages=len(pages), parser=f"pypdf {pypdf.__version__}"),
            who=dict(title="WHO Global Health Observatory (SDG 3.d.2)", url="https://ghoapi.azureedge.net/api/",
                     retrieved=datetime.date.today().isoformat(), error=who_error),
        ),
        scope=scope, pathogens=pathogens, rows=rows, trend=trend, who=who,
    )
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"yazıldı: {out} ({len(rows)} satır + {len(trend)} eğilim)")


if __name__ == "__main__":
    main()
