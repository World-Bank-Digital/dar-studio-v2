-- Team BYOK keys: entered by an admin (DAR_ADMIN_EMAILS), used by every team
-- member as the fallback when no personal key of that kind exists. Encrypted
-- with the same master secret as personal keys; the key value never reaches a
-- non-admin, only its existence and last4.
create table if not exists team_keys (
  id text primary key,
  kind text not null,
  provider text not null,
  key_value text not null,
  fingerprint text not null,
  last4 text not null,
  model_name text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (kind, provider)
);

-- Red-team QC findings over an assembled draft. Adversarial review output:
-- category, severity, the offending excerpt and the reviewer's note. Findings
-- inform the human editor; nothing here edits the draft.
create table if not exists review_findings (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  chapter text not null,
  category text not null,
  severity text not null,
  excerpt text not null,
  note text not null,
  source text not null default 'deterministic',
  created_at timestamptz not null default now()
);
create index if not exists review_findings_country_idx on review_findings(country_id);
