/**
 * Persistence for pipeline runs. Thin by design: every rule that matters lives in
 * `runs.ts` where it can be tested without a database, and this file only moves rows.
 *
 * The one piece of logic that has to be here is the claim, because it must be atomic.
 * Two workers reading "is this claimable?" and then both writing "mine" would spend the
 * same country budget twice, so the read and the write are a single conditional update
 * and the loser gets no row back.
 */
import { getSql } from "../db.ts";
import { uid } from "../utils.ts";

import { CLAIM_LEASE_MS, type Run, type RunPass, type RunStatus } from "./runs.ts";

interface RunRow {
  id: string;
  user_id: string;
  country_id: string | null;
  country_name: string;
  iso3: string;
  pass: string;
  status: string;
  ceiling_usd: number;
  spent_usd: number;
  rows_total: number | null;
  rows_done: number;
  vendor: string | null;
  out_basename: string;
  claimed_by: string | null;
  heartbeat_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  stopped_reason: string | null;
}

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    userId: r.user_id,
    countryId: r.country_id,
    countryName: r.country_name,
    iso3: r.iso3,
    pass: r.pass as RunPass,
    status: r.status as RunStatus,
    // Postgres numerics arrive as strings through some drivers; a silent string here
    // would make every budget comparison a lexicographic one.
    ceilingUsd: Number(r.ceiling_usd),
    spentUsd: Number(r.spent_usd),
    rowsTotal: r.rows_total,
    rowsDone: r.rows_done,
    vendor: r.vendor,
    outBasename: r.out_basename,
    claimedBy: r.claimed_by,
    heartbeatAt: r.heartbeat_at ? new Date(r.heartbeat_at) : null,
    startedAt: r.started_at ? new Date(r.started_at) : null,
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
    stoppedReason: r.stopped_reason,
  };
}

export async function createRun(input: {
  userId: string;
  countryId: string | null;
  countryName: string;
  iso3: string;
  pass: RunPass;
  ceilingUsd: number;
  vendor?: string | null;
  outBasename: string;
}): Promise<Run> {
  const sql = await getSql();
  const id = uid();
  const rows = await sql<RunRow>`
    insert into runs (id, user_id, country_id, country_name, iso3, pass,
                      ceiling_usd, vendor, out_basename)
    values (${id}, ${input.userId}, ${input.countryId}, ${input.countryName},
            ${input.iso3}, ${input.pass}, ${input.ceilingUsd},
            ${input.vendor ?? null}, ${input.outBasename})
    returning *`;
  return toRun(rows[0]);
}

export async function getRun(id: string): Promise<Run | null> {
  const sql = await getSql();
  const rows = await sql<RunRow>`select * from runs where id = ${id}`;
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRuns(userId: string, limit = 50): Promise<Run[]> {
  const sql = await getSql();
  const rows = await sql<RunRow>`
    select * from runs where user_id = ${userId}
    order by created_at desc limit ${limit}`;
  return rows.map(toRun);
}

/**
 * Take the oldest claimable run, atomically.
 *
 * Claimable means queued, or running with a heartbeat older than the lease — a worker
 * that died. The `where` clause re-checks both conditions inside the update, so the
 * decision and the write cannot be separated by another worker.
 */
export async function claimNextRun(workerId: string): Promise<Run | null> {
  const sql = await getSql();
  const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS);
  const rows = await sql<RunRow>`
    update runs set
      status = 'running',
      claimed_by = ${workerId},
      heartbeat_at = now(),
      started_at = coalesce(started_at, now()),
      updated_at = now()
    where id = (
      select id from runs
      where status = 'queued'
         or (status = 'running'
             and (heartbeat_at is null or heartbeat_at < ${staleBefore}))
      order by created_at
      limit 1
      for update skip locked
    )
    returning *`;
  return rows[0] ? toRun(rows[0]) : null;
}

/** Say the worker is still alive. Returns false if the claim was taken from it. */
export async function heartbeat(runId: string, workerId: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update runs set heartbeat_at = now(), updated_at = now()
    where id = ${runId} and claimed_by = ${workerId} and status = 'running'
    returning id`;
  return rows.length > 0;
}

/** Progress from a row event. Spend is cumulative, so it is set rather than added. */
export async function recordRow(
  runId: string,
  e: { indicatorId: string; rowsDone: number; rowsTotal: number; spentUsd: number; outcome: string },
): Promise<void> {
  const sql = await getSql();
  await sql`
    update runs set rows_done = ${e.rowsDone}, rows_total = ${e.rowsTotal},
                    spent_usd = ${e.spentUsd}, heartbeat_at = now(), updated_at = now()
    where id = ${runId}`;
  await sql`
    insert into run_events (run_id, kind, indicator_id, message, payload)
    values (${runId}, 'row', ${e.indicatorId}, ${e.outcome},
            ${JSON.stringify({ rowsDone: e.rowsDone, rowsTotal: e.rowsTotal, spentUsd: e.spentUsd })})`;
}

export async function setRowsTotal(runId: string, rowsTotal: number, vendor: string | null) {
  const sql = await getSql();
  await sql`
    update runs set rows_total = ${rowsTotal},
                    vendor = coalesce(${vendor}, vendor), updated_at = now()
    where id = ${runId}`;
}

export async function noteEvent(runId: string, kind: string, message: string) {
  const sql = await getSql();
  await sql`insert into run_events (run_id, kind, message) values (${runId}, ${kind}, ${message})`;
}

/**
 * End a run. `spentUsd` comes from the pipeline's own ledger file when it can be read,
 * because stdout is for liveness and the ledger is the source of record.
 */
export async function finishRun(
  runId: string,
  status: RunStatus,
  reason: string,
  spentUsd?: number,
): Promise<void> {
  const sql = await getSql();
  await sql`
    update runs set status = ${status},
                    stopped_reason = ${reason || null},
                    spent_usd = coalesce(${spentUsd ?? null}, spent_usd),
                    finished_at = now(),
                    claimed_by = null,
                    updated_at = now()
    where id = ${runId}`;
  await sql`
    insert into run_events (run_id, kind, message) values (${runId}, 'status', ${status + (reason ? `: ${reason}` : "")})`;
}

/** Change status without ending the run — pause, cancel, or re-queue after a top-up. */
export async function setStatus(
  runId: string,
  status: RunStatus,
  opts: { ceilingUsd?: number; reason?: string } = {},
): Promise<void> {
  const sql = await getSql();
  await sql`
    update runs set status = ${status},
                    ceiling_usd = coalesce(${opts.ceilingUsd ?? null}, ceiling_usd),
                    stopped_reason = ${opts.reason ?? null},
                    claimed_by = case when ${status} = 'queued' then null else claimed_by end,
                    finished_at = null,
                    updated_at = now()
    where id = ${runId}`;
  await sql`
    insert into run_events (run_id, kind, message) values (${runId}, 'status', ${status})`;
}

export interface RunEventRow {
  id: number;
  at: Date;
  kind: string;
  indicatorId: string | null;
  message: string | null;
}

export async function listEvents(runId: string, sinceId = 0, limit = 200): Promise<RunEventRow[]> {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    at: Date;
    kind: string;
    indicator_id: string | null;
    message: string | null;
  }>`
    select id, at, kind, indicator_id, message from run_events
    where run_id = ${runId} and id > ${sinceId}
    order by id limit ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    at: new Date(r.at),
    kind: r.kind,
    indicatorId: r.indicator_id,
    message: r.message,
  }));
}

/** The run holding a country's place for a pass, if one is queued, running or paused. */
export async function findActiveRun(countryId: string, pass: RunPass): Promise<Run | null> {
  const sql = await getSql();
  const rows = await sql<RunRow>`
    select * from runs
    where country_id = ${countryId} and pass = ${pass}
      and status in ('queued', 'running', 'paused')
    order by created_at desc limit 1`;
  return rows[0] ? toRun(rows[0]) : null;
}

/**
 * The country's most recent research pass that produced output. Later passes read its
 * files, so its basename is what they must be given.
 */
export async function latestCompletedResearch(countryId: string): Promise<Run | null> {
  const sql = await getSql();
  const rows = await sql<RunRow>`
    select * from runs
    where country_id = ${countryId} and pass = 'research' and status = 'done'
    order by finished_at desc nulls last, created_at desc limit 1`;
  return rows[0] ? toRun(rows[0]) : null;
}
