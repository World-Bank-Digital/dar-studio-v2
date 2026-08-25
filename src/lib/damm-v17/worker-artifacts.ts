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
  scans: [
    { key: "scans", label: "Scan findings" },
    { key: "register", label: "Initiative register" },
  ],
  foresight: [
    { key: "foresight", label: "Foresight report" },
    { key: "foresight-json", label: "Scenarios and milestones" },
  ],
  generation: [
    { key: "dar", label: "Draft roadmap" },
    { key: "dar-json", label: "Roadmap source" },
  ],
  diagnostic: [
    { key: "diagnostic", label: "Diagnostic report" },
    { key: "scored", label: "Scored assessment" },
  ],
};

export function artifactsFor(pass: RunPass): ArtifactLink[] {
  return ARTIFACTS[pass] ?? [];
}


/**
 * The three documents the pipeline exists to produce, and which pass produces each.
 *
 * A1: review happens once, at the end, on the completed set — not per artifact. So the
 * set has to be nameable even when it is incomplete, and a missing document has to say
 * which pass would produce it rather than simply not appearing.
 */
export interface DocumentSlot {
  key: string;
  title: string;
  what: string;
  pass: RunPass;
  artifactKey: string;
}

export const DOCUMENT_SLOTS: DocumentSlot[] = [
  {
    key: "diagnostic",
    title: "Diagnostic report",
    what: "Where the country stands, on the evidence recorded. Ten sections, emit-gated.",
    pass: "diagnostic",
    artifactKey: "diagnostic",
  },
  {
    key: "foresight",
    title: "Strategic foresight",
    what: "Scenarios, a preferred future offered for decision, and milestones bound to the instrument.",
    pass: "foresight",
    artifactKey: "foresight",
  },
  {
    key: "roadmap",
    title: "Draft roadmap",
    what: "Eleven chapters. Chapters three to ten are proposed, not evidenced.",
    pass: "generation",
    artifactKey: "dar",
  },
];
