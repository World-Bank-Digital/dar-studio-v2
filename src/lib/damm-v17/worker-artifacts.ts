/**
 * What each pass produces, for the surfaces that link to it.
 *
 * Split from `worker.ts` because that module reaches node:child_process and node:fs, and
 * a browser bundle importing it to render a link would pull the whole worker in. The
 * paths stay in `worker.ts`, where the filesystem belongs; only the labels are here.
 */
import type { RunPass } from "./runs.ts";

export interface ArtifactLink {
  key: string;
  label: string;
}

const ARTIFACTS: Record<RunPass, ArtifactLink[]> = {
  research: [
    { key: "input", label: "Engine input" },
    { key: "trail", label: "Research trail" },
  ],
  g2: [
    { key: "input", label: "Reviewed engine input" },
    { key: "findings", label: "Review findings" },
  ],
  scans: [{ key: "scans", label: "Scan findings" }],
  foresight: [{ key: "foresight", label: "Scenarios and milestones" }],
  generation: [
    { key: "dar", label: "Draft roadmap" },
    { key: "dar-json", label: "Roadmap source" },
  ],
};

export function artifactsFor(pass: RunPass): ArtifactLink[] {
  return ARTIFACTS[pass] ?? [];
}
