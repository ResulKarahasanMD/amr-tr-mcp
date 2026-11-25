# amr-tr-mcp

An offline, read-only MCP server for Türkiye's national antimicrobial resistance surveillance data: the UAMDS network annual report (HSGM, 2024 data) plus WHO GHO SDG 3.d.2. Blood and CSF isolates only, national totals.

## Data

| Source | Content | How it is obtained |
|---|---|---|
| UAMDS network annual report (UAMDS Ağı Yıllık Raporu; 2024 data), HSGM, January 2026 | 8 pathogens, 55 pathogen-antibiotic rows (2024) + the 2020–2024 trend for 26 pairs | `extract/uamds_extract.py` parses the PDF in memory |
| WHO GHO (SDG 3.d.2) | E. coli (third-generation cephalosporins) and MRSA, Türkiye 2021–2023 | same script, OData API |
| Local antibiogram (optional) | The institution's own data | `AMR_TR_LOCAL=/yol/antibiyogram.csv` |

No number was entered by hand. The extractor matches the final-year column of the five-year
summary table against the per-pathogen tables; on a mismatch it writes no file. 25 of the 26 trend
rows were verified this way. The only row that could not be verified is P. aeruginosa /
`Karbapenemler` (carbapenems): the 2024 table has no group row, only imipenem and meropenem
separately.

## Limitations

- **Blood and CSF** isolates only. No urine, respiratory or wound specimens.
- **National totals**: no breakdown by region, province or hospital. 49.6% of the isolates are
  from intensive care.
- When choosing empirical therapy for community-acquired infections, these rates
  overstate resistance.
- "Local" resistance requires the institution's own antibiogram; there is no publicly available
  source for it.
- WHO GHO and the UAMDS report give different values for the same year (2023 E. coli: 56.42% and
  59%). The reason is the calculation rule; the data are the same: the WHO value is the percentage
  for a single antibiotic in the class (ceftriaxone in 2023, 3113/5518), whereas the UAMDS value is
  class-level (in GLASS 3528/5992 = 58.88%). For Türkiye, in 6 of 6 year-indicator pairs the WHO
  value matched, to two decimal places, that of the member with the highest resistance percentage
  (raw GLASS counts: `xmart-api-public.who.int/DATA_/RELAY_GLASS_AMR_CTA`). No WHO document stating
  this rule was found; the rule was inferred from the numbers.
- The 2022 class rows in GLASS carry the same counts as a single member (E. coli: ceftazidime,
  MRSA: oxacillin); not a combined value. The reason is unknown. In the same table the 2024 rows
  are a copy of the 2023 rows.

## Tools

- `amr_tr_status` — source, scope, tracked pathogens, local CSV status
- `amr_tr_resistance` — R %, I %, n, trend and source page for a pathogen and/or an antibiotic
- `amr_tr_trend` — the 2020–2024 series and the report's trend assessment

## Running

```bash
npm install
npm test
```

To refresh the data (with `--url` once a new year's report is out):

```bash
npm run extract
```

If the report layout changes, the extractor lists the problems and exits with code 1;
`data/uamds.json` stays as it was.

## Local antibiogram CSV

Header: `pathogen, antibiotic, n, r_pct` are required; `source, year, specimen, setting` are
optional. The delimiter is a comma or a semicolon, and a decimal comma is accepted. Invalid rows
are skipped and listed with their row number in the `amr_tr_status` output. Rows with n < 30 are
shown with a warning.

## License and data

The code is licensed under [MIT](LICENSE). `data/uamds.json` was derived with `extract/uamds_extract.py` from the publicly available sources named in the table above (the HSGM UAMDS network annual report and WHO GHO); the source institutions own the data and are responsible for it.
