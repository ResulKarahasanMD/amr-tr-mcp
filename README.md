# amr-tr-mcp

> **English summary.** An offline, read-only MCP server for Türkiye's national antimicrobial resistance surveillance data: the UAMDS network annual report (HSGM, 2024 data) plus WHO GHO SDG 3.d.2. Blood and CSF isolates only, national totals.
> The rest of this README is in Turkish.

Türkiye ulusal antimikrobiyal direnç sürveyans verisi için çevrimdışı, salt-okur MCP sunucusu.

## Veri

| Kaynak | İçerik | Nasıl alınıyor |
|---|---|---|
| UAMDS Ağı Yıllık Raporu (2024 verileri), HSGM, Ocak 2026 | 8 bakteri, 55 bakteri-antibiyotik satırı (2024) + 26 çift için 2020–2024 eğilimi | `extract/uamds_extract.py` PDF'i bellekte ayrıştırır |
| WHO GHO (SDG 3.d.2) | E. coli 3. kuşak sefalosporin ve MRSA, Türkiye 2021–2023 | aynı betik, OData API |
| Yerel antibiyogram (isteğe bağlı) | Kurumun kendi verisi | `AMR_TR_LOCAL=/yol/antibiyogram.csv` |

Hiçbir sayı elle girilmedi. Çıkarıcı, 5 yıllık özet tablosunun son yıl sütununu tek tek bakteri
tablolarıyla eşleştirir; uyuşmazlıkta dosya yazmaz. 26 eğilim satırının 25'i bu şekilde doğrulandı.
Doğrulanamayan tek satır P. aeruginosa / Karbapenemler: 2024 tablosunda grup satırı yok, yalnız
imipenem ve meropenem ayrı ayrı var.

## Sınırlar

- Yalnız **kan ve BOS** izolatları. İdrar, solunum, yara örneği yok.
- **Ulusal toplam**: bölge, il ya da hastane kırılımı yok. İzolatların %49,6'sı yoğun bakımdan.
- Toplum kökenli enfeksiyonlar için ampirik seçimde bu oranlar direnci olduğundan yüksek gösterir.
- "Yerel" direnç için kurumun kendi antibiyogramı gerekir; kamuya açık bir kaynağı yok.
- WHO GHO ile UAMDS raporu aynı yıl için farklı değer veriyor (2023 E. coli: %56,42 ve %59).
  Neden hesap kuralı, veri aynı: WHO değeri sınıfın tek bir antibiyotiğinin yüzdesi (2023'te
  seftriakson, 3113/5518), UAMDS değeri sınıf düzeyi (GLASS'ta 3528/5992 = %58,88). Türkiye için
  6 yıl-gösterge çiftinin 6'sında WHO değeri, direnç yüzdesi en yüksek üyeninkiyle iki ondalığa
  kadar eşleşti (GLASS ham sayıları: `xmart-api-public.who.int/DATA_/RELAY_GLASS_AMR_CTA`).
  WHO'nun bu kuralı yazdığı bir belge bulunamadı; kural sayılardan çıkarıldı.
- GLASS'ın 2022 sınıf satırları tek bir üyeyle aynı sayıları taşıyor (E. coli: seftazidim, MRSA:
  oksasilin); birleşik değer değil. Nedeni bilinmiyor. Aynı tabloda 2024 satırları 2023'ün kopyası.

## Araçlar

- `amr_tr_status` — kaynak, kapsam, izlenen bakteriler, yerel CSV durumu
- `amr_tr_resistance` — bakteri ve/veya antibiyotik için R %, I %, n, eğilim, kaynak sayfası
- `amr_tr_trend` — 2020–2024 serisi ve raporun eğilim değerlendirmesi

## Çalıştırma

```bash
npm install
npm test
```

Veriyi yenilemek (yeni yıl raporu çıkınca `--url` ile):

```bash
npm run extract
```

Rapor düzeni değişirse çıkarıcı sorunları listeler ve çıkış kodu 1 verir; `data/uamds.json` eski
haliyle kalır.

## Yerel antibiyogram CSV'si

Başlık: `pathogen, antibiotic, n, r_pct` zorunlu; `source, year, specimen, setting` isteğe bağlı.
Ayırıcı virgül ya da noktalı virgül, ondalık virgül kabul edilir. Geçersiz satırlar atlanır ve
`amr_tr_status` çıktısında satır numarasıyla listelenir. n < 30 olan satırlar uyarıyla gösterilir.

## Lisans ve veri

Kod [MIT](LICENSE) lisanslıdır. `data/uamds.json`, yukarıdaki tabloda adı geçen kamuya açık kaynaklardan (HSGM UAMDS Ağı Yıllık Raporu ve WHO GHO) `extract/uamds_extract.py` ile türetilmiştir; verinin sahibi ve sorumlusu kaynak kurumlardır.
