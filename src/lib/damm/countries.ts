export interface Economy {
  name: string;
  iso3: string;
  iso2: string;
  region: string;
}

/** Fallback if the World Bank country list cannot be reached. */
export const FALLBACK_ECONOMIES: Economy[] = [
  { name: "Afghanistan", iso3: "AFG", iso2: "AF", region: "South Asia" },
  { name: "Bangladesh", iso3: "BGD", iso2: "BD", region: "South Asia" },
  { name: "Benin", iso3: "BEN", iso2: "BJ", region: "Sub-Saharan Africa" },
  { name: "Bhutan", iso3: "BTN", iso2: "BT", region: "South Asia" },
  { name: "Burkina Faso", iso3: "BFA", iso2: "BF", region: "Sub-Saharan Africa" },
  { name: "Cambodia", iso3: "KHM", iso2: "KH", region: "East Asia & Pacific" },
  { name: "Cameroon", iso3: "CMR", iso2: "CM", region: "Sub-Saharan Africa" },
  { name: "Côte d'Ivoire", iso3: "CIV", iso2: "CI", region: "Sub-Saharan Africa" },
  { name: "Egypt, Arab Rep.", iso3: "EGY", iso2: "EG", region: "Middle East & North Africa" },
  { name: "Ethiopia", iso3: "ETH", iso2: "ET", region: "Sub-Saharan Africa" },
  { name: "Ghana", iso3: "GHA", iso2: "GH", region: "Sub-Saharan Africa" },
  { name: "India", iso3: "IND", iso2: "IN", region: "South Asia" },
  { name: "Indonesia", iso3: "IDN", iso2: "ID", region: "East Asia & Pacific" },
  { name: "Jordan", iso3: "JOR", iso2: "JO", region: "Middle East & North Africa" },
  { name: "Kenya", iso3: "KEN", iso2: "KE", region: "Sub-Saharan Africa" },
  { name: "Lao PDR", iso3: "LAO", iso2: "LA", region: "East Asia & Pacific" },
  { name: "Madagascar", iso3: "MDG", iso2: "MG", region: "Sub-Saharan Africa" },
  { name: "Malawi", iso3: "MWI", iso2: "MW", region: "Sub-Saharan Africa" },
  { name: "Mali", iso3: "MLI", iso2: "ML", region: "Sub-Saharan Africa" },
  { name: "Morocco", iso3: "MAR", iso2: "MA", region: "Middle East & North Africa" },
  { name: "Mozambique", iso3: "MOZ", iso2: "MZ", region: "Sub-Saharan Africa" },
  { name: "Myanmar", iso3: "MMR", iso2: "MM", region: "East Asia & Pacific" },
  { name: "Nepal", iso3: "NPL", iso2: "NP", region: "South Asia" },
  { name: "Niger", iso3: "NER", iso2: "NE", region: "Sub-Saharan Africa" },
  { name: "Nigeria", iso3: "NGA", iso2: "NG", region: "Sub-Saharan Africa" },
  { name: "Pakistan", iso3: "PAK", iso2: "PK", region: "South Asia" },
  { name: "Philippines", iso3: "PHL", iso2: "PH", region: "East Asia & Pacific" },
  { name: "Rwanda", iso3: "RWA", iso2: "RW", region: "Sub-Saharan Africa" },
  { name: "Senegal", iso3: "SEN", iso2: "SN", region: "Sub-Saharan Africa" },
  { name: "Tanzania", iso3: "TZA", iso2: "TZ", region: "Sub-Saharan Africa" },
  { name: "Thailand", iso3: "THA", iso2: "TH", region: "East Asia & Pacific" },
  { name: "Tunisia", iso3: "TUN", iso2: "TN", region: "Middle East & North Africa" },
  { name: "Uganda", iso3: "UGA", iso2: "UG", region: "Sub-Saharan Africa" },
  { name: "Vietnam", iso3: "VNM", iso2: "VN", region: "East Asia & Pacific" },
  { name: "Zambia", iso3: "ZMB", iso2: "ZM", region: "Sub-Saharan Africa" },
];

export async function fetchEconomies(): Promise<Economy[]> {
  try {
    const url = "https://api.worldbank.org/v2/country?format=json&per_page=400";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/json",
        "User-Agent": "DAR-Studio/1.3 (independent prototype; World Bank client)",
      },
    });
    if (!res.ok) return FALLBACK_ECONOMIES;
    const body = (await res.json()) as [
      unknown,
      Array<{
        id: string;
        iso2Code: string;
        name: string;
        region: { value: string };
        capitalCity: string;
      }>,
    ];
    const rows = body[1] ?? [];
    const list = rows
      .filter((r) => r.region?.value && r.region.value !== "Aggregates" && r.id.length === 3)
      .map((r) => ({
        name: r.name,
        iso3: r.id,
        iso2: r.iso2Code,
        region: r.region.value,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return list.length > 0 ? mergeFallback(list) : FALLBACK_ECONOMIES;
  } catch {
    return FALLBACK_ECONOMIES;
  }
}

function mergeFallback(list: Economy[]): Economy[] {
  const have = new Set(list.map((e) => e.iso3));
  const extra = FALLBACK_ECONOMIES.filter((e) => !have.has(e.iso3));
  if (extra.length === 0) return list;
  return [...list, ...extra].sort((a, b) => a.name.localeCompare(b.name));
}

export function economyByName(list: Economy[], name: string): Economy | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return (
    list.find((e) => e.name.toLowerCase() === n) ||
    list.find((e) => e.iso3.toLowerCase() === n) ||
    list.find((e) => e.iso2.toLowerCase() === n) ||
    list.find((e) => e.name.toLowerCase().startsWith(n)) ||
    list.find((e) => e.name.toLowerCase().includes(n))
  );
}
