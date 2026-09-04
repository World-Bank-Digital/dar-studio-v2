import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import {
  SIMULATION_LABEL,
  SCENARIOS,
  SOURCE_IDENTITY_FILES,
  runWorkflowSimulation,
  sha256Json,
  simulationEnvironment,
  validateSimulationReport,
} from "./simulate-workflow.mjs";

const UPSTREAM_PRODUCTION_CODE_FILES = Object.freeze([
  "gauntlet/loop-1/research_pipeline/simulation.py",
  "gauntlet/loop-1/research_pipeline/simulate_workflow.py",
  "gauntlet/loop-1/research_pipeline/investment_options.py",
  "gauntlet/loop-1/research_pipeline/report_design.py",
  "gauntlet/loop-1/research_pipeline/generate_dar.py",
  "gauntlet/loop-1/research_pipeline/export_package.py",
  "gauntlet/loop-1/research_pipeline/run_workflow.py",
  "gauntlet/loop-1/research_pipeline/diagnostic_stage.py",
  "gauntlet/loop-1/research_pipeline/research_orchestrator.py",
  "gauntlet/loop-1/research_pipeline/automated_challenge.py",
  "gauntlet/loop-1/research_pipeline/diagnostic.py",
  "gauntlet/loop-1/research_pipeline/scan_stage.py",
  "gauntlet/loop-1/research_pipeline/prices.json",
  "gauntlet/loop-1/research_pipeline/scans.py",
  "gauntlet/loop-1/research_pipeline/ai_assessment.py",
  "gauntlet/loop-1/research_pipeline/foresight.py",
  "gauntlet/loop-1/research_pipeline/vendors.py",
  "gauntlet/loop-1/research_pipeline/workflow_inputs.py",
  "gauntlet/loop-1/research_pipeline/foresight_contract.py",
  "gauntlet/loop-1/research_pipeline/gates.py",
  "gauntlet/loop-1/research_pipeline/semantic_repair.py",
  "gauntlet/loop-1/research_pipeline/cell_schema.py",
  "gauntlet/loop-1/research_pipeline/nso_registry.py",
  "gauntlet/loop-1/research_pipeline/country_names.py",
  "gauntlet/loop-1/research_pipeline/countries.json",
  "gauntlet/loop-1/research_pipeline/nso_registry.json",
  "gauntlet/loop-1/engine_v17.py",
  "gauntlet/loop-1/build_inputs.py",
  "gauntlet/loop-1/build_workbook_v17.py",
  "gauntlet/loop-1/verify_workbook_parity.py",
  "gauntlet/loop-1/machine_pass.py",
  "gauntlet/loop-1/survey_pass.py",
  "gauntlet/loop-1/render_v17.py",
  "gauntlet/loop-1/definition_notes.json",
  "model/export_model.py",
  "model/reference_scorer.py",
  "model/DAMM-v1.7-model.json",
  "workflow/dar-workflow-v1.json",
]);

function report(overrides = {}) {
  const codeFiles = Object.fromEntries(
    UPSTREAM_PRODUCTION_CODE_FILES.map((relative) => [
      relative,
      createHash("sha256").update(relative).digest("hex"),
    ]),
  );
  const value = {
    schema_version: "damm.simulation-report/v1",
    label: SIMULATION_LABEL,
    execution_kind: "simulation",
    acceptance_eligible: false,
    scenario_id: "nigeria-stage6-overlength-v1",
    scenario_sha256: "a".repeat(64),
    code_identity: {
      schema_version: "damm.simulation-code-identity/v1",
      files: codeFiles,
      aggregate_sha256: sha256Json(codeFiles),
    },
    run_id: "sim-nigeria-stage6-overlength-v1-aaaaaaaaaaaa",
    vendor: "fixture/nigeria-stage6-overlength-v1",
    country: "Nigeria",
    iso3: "NGA",
    profile: "typical",
    harness_verdict: "pass",
    observed: {
      workflow_status: "complete",
      failed_stage: null,
      error_code: null,
      error_sha256: null,
    },
    external_spend_usd: 0,
    external_io: {
      network_calls: 0,
      database_writes: 0,
      capabilities_minted: 0,
      subprocess_calls: 0,
    },
    fixture_call_count: 13,
    stages: [],
    artifacts: [],
    assertions: [{ id: "expected_completion", ok: true }],
    ...overrides,
  };
  value.report_sha256 = sha256Json(value);
  return value;
}

function simulationSource(root) {
  const sourceRoot = join(root, "DAMM");
  const sourceFiles = Object.fromEntries(
    UPSTREAM_PRODUCTION_CODE_FILES.map((relative, index) => [
      relative,
      `# production identity fixture ${index + 1}: ${relative}\n`,
    ]),
  );
  const codeFiles = {};
  for (const [relative, contents] of Object.entries(sourceFiles)) {
    const path = join(sourceRoot, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, { mode: 0o600 });
    codeFiles[relative] = createHash("sha256").update(contents).digest("hex");
  }
  const codeIdentity = {
    schema_version: "damm.simulation-code-identity/v1",
    files: codeFiles,
    aggregate_sha256: sha256Json(codeFiles),
  };
  const scenarioDescriptor = {
    schema_version: "damm.simulation-scenario/v1",
    scenario_id: "nigeria-stage6-overlength-v1",
    default_country: "Nigeria",
    default_iso3: "NGA",
    default_profile: "typical",
    expected: { code_sha256: codeIdentity.aggregate_sha256 },
  };
  const scenarioContents = `${JSON.stringify(scenarioDescriptor)}\n`;
  const scenarioPath = join(
    sourceRoot,
    "gauntlet",
    "loop-1",
    "research_pipeline",
    "fixtures",
    "simulation",
    "nigeria-stage6-overlength-v1.json",
  );
  mkdirSync(dirname(scenarioPath), { recursive: true });
  writeFileSync(scenarioPath, scenarioContents, { mode: 0o600 });
  const scenarioSha256 = createHash("sha256").update(scenarioContents).digest("hex");
  const runIdentity = sha256Json({
    scenario_sha256: scenarioSha256,
    country: "Nigeria",
    iso3: "NGA",
    profile: "typical",
  });
  return {
    sourceRoot,
    codeIdentity,
    scenarioSha256,
    runId: `sim-nigeria-stage6-overlength-v1-${runIdentity.slice(0, 12)}`,
  };
}

describe("workflow simulation adapter", () => {
  it("exposes every committed production-path simulation scenario", () => {
    assert.deepEqual(SCENARIOS, [
      "nigeria-stage6-overlength-v1",
      "nigeria-stage6-through-package-v1",
      "eight-stage-happy-v1",
    ]);
  });

  it("mirrors the complete upstream production-code identity set", () => {
    assert.deepEqual([...SOURCE_IDENTITY_FILES].sort(), [...UPSTREAM_PRODUCTION_CODE_FILES].sort());
  });

  it("passes only a small allowlisted environment to the child", () => {
    const environment = simulationEnvironment(
      {
        PATH: "/safe/bin",
        LANG: "en_US.UTF-8",
        DATABASE_URL: "NEVER-PASS-DATABASE",
        ANTHROPIC_API_KEY: "NEVER-PASS-VENDOR",
        BETTER_AUTH_SECRET: "NEVER-PASS-AUTH",
        ARTIFACT_DELIVERY_SECRET: "NEVER-PASS-GATEWAY",
      },
      "/private/simulation",
    );

    assert.deepEqual(environment, {
      PATH: "/safe/bin",
      LANG: "en_US.UTF-8",
      HOME: "/private/simulation",
      TMPDIR: "/private/simulation/tmp",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      DAMM_SIMULATION: "1",
    });
    assert.doesNotMatch(JSON.stringify(environment), /NEVER-PASS/);
  });

  it("accepts a hash-bound, zero-spend, non-acceptance report", () => {
    const value = report();
    assert.equal(validateSimulationReport(value, "nigeria-stage6-overlength-v1"), value);
  });

  it("rejects spend, external I/O, acceptance eligibility, and report drift", () => {
    for (const value of [
      report({ external_spend_usd: 0.01 }),
      report({
        external_io: {
          network_calls: 1,
          database_writes: 0,
          capabilities_minted: 0,
          subprocess_calls: 0,
        },
      }),
      report({
        external_io: {
          network_calls: 0,
          database_writes: 0,
          capabilities_minted: 0,
          subprocess_calls: 1,
        },
      }),
      report({
        external_io: {
          network_calls: 0,
          database_writes: 0,
          capabilities_minted: 0,
          subprocess_calls: 0,
          vendor_calls: 1,
        },
      }),
      report({ acceptance_eligible: true }),
      { ...report(), country: "Changed after hashing" },
    ]) {
      assert.throws(
        () => validateSimulationReport(value, "nigeria-stage6-overlength-v1"),
        /simulation|external|acceptance|digest/i,
      );
    }
    assert.throws(
      () =>
        validateSimulationReport(report(), "nigeria-stage6-overlength-v1", {
          country: "Exampleland",
          iso3: "EXP",
          profile: "typical",
        }),
      /requested country/,
    );
  });

  it("runs only the committed entry point and verifies the emitted report", async () => {
    const root = await mkdtemp(join(tmpdir(), "dar-simulation-test-"));
    const source = simulationSource(root);
    let childEnvironment;

    const result = await runWorkflowSimulation(
      { scenarioId: "nigeria-stage6-overlength-v1" },
      {
        repositoryRoot: root,
        sourceRoot: source.sourceRoot,
        outputRoot: join(root, "reports"),
        parentEnvironment: {
          PATH: "/safe/bin",
          OPENAI_API_KEY: "NEVER-PASS-OPENAI",
          DATABASE_URL: "NEVER-PASS-DB",
        },
        python: "/safe/bin/python3",
        spawnSync(_command, args, options) {
          childEnvironment = options.env;
          const output = args[args.indexOf("--output") + 1];
          const value = report({
            scenario_sha256: source.scenarioSha256,
            code_identity: source.codeIdentity,
            run_id: source.runId,
          });
          writeFileSync(join(output, "simulation-report.json"), `${JSON.stringify(value)}\n`);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );

    assert.equal(result.report.harness_verdict, "pass");
    assert.equal(result.reportPath, join(result.outputDirectory, "simulation-report.json"));
    assert.doesNotMatch(JSON.stringify(childEnvironment), /NEVER-PASS/);

    const expected = {
      country: "Nigeria",
      iso3: "NGA",
      profile: "typical",
      scenarioSha256: source.scenarioSha256,
      codeIdentity: source.codeIdentity,
      runId: source.runId,
    };
    assert.throws(
      () =>
        validateSimulationReport(
          report({ scenario_sha256: source.scenarioSha256, run_id: source.runId }),
          "nigeria-stage6-overlength-v1",
          expected,
        ),
      /canonical DAMM source bytes/,
    );
    assert.throws(
      () =>
        validateSimulationReport(
          report({
            scenario_sha256: source.scenarioSha256,
            code_identity: source.codeIdentity,
          }),
          "nigeria-stage6-overlength-v1",
          expected,
        ),
      /run identity/,
    );
  });

  it("rejects symlinked output roots and report files", async () => {
    const root = await mkdtemp(join(tmpdir(), "dar-simulation-path-test-"));
    const source = simulationSource(root);
    const outside = join(root, "outside");
    mkdirSync(outside);
    const linkedOutput = join(root, "linked-reports");
    symlinkSync(outside, linkedOutput, "dir");

    await assert.rejects(
      runWorkflowSimulation(
        { scenarioId: "nigeria-stage6-overlength-v1" },
        { repositoryRoot: root, sourceRoot: source.sourceRoot, outputRoot: linkedOutput },
      ),
      /output root is not a real directory/,
    );

    const outsideReport = join(root, "outside-report.json");
    writeFileSync(outsideReport, `${JSON.stringify(report())}\n`);
    await assert.rejects(
      runWorkflowSimulation(
        { scenarioId: "nigeria-stage6-overlength-v1" },
        {
          repositoryRoot: root,
          sourceRoot: source.sourceRoot,
          outputRoot: join(root, "safe-reports"),
          spawnSync(_command, args) {
            const output = args[args.indexOf("--output") + 1];
            symlinkSync(outsideReport, join(output, "simulation-report.json"));
            return { status: 0, stdout: "", stderr: "" };
          },
        },
      ),
      /report is not a regular file/,
    );
  });
});
