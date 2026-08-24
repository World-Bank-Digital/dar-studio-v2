-- Durable pipeline runs (design decision G1).
--
-- The v1.5 arrangement kept run state in columns on `countries` and drove it with an
-- in-process lock and tick-polling. It was fragile and lost work on restart, and the
-- v1.7 migration dropped those columns. This replaces it with a claimable queue.
--
-- Durability is a division of labour, not a duplication. The Python pipeline already
-- checkpoints its own work per row, so a resumed run picks up where it stopped without
-- this table knowing anything about indicators. What lives here is what the app must
-- survive a restart to know: what was asked for, who claimed it, how far it got, what it
-- has spent, and why it stopped. A worker that dies leaves a stale heartbeat, and the
-- claim can be taken again.

create table if not exists runs (
  id text primary key,
  user_id text not null,
  country_id text references countries(id) on delete cascade,
  -- Kept beside the FK so a run stays readable after its country is deleted, and so the
  -- worker can invoke the pipeline without a second query.
  country_name text not null,
  iso3 text not null,

  -- 'research' (the 57-row first pass) or 'g2' (the second review). Named for the
  -- pipeline's own budget passes so the allocation applies without translation.
  pass text not null,

  -- queued   nothing has claimed it
  -- running  a worker holds the claim and is heartbeating
  -- paused   a person stopped it; resumable
  -- exhausted the pass hit its budget allocation and stopped itself (G2). NOT a failure:
  --          the run reports what it has and waits for a person to add budget. This is
  --          distinct from 'failed' precisely because a budget-induced gap must never be
  --          indistinguishable from a real one.
  -- failed   an error the worker could not retry past
  -- done     every row researched and the engine input written
  -- cancelled abandoned by a person
  status text not null default 'queued',

  ceiling_usd double precision not null,
  spent_usd double precision not null default 0,

  rows_total int,
  rows_done int not null default 0,

  vendor text,
  -- The pipeline's --out basename. The state and spend files it checkpoints to are
  -- derived from this, which is what makes a resume possible.
  out_basename text not null,

  claimed_by text,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  -- Why it stopped, in the operator's words. Always set when status is failed or
  -- exhausted, so a stopped run never has to be explained by inference.
  stopped_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runs_user_idx on runs (user_id, created_at desc);
create index if not exists runs_country_idx on runs (country_id);
-- The claim query: oldest queued run first, and stale claims reclaimable.
create index if not exists runs_claimable_idx on runs (status, heartbeat_at);

-- Append-only. The run row carries the current state; this carries how it got there, so
-- a spend figure or a stopped run can always be traced to the event that produced it.
create table if not exists run_events (
  id bigserial primary key,
  run_id text not null references runs(id) on delete cascade,
  at timestamptz not null default now(),
  -- row | spend | status | note
  kind text not null,
  indicator_id text,
  message text,
  payload jsonb
);

create index if not exists run_events_run_idx on run_events (run_id, id);
