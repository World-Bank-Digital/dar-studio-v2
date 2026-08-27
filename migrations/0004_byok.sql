-- Bring-your-own-key: multiple model providers plus separate web-search keys.
--
-- `kind` separates drafting credentials from retrieval credentials so a user can
-- run, say, Claude for prose and Exa for search. Provider ids never collide
-- across kinds, so the existing (user_id, provider) uniqueness still holds.
alter table api_keys add column if not exists kind text not null default 'llm';

-- Set when the stored value is an AES-GCM envelope rather than a raw key, so an
-- installation that adopts DAR_KEY_SECRET later can tell the two apart.
alter table api_keys add column if not exists encrypted boolean not null default false;

-- Optional operator-supplied name, e.g. "programme account" vs "personal".
alter table api_keys add column if not exists label text;

create index if not exists api_keys_user_kind_idx on api_keys (user_id, kind);

-- The search provider is chosen independently of the drafting model. Null means
-- no web search: the official statistical cascade still runs.
alter table user_settings add column if not exists active_search_provider text;
