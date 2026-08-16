import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deleteApiKey, getSettings, saveApiKey, saveSettings, testApiKey } from "@/lib/damm/actions";
import { ACTING_ROLES, useSessionRole } from "@/lib/session";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user } = useCurrentUserState();
  return <AppShell>{user ? <SettingsInner /> : <p className="text-sm text-muted">Sign in to manage keys and your acting role.</p>}</AppShell>;
}

function SettingsInner() {
  const { role, actorName, setRole, setActorName } = useSessionRole();
  const [platformXai, setPlatformXai] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [keys, setKeys] = useState<Array<{ id: string; provider: string; fingerprint: string; last4: string; model_name: string; last_test_ok: boolean | null }>>([]);
  const [provider, setProvider] = useState("xai");
  const [key, setKey] = useState("");
  const [modelName, setModelName] = useState("grok-4.5");
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const s = await getSettings();
    setPlatformXai(s.platformXai);
    setActive(s.activeProvider);
    setKeys(s.keys);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-muted">Acting role is recorded on every mutation. API keys stay on the server and are shown only as a fingerprint.</p>

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
        <h2 className="font-display text-xl">Drafting models</h2>
        <p className="mt-2 text-sm text-muted">
          Numbers are never invented by a language model. Official statistical APIs run first. An xAI key is then
          used only to search national statistics offices and official publications for remaining quantitative
          gaps, and to write connective prose over engine facts. Every accepted figure still needs a public
          source URL. Without a key the official cascade still runs and the assembler still drafts.
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
              await saveSettings({ data: { role, actorName, activeProvider: v } });
            }}
          >
            <option value="">Deterministic assembler only</option>
            {platformXai ? <option value="platform-xai">Platform xAI (grok-4.5)</option> : null}
            {keys.map((k) => (
              <option key={k.id} value={k.provider}>
                {k.provider} · {k.model_name} · …{k.last4}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <select className="h-11 rounded-sm border border-border bg-surface px-3 text-sm" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="xai">xAI</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <Input placeholder="Model id" value={modelName} onChange={(e) => setModelName(e.target.value)} />
          <Input type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </div>
        <Button
          className="mt-3"
          onClick={async () => {
            const res = await saveApiKey({ data: { provider, key, modelName } });
            setMsg(res.ok ? "Key stored. Only the fingerprint is kept in the interface." : res.error);
            setKey("");
            refresh();
          }}
        >
          Store key
        </Button>
        <ul className="mt-4 space-y-2 text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-moss/40 px-3 py-2">
              <span>
                {k.provider} · {k.model_name} · fingerprint {k.fingerprint} · …{k.last4}
                {k.last_test_ok === true ? " · tested" : k.last_test_ok === false ? " · test failed" : ""}
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const res = await testApiKey({ data: { id: k.id } });
                    setMsg(res.ok ? "Key and model accepted." : res.error);
                    refresh();
                  }}
                >
                  Test
                </Button>
                <Button size="sm" variant="ghost" onClick={async () => { await deleteApiKey({ data: { id: k.id } }); refresh(); }}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {msg ? <p className="mt-3 text-sm">{msg}</p> : null}
      </Card>
    </div>
  );
}
