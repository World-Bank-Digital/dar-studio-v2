import { it } from "node:test";
import assert from "node:assert/strict";
import { stageDownloads, finalDownloads } from "./download-catalog.ts";

it("keeps completed working papers available after a later failure without inventing converted formats", () => {
  const groups = stageDownloads(
    "run-a",
    "investment_options",
    [
      {
        artifactId: "a",
        stageId: "investment_options",
        key: "investment_options_report",
        filename: "report.html",
        byteSize: 1024,
      },
      {
        artifactId: "b",
        stageId: "investment_options",
        key: "cost_benefit_workbook",
        filename: "cost.xlsx",
        byteSize: 2048,
      },
    ],
    [],
  );
  assert.deepEqual(
    groups.primary.map((g) => g.title),
    ["Report", "Cost-benefit workbook"],
  );
  assert.equal(groups.primary[0].options.length, 1);
  assert.equal(groups.primary[0].options[0].format, "HTML");
  assert.match(groups.primary[0].options[0].href, /run-a\/artifact\?stageArtifact=a$/);
  assert.equal(groups.primary[0].options[0].byteSize, 1024);
});
it("uses only available exports from the selected run and separates technical files", () => {
  const groups = stageDownloads(
    "run-b",
    "strategic_foresight",
    [],
    [
      { key: "narrative-strategic_foresight-pdf", byteSize: 800 },
      { key: "data-strategic_foresight-stage_manifest-json", byteSize: 100 },
    ],
  );
  assert.equal(groups.primary[0].options[0].format, "PDF");
  assert.match(groups.primary[0].options[0].href, /run-b/);
  assert.equal(groups.technical.length, 1);
  assert.equal(groups.supporting.length, 0);
  assert.equal(finalDownloads("run-b", []).length, 0);
  assert.equal(
    finalDownloads("run-b", [
      { key: "bundle", byteSize: 900 },
      { key: "events", byteSize: 100 },
    ]).length,
    1,
  );
});

it("offers both stored source spreadsheet formats in the final document group", () => {
  const groups = finalDownloads("run-c", [
    { key: "sources-xlsx", byteSize: 1024 },
    { key: "sources-csv", byteSize: 512 },
  ]);
  assert.deepEqual(
    groups[0].options.map((option) => option.format),
    ["Excel", "CSV"],
  );
});
