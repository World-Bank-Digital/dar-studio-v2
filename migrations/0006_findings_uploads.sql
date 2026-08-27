-- Findings: cited, quote-verified data points collected OUTSIDE the DAMM
-- indicator structure. kind 'opportunistic' = wide-net country evidence;
-- kind 'practice' = recent strategies and best practices (may be foreign).
-- Findings inform the roadmap draft; they never populate indicators.
create table if not exists findings (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  kind text not null,
  claim text not null,
  quote text not null,
  source_name text,
  source_url text not null,
  published_year integer,
  credibility text,
  pillar_hint text,
  created_at timestamptz not null default now()
);
create index if not exists findings_country_idx on findings(country_id, kind);

-- Uploads: user-provided material (strategic foresight first), stored as
-- extracted text so the draft can cite it as a user-provided source.
create table if not exists uploads (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  filename text not null,
  kind text not null default 'foresight',
  mime text,
  chars integer not null,
  content text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists uploads_country_idx on uploads(country_id);
