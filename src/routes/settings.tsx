import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deleteApiKey, getSettings, listProviders, saveApiKey, saveSettings, testApiKey, saveTeamKey, deleteTeamKey } from "@/lib/damm-v17/actions";
import { ACTING_ROLES, useSessionRole } from "@/lib/session";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user } = useCurrentUserState();
  return <AppShell>{user ? <SettingsInner /> : <p className="text-sm text-muted">Sign in to manage keys and your acting role.</p>}</AppShell>;
}

type StoredKey = {
  id: string;
  provider: string;
  kind: string;
  fingerprint: string;
  last4: string;
  model_name: string;
  encrypted: boolean;
  last_test_ok: boolean | null;
};

type ProviderOption = { id: string; label: string; defaultModel?: string; consoleUrl: string };

function SettingsInner() {
  const { role, actorName, setRole, setActorName } = useSessionRole();
  const [platformXai, setPlatformXai] = useState(false);
  const [encryptionOn, setEncryptionOn] = useState(true);
  const [plaintextCount, setPlaintextCount] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [modelProviders, setModelProviders] = useState<ProviderOption[]>([]);
  const [searchProviders, setSearchProviders] = useState<ProviderOption[]>([]);

  const [provider, setProvider] = useState("anthropic");
  const [key, setKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [searchProvider, setSearchProvider] = useState("exa");
  const [searchKey, setSearchKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [teamKeys, setTeamKeys] = useState<TeamKey[]>([]);

  async function refresh() {
    const s = await getSettings();
    setPlatformXai(s.platformXai);
    setEncryptionOn(s.encryptionAvailable);
    setPlaintextCount(s.plaintextKeyCount);
    setActive(s.activeProvider);
    setActiveSearch(s.activeSearchProvider);
    setKeys(s.keys as StoredKey[]);
    setIsAdmin(Boolean(s.isTeamAdmin));
    setTeamKeys((s.teamKeys ?? []) as TeamKey[]);
  }

  useEffect(() => {
    listProviders()
      .then((p) => {
        setModelProviders(p.models);
        setSearchProviders(p.search);
        // Follow the catalogue rather than hard-coding a default in two places.
        if (p.models[0]) {
          setProvider(p.models[0].id);
          setModelName(p.models[0].defaultModel ?? "");
        }
        if (p.search[0]) setSearchProvider(p.search[0].id);
      })
      .catch(() => undefined);
    refresh().catch(() => undefined);
  }, []);

  const modelKeys = keys.filter((k) => k.kind !== "search");
  const searchKeys = keys.filter((k) => k.kind === "search");
  const chosenProvider = modelProviders.find((p) => p.id === provider);
  const chosenSearch = searchProviders.find((p) => p.id === searchProvider);

  async function persistActive(next: { activeProvider?: string | null; activeSearchProvider?: string | null }) {
    await saveSettings({ data: { role, actorName, ...next } });
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-muted">
        Acting role is recorded on every mutation. API keys stay on the server and are shown only as a fingerprint.
      </p>

      {!encryptionOn ? (
        <p className="mt-4 rounded-sm border border-clay bg-clay/10 px-3 py-2 text-sm">
          <strong>Keys are being stored unencrypted.</strong> Set <code>DAR_KEY_SECRET</code> in the environment and
          re-save each key to protect them at rest.
        </p>
      ) : plaintextCount > 0 ? (
        <p className="mt-4 rounded-sm border border-clay bg-clay/10 px-3 py-2 text-sm">
          {plaintextCount} key{plaintextCount === 1 ? "" : "s"} predate encryption and are still stored in the clear.
          Re-save {plaintextCount === 1 ? "it" : "them"} below to encrypt.
        </p>
      ) : null}

      <Card className="mt-6">
        <h2 className="font-display text-xl">Identity</h2>
        <label className="mt-4 block text-sm">
          Display name
          <Input className="mt-1" value={actorName} onChange={(e) => setActorName(e.target.value)} />
        </label>
        <label className="mt-3 block text-sm">
          Acting role
          <select className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-3" value={role} onChange={(e) => setRole(e.target.value)}>
            {ACTING_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </Card>

      <Card className="mt-4">
        <h2 className="font-display text-xl">Drafting model</h2>
        <p className="mt-2 text-sm text-muted">
          Numbers are never invented by a language model. Official statistical APIs run first, then verified web
          search. The model writes connective prose over engine facts only, and any prose containing a figure the
          evidence base does not hold is rejected and discarded. Without a key the deterministic assembler still
          drafts.
        </p>
        {platformXai ? <p className="mt-2 text-sm">A platform xAI key is available in this environment.</p> : null}

        <label className="mt-3 block text-sm">
          Active drafter
          <select
            className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-3"
            value={active ?? ""}
            onChange={async (e) => {
              const v = e.target.value || null;
              setActive(v);
              await persistActive({ activeProvider: v });
            }}
          >
            <option value="">Deterministic assembler only</option>
            {platformXai ? <option value="platform-xai">Platform xAI (grok-4.5)</option> : null}
            {modelKeys.map((k) => (
              <option key={k.id} value={k.provider}>
                {modelProviders.find((p) => p.id === k.provider)?.label ?? k.provider} · {k.model_name} · …{k.last4}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <select
            className="h-11 rounded-sm border border-border bg-surface px-3 text-sm"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModelName(modelProviders.find((p) => p.id === e.target.value)?.defaultModel ?? "");
            }}
          >
            {modelProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <Input placeholder="Model id" value={modelName} onChange={(e) => setModelName(e.target.value)} />
          <Input type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </div>
        {chosenProvider ? (
          <p className="mt-2 text-xs text-muted">
            Get a key at{" "}
            <a className="text-sage underline" href={chosenProvider.consoleUrl} target="_blank" rel="noreferrer">
              {chosenProvider.consoleUrl}
            </a>
            . The model id is editable — Test checks it against the provider's catalogue.
          </p>
        ) : null}
        <Button
          className="mt-3"
          onClick={async () => {
            const res = await saveApiKey({ data: { provider, key, modelName, kind: "llm" } });
            setMsg(res.ok ? (res.warning ?? "Key stored. Only the fingerprint is kept in the interface.") : res.error);
            setKey("");
            refresh();
          }}
        >
          Store model key
        </Button>

        <KeyList keys={modelKeys} labelFor={(id) => modelProviders.find((p) => p.id === id)?.label ?? id} onChange={refresh} setMsg={setMsg} />
      </Card>

      <Card className="mt-4">
        <h2 className="font-display text-xl">Web search</h2>
        <p className="mt-2 text-sm text-muted">
          A search key lets the studio fetch the actual page behind a statistic, so an extracted figure can be checked
          against the source text before it enters the evidence base. Readings that cannot be located on the page are
          dropped and logged, never downgraded. Without a search key the official statistical cascade still runs and
          the remaining gaps stay named.
        </p>

        <label className="mt-3 block text-sm">
          Active search provider
          <select
            className="mt-1 h-11 w-full rounded-sm border border-border bg-surface px-3"
            value={activeSearch ?? ""}
            onChange={async (e) => {
              const v = e.target.value || null;
              setActiveSearch(v);
              await persistActive({ activeSearchProvider: v });
            }}
          >
            <option value="">No web search</option>
            {searchKeys.map((k) => (
              <option key={k.id} value={k.provider}>
                {searchProviders.find((p) => p.id === k.provider)?.label ?? k.provider} · …{k.last4}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <select
            className="h-11 rounded-sm border border-border bg-surface px-3 text-sm"
            value={searchProvider}
            onChange={(e) => setSearchProvider(e.target.value)}
          >
            {searchProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <Input
            type="password"
            placeholder="Search API key"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        {chosenSearch ? (
          <p className="mt-2 text-xs text-muted">
            Get a key at{" "}
            <a className="text-sage underline" href={chosenSearch.consoleUrl} target="_blank" rel="noreferrer">
              {chosenSearch.consoleUrl}
            </a>
            .
          </p>
        ) : null}
        <Button
          className="mt-3"
          onClick={async () => {
            const res = await saveApiKey({ data: { provider: searchProvider, key: searchKey, kind: "search" } });
            setMsg(res.ok ? (res.warning ?? "Search key stored.") : res.error);
            setSearchKey("");
            refresh();
          }}
        >
          Store search key
        </Button>

        <KeyList keys={searchKeys} labelFor={(id) => searchProviders.find((p) => p.id === id)?.label ?? id} onChange={refresh} setMsg={setMsg} />
      </Card>

      <TeamKeysCard
        isAdmin={isAdmin}
        teamKeys={teamKeys}
        modelProviders={modelProviders}
        searchProviders={searchProviders}
        onChange={refresh}
        setMsg={setMsg}
      />

      <PasskeysCard setMsg={setMsg} />

      {msg ? <p className="mt-3 text-sm">{msg}</p> : null}
    </div>
  );
}

type TeamKey = { id: string; provider: string; kind: string; last4: string; model_name: string; created_at: string };

/**
 * Admin-managed keys the whole team inherits. A member with a personal key
 * keeps using it; anyone without one falls back to these. Only identity is
 * ever shown — the key material stays on the server.
 */
function TeamKeysCard({
  isAdmin,
  teamKeys,
  modelProviders,
  searchProviders,
  onChange,
  setMsg,
}: {
  isAdmin: boolean;
  teamKeys: TeamKey[];
  modelProviders: ProviderOption[];
  searchProviders: ProviderOption[];
  onChange: () => Promise<void> | void;
  setMsg: (m: string | null) => void;
}) {
  const [kind, setKind] = useState<"llm" | "search">("llm");
  const [provider, setProvider] = useState("openrouter");
  const [keyValue, setKeyValue] = useState("");
  const [modelName, setModelName] = useState("");
  const options = kind === "llm" ? modelProviders : searchProviders;

  return (
    <Card className="mt-4">
      <h2 className="font-display text-xl">Team keys</h2>
      <p className="mt-2 text-sm text-muted">
        Keys an administrator stores for the whole team. Your personal keys above always win; when you hold no
        personal key of a kind, the pipeline runs on the team key instead.
        {isAdmin ? " You are an administrator and can manage them here." : " Administrators are configured by the operator (DAR_ADMIN_EMAILS)."}
      </p>

      {teamKeys.length ? (
        <ul className="mt-3 space-y-2">
          {teamKeys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 px-4 py-2 text-sm">
              <span>
                {(k.kind === "search" ? searchProviders : modelProviders).find((p) => p.id === k.provider)?.label ?? k.provider}
                {" · "}
                {k.kind === "search" ? "web search" : k.model_name} · …{k.last4}
              </span>
              {isAdmin ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const res = await deleteTeamKey({ data: { id: k.id } });
                    setMsg(res.ok ? "Team key removed." : res.error);
                    await onChange();
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-subtle">No team keys stored.</p>
      )}

      {isAdmin ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <select
              className="h-11 rounded-sm border border-border bg-surface px-3 text-sm"
              value={kind}
              onChange={(e) => {
                const next = e.target.value === "search" ? "search" : "llm";
                setKind(next);
                const first = (next === "llm" ? modelProviders : searchProviders)[0];
                if (first) {
                  setProvider(first.id);
                  setModelName(next === "llm" ? ((first as ProviderOption & { defaultModel?: string }).defaultModel ?? "") : "");
                }
              }}
            >
              <option value="llm">Model</option>
              <option value="search">Web search</option>
            </select>
            <select
              className="h-11 rounded-sm border border-border bg-surface px-3 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {kind === "llm" ? (
              <Input placeholder="Model id" value={modelName} onChange={(e) => setModelName(e.target.value)} />
            ) : (
              <span />
            )}
            <Input type="password" placeholder="API key" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} autoComplete="off" />
          </div>
          <Button
            className="mt-3"
            onClick={async () => {
              const res = await saveTeamKey({ data: { provider, key: keyValue, modelName, kind } });
              setMsg(res.ok ? (res.warning ?? "Team key stored for everyone.") : res.error);
              setKeyValue("");
              await onChange();
            }}
          >
            Store team key
          </Button>
        </>
      ) : null}
    </Card>
  );
}

function PasskeysCard({ setMsg }: { setMsg: (m: string | null) => void }) {
  const [keys, setKeys] = useState<Array<{ id: string; name?: string | null; deviceType?: string; createdAt?: string | Date }>>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await authClient.passkey.listUserPasskeys();
    if (!res.error) setKeys((res.data ?? []) as typeof keys);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  return (
    <Card className="mt-4">
      <h2 className="font-display text-xl">Passkeys</h2>
      <p className="mt-2 text-sm text-muted">
        A passkey signs you in with this device's screen lock or security key — no password typed, nothing
        phishable. Passkeys are scoped to the site they were registered on: one registered here on localhost will
        not follow the app to a deployed domain.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Input placeholder="Passkey name (e.g. this laptop)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const res = await authClient.passkey.addPasskey({ name: label.trim() || undefined });
              if (res?.error) throw new Error(res.error.message ?? "Registration failed");
              setMsg("Passkey registered.");
              setLabel("");
              await refresh();
            } catch (err) {
              setMsg(err instanceof Error ? err.message : "Passkey registration failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          Register a passkey
        </Button>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-moss/40 px-3 py-2">
            <span>
              {k.name || "Unnamed passkey"}
              {k.deviceType ? ` · ${k.deviceType}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await authClient.passkey.deletePasskey({ id: k.id });
                refresh();
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {keys.length === 0 ? <p className="mt-3 text-xs text-subtle">No passkeys registered yet.</p> : null}
    </Card>
  );
}

function KeyList({
  keys,
  labelFor,
  onChange,
  setMsg,
}: {
  keys: StoredKey[];
  labelFor: (providerId: string) => string;
  onChange: () => void;
  setMsg: (m: string | null) => void;
}) {
  if (!keys.length) return null;
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {keys.map((k) => (
        <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-moss/40 px-3 py-2">
          <span>
            {labelFor(k.provider)}
            {k.model_name ? ` · ${k.model_name}` : ""} · fingerprint {k.fingerprint} · …{k.last4}
            {k.encrypted ? " · encrypted" : " · stored in the clear"}
            {k.last_test_ok === true ? " · tested" : k.last_test_ok === false ? " · test failed" : ""}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setMsg("Testing…");
                const res = await testApiKey({ data: { id: k.id } });
                setMsg(res.ok ? (res.warning ?? "Key and model accepted.") : res.error);
                onChange();
              }}
            >
              Test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await deleteApiKey({ data: { id: k.id } });
                onChange();
              }}
            >
              Remove
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
