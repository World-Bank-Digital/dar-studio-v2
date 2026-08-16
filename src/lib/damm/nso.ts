/** National statistical offices and digital/agriculture ministries used as first-preference search domains. */
const NSO: Record<string, string[]> = {
  EGY: ["capmas.gov.eg", "mcit.gov.eg", "egypt.gov.eg", "moa.gov.eg", "malr.gov.eg", "ntra.gov.eg", "ai.gov.eg", "fra.gov.eg"],
  BTN: ["nsb.gov.bt", "moal.gov.bt", "gov.bt"],
  KEN: ["knbs.or.ke", "kilimo.go.ke", "ict.go.ke"],
  IND: ["mospi.gov.in", "agricoop.nic.in", "meity.gov.in"],
  IDN: ["bps.go.id", "pertanian.go.id", "kominfo.go.id"],
  NGA: ["nigerianstat.gov.ng", "fmard.gov.ng"],
  GHA: ["statsghana.gov.gh", "mofa.gov.gh"],
  ETH: ["statsethiopia.gov.et"],
  RWA: ["statistics.gov.rw", "minagri.gov.rw"],
  TZA: ["nbs.go.tz"],
  UGA: ["ubos.org"],
  ZAF: ["statssa.gov.za"],
  MAR: ["hcp.ma"],
  TUN: ["ins.tn"],
  SEN: ["ansd.sn"],
  CIV: ["ins.ci"],
  VNM: ["gso.gov.vn"],
  PHL: ["psa.gov.ph"],
  BGD: ["bbs.gov.bd"],
  PAK: ["pbs.gov.pk"],
  NPL: ["cbs.gov.np"],
  LKA: ["statistics.gov.lk"],
  THA: ["nso.go.th"],
  KHM: ["nis.gov.kh"],
  LAO: ["lsb.gov.la"],
  MMR: ["csostat.gov.mm"],
  JOR: ["dos.gov.jo"],
  LBN: ["cas.gov.lb"],
  TUR: ["tuik.gov.tr"],
  MEX: ["inegi.org.mx"],
  BRA: ["ibge.gov.br"],
  COL: ["dane.gov.co"],
  PER: ["inei.gob.pe"],
  ARG: ["indec.gob.ar"],
  CHL: ["ine.cl"],
  USA: ["census.gov", "usda.gov", "ntia.gov"],
  GBR: ["ons.gov.uk", "gov.uk"],
};

export function nsoDomainsFor(iso3: string): string[] {
  return NSO[iso3.toUpperCase()] ?? [];
}

export function isGovernmentHost(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  if (/\.gov$/.test(h) || /\.gob$/.test(h) || /\.gouv\./.test(h)) return true;
  if (/\.gov\.[a-z]{2}$/.test(h) || /\.go\.[a-z]{2}$/.test(h) || /\.gob\.[a-z]{2}$/.test(h)) return true;
  for (const domains of Object.values(NSO)) {
    if (domains.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  }
  return (
    h.includes("capmas") ||
    h.includes("nso.") ||
    h.startsWith("stats") ||
    h.includes("statistics")
  );
}
