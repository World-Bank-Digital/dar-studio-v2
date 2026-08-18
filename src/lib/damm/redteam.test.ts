import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRedTeamPrompt,
  checkComparisons,
  checkOwnerlessRecommendations,
  checkStageAssertions,
  deterministicRedTeam,
  modelRedTeam,
  reviewableChapters,
  validateRedTeamFindings,
} from "./redteam.ts";

describe("red-team scope", () => {
  it("reviews the numbered chapters, never the model page, health page or annexes", () => {
    const chapters = [{ n: "model" }, { n: "health" }, { n: "2" }, { n: "17" }, { n: "B" }];
    assert.deepEqual(reviewableChapters(chapters).map((c) => c.n), ["2", "17"]);
  });
});

describe("deterministic policy checks", () => {
  it("catches cross-country ranking language with a locatable exhibit", () => {
    const body = "Registry coverage grew steadily. The country now ranks third among regional countries for agritech investment. More work remains.";
    const found = checkComparisons("3", body);
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, "high");
    assert.ok(body.includes(found[0].excerpt), "the exhibit must be verbatim");
  });

  it("catches a stage asserted while no stage is claimable — and stands down when one is", () => {
    const body = "On the evidence assembled, the sector is Established and the programme can proceed.";
    assert.equal(checkStageAssertions("3", body, false).length, 1);
    assert.equal(checkStageAssertions("3", body, true).length, 0);
  });

  it("does not read a band DEFINITION as a claim", () => {
    const body = "Scores fall into five bands, from Nascent (1.0-1.8) to Transformative (4.2-5.0).";
    assert.equal(checkStageAssertions("3", body, false).length, 0);
  });

  it("flags ownerless recommendations only in prescriptive chapters, and respects the hypothesis form", () => {
    const ownerless = "The registry should be extended to all governorates within two seasons. Coverage matters.";
    assert.equal(checkOwnerlessRecommendations("12", ownerless).length, 1);
    assert.equal(checkOwnerlessRecommendations("2", ownerless).length, 0, "diagnostic chapters describe; they do not prescribe");
    const owned = "The Ministry of Agriculture should extend the registry, financed under the existing programme budget.";
    assert.equal(checkOwnerlessRecommendations("12", owned).length, 0);
    const hypothesis = "The registry should be extended — stated as a hypothesis pending the Step 4 evidence plan.";
    assert.equal(checkOwnerlessRecommendations("12", hypothesis).length, 0);
  });

  it("sweeps all reviewable chapters at once", () => {
    const findings = deterministicRedTeam(
      [
        { n: "model", body: "The country is Established by definition of the band list." },
        { n: "3", body: "The country is Established and a regional leader in digital services." },
      ],
      false,
    );
    assert.ok(findings.every((f) => f.chapter === "3"), "the model page is never reviewed");
    assert.ok(findings.some((f) => f.category === "unclaimable-stage"));
    assert.ok(findings.some((f) => f.category === "prohibited-comparison"));
  });
});

describe("adversarial pass validation", () => {
  const BODY = "The extension service reached 120,000 farmers in 2024 according to the ministry's annual report. The same chapter later states outreach was discontinued in 2023.";

  it("keeps a finding whose exhibit is verbatim and drops one whose exhibit is fabricated", () => {
    const raw = JSON.stringify([
      { category: "contradiction", severity: "high", excerpt: "outreach was discontinued in 2023", note: "Contradicts the 2024 outreach figure earlier in the chapter." },
      { category: "unsupported-claim", severity: "high", excerpt: "the programme tripled its budget last year", note: "This exhibit does not appear in the chapter." },
    ]);
    const kept = validateRedTeamFindings(raw, "5", BODY);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].category, "contradiction");
    assert.equal(kept[0].source, "model");
  });

  it("rejects junk categories, severities and thin notes", () => {
    const raw = JSON.stringify([
      { category: "vibes", severity: "high", excerpt: "reached 120,000 farmers", note: "A long enough note for the check." },
      { category: "overreach", severity: "catastrophic", excerpt: "reached 120,000 farmers", note: "A long enough note for the check." },
      { category: "overreach", severity: "low", excerpt: "reached 120,000 farmers", note: "short" },
    ]);
    assert.equal(validateRedTeamFindings(raw, "5", BODY).length, 0);
  });

  it("tells the reviewer that finding nothing is acceptable and conditions are not findings", () => {
    const prompt = buildRedTeamPrompt({ chapter: "12", title: "Sequencing", body: BODY });
    assert.match(prompt, /VERBATIM/);
    assert.match(prompt, /conditional banner is the document working as designed/);
  });

  it("contains a crashing chapter and reviews the rest", async () => {
    const res = await modelRedTeam(
      [
        { n: "2", title: "A", body: BODY },
        { n: "3", title: "B", body: BODY },
      ],
      async (input) => {
        if (input.user.includes("chapter 2")) throw new Error("boom");
        return { text: JSON.stringify([{ category: "ambiguity", severity: "low", excerpt: "reached 120,000 farmers in 2024", note: "Year attribution is ambiguous between report and outreach." }]) };
      },
    );
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /2 crashed: boom/);
    assert.equal(res.findings.length, 1);
    assert.equal(res.findings[0].chapter, "3");
  });
});
