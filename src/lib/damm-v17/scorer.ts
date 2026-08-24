/**
 * DAMM v1.7 scorer — derives an assessment from the model file plus observations.
 *
 * This is a line-faithful port of the pipeline's reference scorer, which exists to
 * prove the model file is complete: it reads nothing but the model and the
 * observations. `scorer.test.ts` holds it to the pipeline's own Egypt and Nigeria
 * outputs, figure for figure — if this file and the pipeline ever disagree, the
 * test names the number.
 *
 * The invariants that must survive any edit here:
 *  - No level without a recorded value; the class derives from the value, never chosen.
 *  - A withheld level is not an absence: such a row is outside every mean, and a
 *    prerequisite so recorded reads Unverified, never Absent.
 *  - A mean never travels without its own denominator (rated of n).
 *  - Rounding is half-up (away from zero), matching the scoring workbook — the
 *    workbook is the source of truth and IEEE round-to-even disagrees at exact .xx5.
 */
import type {
  Assessment,
  DammModelV17,
  EvidenceClass,
  IndicatorDef,
  LayerId,
  MatrixCell,
  MatrixStatus,
  Observation,
  Observations,
  PillarId,
  PillarScore,
  PrereqStatus,
  UseCaseId,
} from "./types.ts";

/**
 * Round half away from zero to 2dp, matching Excel's ROUND(). `Math.round(x * 100)`
 * is not this function: 2.675 * 100 is 267.49999… in IEEE 754, which would round a
 * band-edge mean the wrong way. Like the pipeline, we round the shortest decimal
 * representation of the number, not its binary expansion.
 */
export function r2(x: number): number {
  const neg = x < 0;
  let s = String(Math.abs(x));
  if (s.includes("e") || s.includes("E")) s = Math.abs(x).toFixed(12);
  const [whole, frac = ""] = s.split(".");
  let cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (frac.length > 2 && frac.charCodeAt(2) >= 53 /* '5' */) cents += 1;
  return (neg ? -cents : cents) / 100;
}

type Row = {
  cls: EvidenceClass | "";
  level: number | null;
  stale: boolean;
  pillar: PillarId;
  layer: LayerId;
};

/** The level each band is named for (ruling 13.1). */
const BAND_LEVEL: Record<string, number> = {
  Nascent: 1,
  Emerging: 2,
  Established: 3,
  Advanced: 4,
  Transformative: 5,
};

export class Scorer {
  private readonly m: DammModelV17;
  private readonly ind: Map<string, IndicatorDef>;

  constructor(m: DammModelV17) {
    this.m = m;
    this.ind = new Map(m.indicators.map((i) => [i.id, i]));
  }

  /** Derived from what was recorded, never chosen. */
  evidenceClass(r: Observation): EvidenceClass | "" {
    const v = r.value;
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number") return "Measured";
    if (String(v).toUpperCase().includes("DATA GAP")) return "Gap";
    if (r.src && r.tier !== "T5") return "Documented";
    return "Judged";
  }

  /** Threshold level: 1 + how many cut-points the value meets, in the row's direction. */
  private level(def: IndicatorDef, r: Observation, cls: EvidenceClass | ""): number | null {
    if (cls === "" || cls === "Gap") return null;
    if (cls === "Measured" && def.thresholds && typeof r.value === "number") {
      const higher = def.direction === "higher-is-better";
      let lv = 1;
      def.thresholds.forEach((t, k) => {
        if (higher ? (r.value as number) >= t : (r.value as number) <= t) lv = k + 2;
      });
      return lv;
    }
    return r.level ?? null;
  }

  private stale(r: Observation, cls: EvidenceClass | ""): boolean {
    const y = r.year;
    return Boolean(
      y && cls !== "Gap" && y < this.m.config.assessment_year - this.m.config.staleness_years,
    );
  }

  band(x: number): string {
    for (const b of this.m.bands) if (b.lo <= x && x < b.hi) return b.name;
    return "—";
  }

  run(obs: Observations): Assessment {
    const rows = new Map<string, Row>();
    for (const [id, def] of this.ind) {
      const r = obs[id];
      if (!r) throw new Error(`observations missing indicator ${id}`);
      const cls = r.cls || this.evidenceClass(r);
      // A present-but-null level is a withheld level (ratification hold) and stands;
      // only an absent property asks the scorer to derive.
      const level = "level" in r ? (r.level ?? null) : this.level(def, r, cls);
      rows.set(id, { cls, level, stale: this.stale(r, cls), pillar: def.pillar, layer: def.layer });
    }

    const CLASSES: EvidenceClass[] = ["Measured", "Documented", "Judged", "Gap"];

    const pillars = {} as Record<PillarId, PillarScore>;
    for (const p of Object.keys(this.m.pillars) as PillarId[]) {
      const rs = [...rows.values()].filter((v) => v.pillar === p);
      const lv = rs.filter((v) => v.level !== null).map((v) => v.level as number);
      const comp = Object.fromEntries(
        CLASSES.map((c) => [c, rs.filter((v) => v.cls === c).length]),
      ) as Record<EvidenceClass, number>;
      const rated = lv.length;
      const held = rs.filter((v) => v.level === null && v.cls !== "Gap").length;
      const judgedRated = rs.filter((v) => v.cls === "Judged" && v.level !== null).length;
      const mean = lv.length ? r2(lv.reduce((a, b) => a + b, 0) / lv.length) : null;
      const bandName = mean !== null ? this.band(mean) : "Not rated";
      pillars[p] = {
        n: rs.length,
        rated,
        held,
        mean,
        band: bandName,
        // Ruling 13.1: the signed distance from the level the band is named for. Measured
        // from the level, not the interval midpoint: the end bands are half-width, so a
        // pillar with every row at level 1 would otherwise read -0.25 instead of +0.00.
        margin: mean !== null && bandName in BAND_LEVEL ? r2(mean - BAND_LEVEL[bandName]) : null,
        weak: judgedRated + comp.Gap + held > rated - judgedRated,
        comp,
        stale: rs.filter((v) => v.stale).length,
      };
    }

    const layers = {} as Record<LayerId, number | null>;
    for (const L of this.m.layers) {
      const lv = [...rows.values()]
        .filter((v) => v.layer === L && v.level !== null)
        .map((v) => v.level as number);
      layers[L] = lv.length ? r2(lv.reduce((a, b) => a + b, 0) / lv.length) : null;
    }
    const F = layers.Foundation;
    const T = layers.Transformation;
    const leapfrog = { gap: F && T ? r2(F - T) : null };

    const prereq: Assessment["prereq"] = {};
    for (const [id, def] of this.ind) {
      if (!def.prerequisite) continue;
      const v = rows.get(id) as Row;
      let status: PrereqStatus;
      if (v.cls === "Gap" || v.level === null) status = "Unverified";
      else if (v.level >= 3) status = "Present";
      else if (v.level === 2) status = "Present (narrow)";
      else status = "Absent";
      prereq[id] = { kind: def.prerequisite, status };
    }

    const universal = (s: PrereqStatus) =>
      Object.entries(prereq)
        .filter(([, v]) => v.kind === "UNIVERSAL" && v.status === s)
        .map(([i]) => i);
    const uniBlocked = universal("Absent");
    const uniUnverified = universal("Unverified");
    const uniNarrow = universal("Present (narrow)");

    const threshold = this.m.config.readiness_threshold;
    const matrix = {} as Record<UseCaseId, MatrixCell>;
    for (const uc of Object.keys(this.m.use_cases) as UseCaseId[]) {
      // Ruling 13.4: 7.12 follows the use of personal or farm-level data, so its columns
      // are read from the model like every other per-use-case prerequisite. The hard-coded
      // UC:AI -> AGI special case is gone. Split on "," so UC:FIN never matches UC:FINX.
      const pres = Object.entries(prereq).filter(
        ([, v]) => v.kind.startsWith("UC:") && v.kind.slice(3).split(",").includes(uc),
      );
      const bearing = [...this.ind.values()].filter(
        (d) =>
          (d.use_cases.includes(uc) || d.tags.includes("ALL")) &&
          (rows.get(d.id) as Row).level !== null,
      );
      // Ruling 13.12: the three roles are separated. A1 rows measure the severity of the
      // problem and O1 rows measure achieved outcomes; only the enabling rows measure
      // readiness, and only the readiness mean decides the column. Averaging all three
      // made a country with a worse agricultural problem read as less digitally ready.
      const roleOf = (pillar: string) =>
        pillar === "A1" ? "need" : pillar === "O1" ? "outcome" : "enabler";
      const roleMean = (want: string) => {
        const v = bearing
          .filter((d) => roleOf(d.pillar) === want)
          .map((d) => (rows.get(d.id) as Row).level as number);
        return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
      };
      const meanReadiness = roleMean("enabler");
      const meanNeed = roleMean("need");
      const meanOutcome = roleMean("outcome");

      const withStatus = (s: PrereqStatus) =>
        pres.filter(([, v]) => v.status === s).map(([i]) => i);
      let status: MatrixStatus;
      let why: string;
      if (uniBlocked.length) {
        status = "Blocked";
        why = "Universal: " + uniBlocked.join(", ");
      } else if (withStatus("Absent").length) {
        status = "Blocked";
        why = withStatus("Absent").join(", ");
      } else if (uniUnverified.length) {
        status = "Unverified";
        why = "universal unverified: " + uniUnverified.join(", ");
      } else if (withStatus("Unverified").length) {
        status = "Unverified";
        why = withStatus("Unverified").join(", ");
      } else if (
        withStatus("Present (narrow)").length ||
        (meanReadiness !== null && meanReadiness < threshold)
      ) {
        status = "Partial";
        why = withStatus("Present (narrow)").join(", ") || "thin enablers";
      } else if (uniNarrow.length) {
        status = "Partial";
        why = "universal narrow: " + uniNarrow.join(", ");
      } else {
        status = "Ready";
        why = "";
      }

      matrix[uc] = {
        status,
        why,
        mean_readiness: meanReadiness,
        mean_need: meanNeed,
        mean_outcome: meanOutcome,
        n_bearing: bearing.length,
      };
    }

    const all = [...rows.values()];
    return {
      pillars,
      layers,
      leapfrog,
      prereq,
      matrix,
      counts: Object.fromEntries(
        CLASSES.map((c) => [c, all.filter((v) => v.cls === c).length]),
      ) as Record<EvidenceClass, number>,
      rated: all.filter((v) => v.level !== null).length,
      held: all.filter((v) => v.level === null && v.cls !== "Gap").length,
    };
  }
}
