-- Passkey (WebAuthn) credentials for the @better-auth/passkey plugin.
--
-- Column names are camelCase and double-quoted to match the Better Auth
-- convention established in 0001_auth.sql — the plugin queries them by exact
-- case. Field list mirrors the plugin's own schema declaration
-- (@better-auth/passkey dist schema: name, publicKey, userId, credentialID,
-- counter, deviceType, backedUp, transports, createdAt, aaguid).
create table if not exists "passkey" (
  "id" text not null primary key,
  "name" text,
  "publicKey" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "credentialID" text not null,
  "counter" integer not null,
  "deviceType" text not null,
  "backedUp" boolean not null,
  "transports" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP,
  "aaguid" text
);

create index if not exists "passkey_userId_idx" on "passkey" ("userId");
create index if not exists "passkey_credentialID_idx" on "passkey" ("credentialID");
