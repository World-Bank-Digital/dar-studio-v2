import type { DammModel, IndicatorDef, PillarDef, PillarId } from "./types.ts";
import raw from "../../data/model_v1_3.json" with { type: "json" };

export const model = raw as DammModel;

export const AGGREGATED_PILLARS: PillarId[] = ["C1", "C2", "C3", "C4", "E1", "E2", "O1"];
export const CAPABILITY_PILLARS: PillarId[] = ["C1", "C2", "C3", "C4"];
export const ECOSYSTEM_PILLARS: PillarId[] = ["E1", "E2"];

export function indicatorById(id: string): IndicatorDef | undefined {
  return model.indicators.find((i) => i.id === id);
}

export function indicatorsFor(pillar: PillarId): IndicatorDef[] {
  return model.indicators.filter((i) => i.pillar === pillar);
}

export function pillarDef(id: PillarId): PillarDef {
  return model.pillars[id];
}

export function isCoreGate(id: string): boolean {
  return model.core_gates.includes(id);
}

export function isQuantitative(ind: IndicatorDef): boolean {
  return Array.isArray(ind.cuts) && ind.cuts.length > 0 && ind.direction !== "N/A";
}

export function disclaimer(): string {
  return (
    "Independent prototype — not an official World Bank system. " +
    "Not a country ranking. Not a scoring service. " +
    "Every stage is provisional until a human validates the evidence. " +
    "DAMM scores and stage movement must not be used as a PDO indicator, DLI or disbursement condition."
  );
}
