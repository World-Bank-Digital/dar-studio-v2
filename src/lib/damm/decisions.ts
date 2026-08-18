/**
 * Decision-record reconciliation.
 *
 * Step 3 records the same fact twice: the targeting table keeps a structured
 * list of rejected value chains, and the decision row keeps the free-text
 * "explicitly rejected" line every rung of the ladder carries. The draft
 * renders both — the targeting summary in chapter 10, the decision record in
 * chapters 2, 9 and 17 — so when they disagree the document contradicts
 * itself in the reader's hands. It did: a live draft said both "Rejected
 * alternatives: (none recorded)" and "Rejected: Rice expansion", and the red
 * team caught it three times over.
 *
 * Neither store is the loser. Whichever side the caller filled becomes the
 * other's value, so the two cannot diverge no matter which surface (form,
 * script, future API client) records the decision.
 */

/** Split a free-text rejection line into entries: "Rice; Maize, Sorghum" → 3. */
export function splitRejections(text: string): string[] {
  return text
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ReconciledRejections {
  /** Structured list for the targeting table. */
  list: string[];
  /** Free-text line for the decision row; null when there is nothing to record. */
  text: string | null;
}

/**
 * Make the two rejection stores agree. An empty side takes the populated
 * side's value; when both are populated the caller meant both, so they are
 * merged without duplicates rather than one silently winning.
 */
export function reconcileRejections(input: { text?: string | null; list?: string[] | null }): ReconciledRejections {
  const fromText = splitRejections(input.text ?? "");
  const fromList = (input.list ?? []).map((s) => s.trim()).filter(Boolean);

  const merged: string[] = [];
  for (const entry of [...fromList, ...fromText]) {
    if (!merged.some((m) => m.toLowerCase() === entry.toLowerCase())) merged.push(entry);
  }
  return { list: merged, text: merged.length ? merged.join("; ") : null };
}
