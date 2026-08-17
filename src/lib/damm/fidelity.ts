/**
 * Fidelity check on model-written prose.
 *
 * The product's central promise is that no figure in a draft was invented by a
 * language model. Until now that promise rested entirely on a sentence in the
 * system prompt, while the code replaced each deterministic chapter body with
 * whatever the model returned. A prompt is not an enforcement mechanism.
 *
 * This module re-reads the generated prose and rejects it when it contains a
 * number, a year or a maturity-stage claim that is not present in the engine
 * facts the model was given. Rejected prose is discarded and the deterministic
 * skeleton is kept — a duller chapter is always preferable to a plausible
 * fabricated one.
 */

export interface FidelityReport {
  ok: boolean;
  /** Numbers in the prose with no counterpart in the payload. */
  unsupportedNumbers: string[];
  /** Stage assertions made when the payload says no stage is claimable. */
  unsupportedClaims: string[];
  reason: string | null;
}

/** Structural numbers that carry no factual claim: list markers, chapter ids. */
const STRUCTURAL_MAX = 12;

/**
 * Walk any facts object and collect every number that legitimately appears in
 * it, including numbers embedded in strings (the facts block is rendered text,
 * so "coverage 100%" must license the 100).
 */
export function collectAllowedNumbers(facts: unknown, into = new Set<number>()): Set<number> {
  const visit = (node: unknown) => {
    if (node == null) return;
    if (typeof node === "number") {
      if (Number.isFinite(node)) into.add(node);
      return;
    }
    if (typeof node === "string") {
      for (const raw of node.match(/(?<!\d)-?\d[\d,]*(?:\.\d+)?/g) ?? []) {
        const n = Number(raw.replace(/,/g, ""));
        if (Number.isFinite(n)) into.add(n);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) visit(v);
    }
  };
  visit(facts);
  return into;
}

/**
 * Is `candidate` supported by the allowed set?
 *
 * A model may legitimately re-round a figure it was given (2.63 → 2.6), so a
 * candidate is supported when it matches an allowed value to the precision the
 * model chose to print. It may not invent precision the payload never had.
 */
export function isSupportedNumber(candidate: number, decimals: number, allowed: Set<number>): boolean {
  if (allowed.has(candidate)) return true;
  if (Number.isInteger(candidate) && candidate >= 0 && candidate <= STRUCTURAL_MAX) return true;
  const tolerance = decimals > 0 ? 0.5 / 10 ** decimals : 0.5;
  for (const value of allowed) {
    if (Math.abs(value - candidate) < tolerance) return true;
  }
  return false;
}

/**
 * Check one chapter body against the facts the model was given.
 *
 * `claimableStage` is the payload's own verdict: when nothing is claimable, any
 * "Stage 3" or "Established" style assertion in the prose is a fabrication of
 * exactly the kind this product exists to prevent.
 */
export function checkProseFidelity(
  prose: string,
  facts: unknown,
  options: {
    stageClaimable?: boolean;
    /**
     * Prescriptive chapters plan; diagnostic chapters report. A roadmap chapter
     * legitimately contains phase numbers and target years that are proposals,
     * not observations, so rejecting them as "unsupported" would make the
     * strategy chapters undraftable. Observed statistics stay bounded in both
     * modes — the difference is only what counts as forward-looking.
     */
    kind?: "diagnostic" | "prescriptive";
    /** Years at or beyond this are proposals, not claims about the present. */
    assessmentYear?: number;
  } = {},
): FidelityReport {
  const allowed = collectAllowedNumbers(facts);
  const unsupportedNumbers: string[] = [];
  const planning = options.kind === "prescriptive";
  const horizon = options.assessmentYear ?? 0;

  // Numbered section headings ("10.1 No-regret actions", "### 17.3 …") are
  // document structure, not factual claims. They are stripped by POSITION —
  // start of line, optionally after markdown marks — never by value, so a
  // "10.5 million" in running text is still checked like any other figure.
  const scannable = prose.replace(/^[\s>#*-]*\d{1,2}(?:\.\d{1,2})+[.:)]?\s+/gm, "");

  for (const raw of scannable.match(/(?<!\d)-?\d[\d,]*(?:\.\d+)?/g) ?? []) {
    // Commas are thousands separators. Spaces are left OUT of the class on
    // purpose: including them glued "chapter 2 25 systems" into phantom
    // numbers that were then "not in the evidence base" (L15).
    const cleaned = raw.replace(/,/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) continue;
    const decimals = (cleaned.split(".")[1] ?? "").length;
    if (isSupportedNumber(n, decimals, allowed)) continue;
    // A future year in a roadmap chapter is a target, not a fabricated reading.
    if (planning && horizon && Number.isInteger(n) && n >= horizon && n <= horizon + 25) continue;
    unsupportedNumbers.push(raw.trim());
  }

  const unsupportedClaims: string[] = [];
  if (options.stageClaimable === false) {
    for (const m of prose.matchAll(/\bstage\s+[1-5]\b/gi)) unsupportedClaims.push(m[0]);
    for (const m of prose.matchAll(/\b(?:is|are|remains?|sits?)\s+(?:at\s+)?(?:the\s+)?(emerging|established|advanced|nascent|transformative|leading)\b/gi)) {
      unsupportedClaims.push(m[0]);
    }
  }

  const unique = (xs: string[]) => Array.from(new Set(xs));
  const nums = unique(unsupportedNumbers);
  const claims = unique(unsupportedClaims);
  const ok = nums.length === 0 && claims.length === 0;

  const parts: string[] = [];
  if (nums.length) parts.push(`figures not present in the evidence base: ${nums.slice(0, 8).join(", ")}`);
  if (claims.length) parts.push(`stage assertions the evidence does not license: ${claims.slice(0, 4).join(", ")}`);

  return {
    ok,
    unsupportedNumbers: nums,
    unsupportedClaims: claims,
    reason: ok ? null : `Model prose rejected — ${parts.join("; ")}.`,
  };
}
