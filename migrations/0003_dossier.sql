create table if not exists dossier (
  id text primary key,
  user_id text not null,
  country_id text not null references countries(id) on delete cascade,
  title text not null,
  summary text not null,
  year int,
  source_name text not null,
  source_url text not null,
  host text,
  source_class text not null,
  informs text not null,
  related_indicator text,
  score int not null,
  grade text not null,
  quote text,
  collected_at timestamptz not null default now(),
  unique (country_id, source_url)
);

create index if not exists dossier_country_idx on dossier (country_id, score desc);
