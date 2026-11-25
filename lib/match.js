// Matches pathogen and antibiotic names against the query text. Produces no numbers.

const TR = { İ: "i", I: "i", ı: "i", Ş: "s", ş: "s", Ğ: "g", ğ: "g", Ü: "u", ü: "u", Ö: "o", ö: "o", Ç: "c", ç: "c" };

export const fold = (s) =>
  String(s ?? "").replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => TR[c]).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Removes plural-suffix and ordinal-number differences: "Florokinolonlar" ~ "florokinolon" (fluoroquinolones), "Üçüncü kuşak" ~ "3 kusak" (third generation)
export const stem = (s) =>
  fold(s).split(" ").map((w) => (w === "ucuncu" ? "3" : w.replace(/(ler|lar)$/, ""))).join(" ");

const EN_TR = [
  ["third generation|3rd generation", "3 kusak"],
  ["3gc", "3 kusak sefalosporin"],
  ["fluoroquinolones?|quinolones?|kinolon(?:lar)?", "florokinolon"],
  ["cephalosporins?", "sefalosporin"],
  ["carbapenems?", "karbapenem"],
  ["aminoglycosides?", "aminoglikozid"],
  ["aminopenicillins?", "aminopenisilin"],
  ["macrolides?", "makrolid"],
  ["ciprofloxacin", "siprofloksasin"], ["levofloxacin", "levofloksasin"], ["ofloxacin", "ofloksasin"],
  ["cefotaxime", "sefotaksim"], ["ceftriaxone", "seftriakson"], ["ceftazidime", "seftazidim"], ["cefepime", "sefepim"],
  ["amikacin", "amikasin"], ["gentamicin", "gentamisin"], ["tobramycin", "tobramisin"],
  ["colistin", "kolistin"], ["vancomycin|vre", "vankomisin"], ["rifampicin|rifampin", "rifampisin"],
  ["penicillin", "penisilin"], ["ampicillin", "ampisilin"], ["amoxicillin", "amoksisilin"],
  ["erythromycin", "eritromisin"], ["clarithromycin", "klaritromisin"], ["azithromycin", "azitromisin"],
  ["piperacillin tazobactam|pip tazo|tzp", "piperasilin tazobaktam"],
  ["esbl", "gsbl"],
  ["mdr|multidrug resistan(?:ce|t)|multi drug resistan(?:ce|t)", "coklu ilac direnci"],
  ["methicillin|metisilin|oxacillin|oksasilin|cefoxitin|sefoksitin", "mrsa"],
  ["high level gentamicin|hlgr", "yuksek duzey gentamisin"],
].map(([en, tr]) => [new RegExp(`\\b(?:${en})\\b`, "g"), tr]);

// Used only to expand the query: when a class name is queried, the individually reported members of that class should be returned too.
// The report's own group definition (data.pathogens[*].groups) is independent of this, and that is what the output shows.
const CLASSES = {
  karbapenem: ["imipenem", "meropenem", "ertapenem"],
  aminoglikozid: ["gentamisin", "tobramisin", "amikasin"],
  florokinolon: ["siprofloksasin", "levofloksasin", "ofloksasin"],
  sefalosporin: ["sefotaksim", "seftriakson", "seftazidim", "sefepim"],
  aminopenisilin: ["ampisilin", "amoksisilin"],
  makrolid: ["eritromisin", "klaritromisin", "azitromisin"],
};

const ALIASES = {
  "E. coli": ["e coli", "ecoli", "escherichia"],
  "K. pneumoniae": ["k pneumoniae", "klebsiella", "klebsiyella"],
  "P. aeruginosa": ["p aeruginosa", "pseudomonas", "psodomonas", "aeruginosa"],
  "Acinetobacter spp.": ["acinetobacter", "asinetobakter", "baumannii"],
  "S. aureus": ["s aureus", "staphylococcus", "stafilokok", "staph", "aureus", "mrsa", "mssa"],
  "S. pneumoniae": ["s pneumoniae", "streptococcus pneumoniae", "pnomokok", "pneumococc"],
  "E. faecalis": ["e faecalis", "faecalis", "fekalis"],
  "E. faecium": ["e faecium", "faecium", "fesyum", "vre"],
};
const GENERIC = [
  [/\b(enterococc|enterokok)/, ["E. faecalis", "E. faecium"]],
  [/\bpneumoniae\b/, ["K. pneumoniae", "S. pneumoniae"]],
];

export function resolvePathogens(query, names) {
  const q = fold(query);
  if (!q) return [];
  const hit = names.filter((n) => [fold(n), ...(ALIASES[n] || [])].some((a) => q === a || q.includes(a)));
  if (hit.length) return hit;
  for (const [rx, list] of GENERIC) if (rx.test(q)) return list.filter((n) => names.includes(n));
  return names.filter((n) => fold(n).includes(q));
}

export function groupMembers(antibiotic, groups = {}) {
  const key = Object.keys(groups).find((g) => stem(g) === stem(antibiotic));
  return key ? groups[key] : [];
}

export function antibioticTerms(query) {
  let q = fold(query);
  for (const [rx, tr] of EN_TR) q = q.replace(rx, tr);
  q = stem(q);
  const extra = Object.entries(CLASSES).filter(([cls]) => q.includes(cls)).flatMap(([, m]) => m);
  return [q, ...extra];
}

export function matchesAntibiotic(terms, antibiotic, groups) {
  const row = [stem(antibiotic), ...groupMembers(antibiotic, groups).map(stem)];
  return terms.some((t) => row.some((r) => r.includes(t) || t.includes(r)));
}
