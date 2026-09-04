#!/usr/bin/env node

/**
 * Run a committed, zero-spend DAMM simulation without loading DAR Studio secrets.
 *
 * This is deliberately a thin adapter. The upstream DAMM simulation module owns
 * scenario validation, workflow execution, fixtures, and the report contract.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SIMULATION_LABEL = "SIMULATED — NOT ACCEPTANCE EVIDENCE";
export const SCENARIOS = Object.freeze([
  "nigeria-stage6-overlength-v1",
  "nigeria-stage6-through-package-v1",
  "eight-stage-happy-v1",
]);
export const PROFILES = Object.freeze(["minimal", "typical", "dense"]);

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PIPELINE_RELATIVE = join("gauntlet", "loop-1", "research_pipeline", "simulate_workflow.py");
const SAFE_PARENT_ENV = Object.freeze(["PATH", "LANG", "LC_ALL", "TZ"]);
export const SOURCE_IDENTITY_FILES = Object.freeze([
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

function plainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Json(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/** Build a child environment by allowlist; never spread the parent environment. */
export function simulationEnvironment(parent, scratchRoot) {
  const environment = {};
  for (const key of SAFE_PARENT_ENV) {
    if (typeof parent[key] === "string" && parent[key]) environment[key] = parent[key];
  }
  return {
    ...environment,
    HOME: scratchRoot,
    TMPDIR: join(scratchRoot, "tmp"),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    DAMM_SIMULATION: "1",
  };
}

function contained(root, candidate) {
  const relative = candidate.slice(root.length);
  return candidate === root || (candidate.startsWith(root) && relative.startsWith(sep));
}

function secureDirectory(root, candidate, description) {
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`The ${description} is not a real directory.`);
  }
  const canonicalRoot = realpathSync(root);
  const canonicalCandidate = realpathSync(candidate);
  if (!contained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`The ${description} escapes its allowed root.`);
  }
  return canonicalCandidate;
}

function secureFile(root, candidate, description) {
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`The ${description} is not a regular source file.`);
  }
  const canonicalRoot = realpathSync(root);
  const canonicalCandidate = realpathSync(candidate);
  if (!contained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`The ${description} escapes its source repository.`);
  }
  return canonicalCandidate;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceContract(sourceRoot, scenario) {
  const files = {};
  for (const relative of SOURCE_IDENTITY_FILES) {
    files[relative] = sha256File(secureFile(sourceRoot, join(sourceRoot, relative), relative));
  }
  const codeIdentity = {
    schema_version: "damm.simulation-code-identity/v1",
    files,
    aggregate_sha256: sha256Json(files),
  };
  const scenarioPath = secureFile(
    sourceRoot,
    join(
      sourceRoot,
      "gauntlet",
      "loop-1",
      "research_pipeline",
      "fixtures",
      "simulation",
      `${scenario}.json`,
    ),
    "simulation scenario",
  );
  const scenarioBytes = readFileSync(scenarioPath);
  const descriptor = JSON.parse(scenarioBytes.toString("utf8"));
  if (
    plainObject(descriptor) === null ||
    descriptor.schema_version !== "damm.simulation-scenario/v1" ||
    descriptor.scenario_id !== scenario
  ) {
    throw new Error("The committed simulation scenario has the wrong identity.");
  }
  if (plainObject(descriptor.expected)?.code_sha256 !== codeIdentity.aggregate_sha256) {
    throw new Error("The committed scenario is not pinned to the canonical DAMM source bytes.");
  }
  return {
    codeIdentity,
    scenarioSha256: createHash("sha256").update(scenarioBytes).digest("hex"),
    country: optionalCountry(descriptor.default_country),
    iso3: optionalIso3(descriptor.default_iso3),
    profile: optionalProfile(descriptor.default_profile),
  };
}

function simulationProgram(sourceRoot) {
  const root = realpathSync(sourceRoot);
  const script = join(root, PIPELINE_RELATIVE);
  const stat = lstatSync(script);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("The DAMM simulation entry point is not a regular source file.");
  }
  const canonicalScript = realpathSync(script);
  if (!contained(root, canonicalScript)) {
    throw new Error("The DAMM simulation entry point escapes its source repository.");
  }
  return { root, script: canonicalScript };
}

function resolveSourceRoot(parent, repositoryRoot) {
  const configured = parent.DAMM_SIMULATION_SOURCE;
  if (configured) return isAbsolute(configured) ? configured : resolve(repositoryRoot, configured);
  return resolve(repositoryRoot, "..", "DAMM-foresight-candidate-register");
}

function requireScenario(value) {
  if (!SCENARIOS.includes(value)) {
    throw new Error(`Unknown simulation scenario ${JSON.stringify(value)}.`);
  }
  return value;
}

function optionalCountry(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) throw new Error("Invalid simulation country.");
  return normalized;
}

function optionalIso3(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("Simulation ISO must be three letters.");
  return normalized;
}

function optionalProfile(value) {
  if (value === undefined) return undefined;
  if (!PROFILES.includes(value))
    throw new Error(`Unknown simulation profile ${JSON.stringify(value)}.`);
  return value;
}

export function validateSimulationReport(value, expectedScenario, expectedLaunch = {}) {
  const report = plainObject(value);
  if (!report) throw new Error("The simulation report is not an object.");
  if (report.schema_version !== "damm.simulation-report/v1") {
    throw new Error("The simulation report has the wrong schema version.");
  }
  if (
    report.label !== SIMULATION_LABEL ||
    report.execution_kind !== "simulation" ||
    report.acceptance_eligible !== false
  ) {
    throw new Error("The result is not marked as non-acceptance simulation evidence.");
  }
  if (report.scenario_id !== expectedScenario) {
    throw new Error("The simulation report identifies another scenario.");
  }
  if (report.vendor !== `fixture/${expectedScenario}`) {
    throw new Error("The simulation report does not use its reserved fixture vendor identity.");
  }
  if (
    typeof report.country !== "string" ||
    !report.country.trim() ||
    !/^[A-Z]{3}$/.test(String(report.iso3 ?? "")) ||
    !PROFILES.includes(report.profile)
  ) {
    throw new Error("The simulation report has an invalid launch identity.");
  }
  for (const key of ["country", "iso3", "profile"]) {
    if (expectedLaunch[key] !== undefined && report[key] !== expectedLaunch[key]) {
      throw new Error(`The simulation report does not match the requested ${key}.`);
    }
  }
  if (!/^sim-[a-z0-9-]+$/.test(String(report.run_id ?? ""))) {
    throw new Error("The simulation report does not use a reserved sim- run identity.");
  }
  if (expectedLaunch.runId !== undefined && report.run_id !== expectedLaunch.runId) {
    throw new Error("The simulation report run identity does not match its launch inputs.");
  }
  if (!/^[a-f0-9]{64}$/.test(String(report.scenario_sha256 ?? ""))) {
    throw new Error("The simulation report has no valid scenario digest.");
  }
  if (
    expectedLaunch.scenarioSha256 !== undefined &&
    report.scenario_sha256 !== expectedLaunch.scenarioSha256
  ) {
    throw new Error("The simulation report does not match the committed scenario bytes.");
  }
  const codeIdentity = plainObject(report.code_identity);
  const codeFiles = plainObject(codeIdentity?.files);
  const expectedCodeFiles = [...SOURCE_IDENTITY_FILES].sort();
  if (
    !codeIdentity ||
    codeIdentity.schema_version !== "damm.simulation-code-identity/v1" ||
    !codeFiles ||
    Object.keys(codeFiles).sort().join("\n") !== expectedCodeFiles.join("\n") ||
    !expectedCodeFiles.every((name) => /^[a-f0-9]{64}$/.test(String(codeFiles[name] ?? ""))) ||
    !/^[a-f0-9]{64}$/.test(String(codeIdentity.aggregate_sha256 ?? "")) ||
    sha256Json(codeFiles) !== codeIdentity.aggregate_sha256
  ) {
    throw new Error("The simulation report has no valid production-code identity.");
  }
  if (
    expectedLaunch.codeIdentity !== undefined &&
    stableJson(codeIdentity) !== stableJson(expectedLaunch.codeIdentity)
  ) {
    throw new Error("The simulation report does not match the canonical DAMM source bytes.");
  }
  if (report.external_spend_usd !== 0) {
    throw new Error("A simulation reported nonzero external spend.");
  }
  const external = plainObject(report.external_io);
  const expectedExternalFields = [
    "capabilities_minted",
    "database_writes",
    "network_calls",
    "subprocess_calls",
  ];
  if (
    !external ||
    Object.keys(external).sort().join("\n") !== expectedExternalFields.join("\n") ||
    external.network_calls !== 0 ||
    external.database_writes !== 0 ||
    external.capabilities_minted !== 0 ||
    external.subprocess_calls !== 0
  ) {
    throw new Error("A simulation reported external I/O.");
  }
  if (report.harness_verdict !== "pass") {
    throw new Error("The simulation did not match its committed expectation.");
  }
  const declared = String(report.report_sha256 ?? "");
  const hashInput = { ...report };
  delete hashInput.report_sha256;
  if (!/^[a-f0-9]{64}$/.test(declared) || sha256Json(hashInput) !== declared) {
    throw new Error("The simulation report digest does not match its content.");
  }
  return report;
}

/**
 * Execute one upstream scenario through a secret-free child and verify its report.
 * Callers choose only a committed scenario and optional synthetic workload identity.
 */
export async function runWorkflowSimulation(
  { scenarioId, country, iso3, profile } = {},
  dependencies = {},
) {
  const scenario = requireScenario(scenarioId);
  const normalizedCountry = optionalCountry(country);
  const normalizedIso3 = optionalIso3(iso3);
  const normalizedProfile = optionalProfile(profile);
  if ((normalizedCountry === undefined) !== (normalizedIso3 === undefined)) {
    throw new Error("Simulation country and ISO must be supplied together.");
  }

  const repositoryRoot = dependencies.repositoryRoot ?? ROOT;
  const parentEnvironment = dependencies.parentEnvironment ?? process.env;
  const sourceRoot =
    dependencies.sourceRoot ?? resolveSourceRoot(parentEnvironment, repositoryRoot);
  const { root: canonicalSource, script } = simulationProgram(sourceRoot);
  const contract = sourceContract(canonicalSource, scenario);
  const expectedCountry = normalizedCountry ?? contract.country;
  const expectedIso3 = normalizedIso3 ?? contract.iso3;
  const expectedProfile = normalizedProfile ?? contract.profile;
  const runIdentity = sha256Json({
    scenario_sha256: contract.scenarioSha256,
    country: expectedCountry,
    iso3: expectedIso3,
    profile: expectedProfile,
  });
  const expectedRunId = `sim-${scenario.slice(0, 32)}-${runIdentity.slice(0, 12)}`;
  const outputRoot = resolve(dependencies.outputRoot ?? join(repositoryRoot, ".simulation"));
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const canonicalOutputRoot = secureDirectory(repositoryRoot, outputRoot, "simulation output root");
  const outputDirectory = await mkdtemp(join(canonicalOutputRoot, `${scenario}-`));
  secureDirectory(canonicalOutputRoot, outputDirectory, "simulation output directory");
  const scratchRoot = await mkdtemp(join(tmpdir(), "dar-simulation-"));
  await mkdir(join(scratchRoot, "tmp"), { recursive: true, mode: 0o700 });

  const args = ["-B", script, "--scenario", scenario, "--output", outputDirectory];
  if (normalizedCountry) args.push("--country", normalizedCountry, "--iso", normalizedIso3);
  if (normalizedProfile) args.push("--profile", normalizedProfile);
  const python = dependencies.python ?? parentEnvironment.DAMM_PIPELINE_PYTHON ?? "python3";
  const spawn = dependencies.spawnSync ?? spawnSync;
  const completed = spawn(python, args, {
    cwd: join(canonicalSource, "gauntlet", "loop-1", "research_pipeline"),
    env: simulationEnvironment(parentEnvironment, scratchRoot),
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (completed.error) throw completed.error;

  const reportPath = join(outputDirectory, "simulation-report.json");
  let parsed;
  try {
    const currentOutputRoot = secureDirectory(repositoryRoot, outputRoot, "simulation output root");
    const currentOutputDirectory = secureDirectory(
      currentOutputRoot,
      outputDirectory,
      "simulation output directory",
    );
    const reportStat = lstatSync(reportPath);
    if (!reportStat.isFile() || reportStat.isSymbolicLink()) {
      throw new Error("The simulation report is not a regular file.");
    }
    const canonicalReport = realpathSync(reportPath);
    if (!contained(currentOutputDirectory, canonicalReport)) {
      throw new Error("The simulation report escapes its output directory.");
    }
    parsed = JSON.parse(readFileSync(canonicalReport, "utf8"));
  } catch (error) {
    const detail = String(completed.stderr || completed.stdout || "")
      .trim()
      .slice(-1200);
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The simulation did not produce a readable report. ${cause}${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
  const report = validateSimulationReport(parsed, scenario, {
    country: expectedCountry,
    iso3: expectedIso3,
    profile: expectedProfile,
    scenarioSha256: contract.scenarioSha256,
    codeIdentity: contract.codeIdentity,
    runId: expectedRunId,
  });
  if (completed.status !== 0) {
    throw new Error(`The simulation harness exited ${completed.status}.`);
  }
  return { report, reportPath, outputDirectory };
}

function usage() {
  return [
    "Usage: node scripts/simulate-workflow.mjs --scenario SCENARIO [options]",
    "",
    `Scenarios: ${SCENARIOS.join(", ")}`,
    "Options: --country NAME --iso ISO3 --profile minimal|typical|dense",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    if (flag === "--scenario") options.scenarioId = value;
    else if (flag === "--country") options.country = value;
    else if (flag === "--iso") options.iso3 = value;
    else if (flag === "--profile") options.profile = value;
    else throw new Error(`Unknown simulation option ${flag}.`);
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const { report, reportPath } = await runWorkflowSimulation(options);
  console.log(SIMULATION_LABEL);
  console.log(
    `${report.scenario_id}: ${report.observed.workflow_status}; ` +
      `${report.fixture_call_count} fixture calls; $0.00 external spend.`,
  );
  console.log(`Report: ${reportPath}`);
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error) => {
    console.error(`Simulation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
