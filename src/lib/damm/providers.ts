/**
 * Bring-your-own-key model providers.
 *
 * Every provider is reached through the same three operations — `chat`,
 * `listModels`, `verify` — so the rest of the app never branches on vendor.
 * Adding a provider means adding one entry here, not editing call sites.
 *
 * Failures are returned, never swallowed. A wrong key, a rate limit and a
 * timeout must be distinguishable in the interface, because the fallback path
 * (deterministic assembly) looks identical to success from the outside.
 */

export type ProviderId = "anthropic" | "openai" | "gemini" | "xai" | "openrouter";

export const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "gemini", "xai", "openrouter"];

export interface ChatInput {
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /**
   * Ask the provider to suppress ("none") or minimise ("low") chain-of-thought.
   * Extraction calls set this: a reasoning model spends its budget thinking and
   * then returns defensively — 119 documents produced 3 candidate readings in a
   * live run. Only adapters with a documented control honour the hint
   * (OpenRouter's unified `reasoning` parameter); the rest ignore it, which is
   * safe because the hint is an economy measure, not a correctness gate.
   */
  reasoning?: "none" | "low";
}

export interface ChatResult {
  text: string | null;
  error?: string;
}

export interface ModelListResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  /** Shown as the placeholder and used when the operator leaves the field blank. */
  defaultModel: string;
  /** Where the user gets a key. Rendered as help text, never fetched. */
  consoleUrl: string;
  /**
   * Some gateways expose thousands of models; listing them is still useful for
   * a spelling check but must not be treated as an allow-list.
   */
  modelListIsAuthoritative: boolean;
  chat(input: ChatInput): Promise<ChatResult>;
  listModels(key: string): Promise<ModelListResult>;
}

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_TOKENS = 4000;

function errText(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 300);
  if (status === 401 || status === 403) return `Authentication failed (${status}). Check the key.`;
  if (status === 404) return `Model or endpoint not found (404). Check the model id. ${trimmed}`;
  if (status === 429) return "Rate limited (429). The provider is throttling this key.";
  if (status >= 500) return `Provider error ${status}. Try again shortly.`;
  return `Provider returned ${status}${trimmed ? `: ${trimmed}` : ""}`;
}

function failure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort|timeout/i.test(msg)) return "The request timed out before the provider replied.";
  return msg;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: errText(res.status, await res.text().catch(() => "")) };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, error: failure(err) };
  }
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 20_000,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: errText(res.status, await res.text().catch(() => "")) };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, error: failure(err) };
  }
}

/* ---------- shared response shapes ---------- */

/**
 * Explain an empty completion. Reasoning models (DeepSeek, o-series) spend the
 * token budget on internal reasoning first; when it runs out, the API returns
 * 200 with `finish_reason: "length"` and empty visible content. Treated as
 * success-with-no-text, that failure is invisible — a full live drafting pass
 * once produced zero prose with zero errors this way.
 */
export function describeEmptyCompletion(json: unknown): string {
  const body = json as {
    choices?: Array<{ finish_reason?: string; message?: { reasoning?: unknown } }>;
    usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const finish = body.choices?.[0]?.finish_reason;
  const reasoning = body.usage?.completion_tokens_details?.reasoning_tokens;
  if (finish === "length" && reasoning) {
    return `The model spent the whole token budget on reasoning (${reasoning} tokens) and returned no visible text. Raise max tokens or use a non-reasoning model.`;
  }
  if (finish === "length") return "The completion hit the token limit before producing text.";
  return `The model returned no text (finish reason: ${finish ?? "unknown"}).`;
}

/** OpenAI-compatible `choices[0].message.content`. Used by OpenAI, xAI, OpenRouter. */
export function openAiText(json: unknown): string | null {
  const body = json as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim() ? content : null;
  // Some gateways return the content as an array of parts.
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (c && typeof c === "object" && typeof (c as { text?: string }).text === "string" ? (c as { text: string }).text : ""))
      .filter(Boolean);
    if (parts.length) return parts.join("");
  }
  return null;
}

/** Anthropic `content[]` blocks, concatenating every text block. */
export function anthropicText(json: unknown): string | null {
  const body = json as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(body.content)) return null;
  const parts = body.content.filter((b) => typeof b.text === "string").map((b) => b.text as string);
  return parts.length ? parts.join("") : null;
}

/** Gemini `candidates[0].content.parts[].text`. */
export function geminiText(json: unknown): string | null {
  const body = json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = body.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => p.text ?? "").filter(Boolean).join("");
  return text || null;
}

/** `{ data: [{ id }] }` — the OpenAI model-list convention. */
export function openAiModelIds(json: unknown): string[] {
  const body = json as { data?: Array<{ id?: unknown }> };
  if (!Array.isArray(body.data)) return [];
  return body.data.map((m) => String(m.id ?? "")).filter(Boolean);
}

/** `{ models: [{ name: "models/gemini-..." }] }` — Gemini strips the prefix. */
export function geminiModelIds(json: unknown): string[] {
  const body = json as { models?: Array<{ name?: unknown }> };
  if (!Array.isArray(body.models)) return [];
  return body.models.map((m) => String(m.name ?? "").replace(/^models\//, "")).filter(Boolean);
}

/* ---------- adapters ---------- */

const anthropic: ProviderDef = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  defaultModel: "claude-sonnet-5",
  consoleUrl: "https://console.anthropic.com/settings/keys",
  modelListIsAuthoritative: true,
  async chat(input) {
    const res = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": input.key, "anthropic-version": "2023-06-01" },
      {
        model: input.model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? 0.2,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      },
      input.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    if (!res.ok) return { text: null, error: res.error };
    return { text: anthropicText(res.json) };
  },
  async listModels(key) {
    const res = await getJson("https://api.anthropic.com/v1/models?limit=1000", {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: openAiModelIds(res.json) };
  },
};

const openai: ProviderDef = {
  id: "openai",
  label: "OpenAI (GPT)",
  defaultModel: "gpt-5",
  consoleUrl: "https://platform.openai.com/api-keys",
  modelListIsAuthoritative: true,
  async chat(input) {
    const res = await postJson(
      "https://api.openai.com/v1/chat/completions",
      { Authorization: `Bearer ${input.key}` },
      {
        model: input.model,
        max_completion_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      },
      input.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    if (!res.ok) return { text: null, error: res.error };
    const text = openAiText(res.json);
    if (!text) return { text: null, error: describeEmptyCompletion(res.json) };
    return { text };
  },
  async listModels(key) {
    const res = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: openAiModelIds(res.json) };
  },
};

const gemini: ProviderDef = {
  id: "gemini",
  label: "Google (Gemini)",
  defaultModel: "gemini-2.5-pro",
  consoleUrl: "https://aistudio.google.com/apikey",
  modelListIsAuthoritative: true,
  async chat(input) {
    const res = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      { "x-goog-api-key": input.key },
      {
        system_instruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          maxOutputTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: input.temperature ?? 0.2,
        },
      },
      input.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    if (!res.ok) return { text: null, error: res.error };
    return { text: geminiText(res.json) };
  },
  async listModels(key) {
    const res = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      "x-goog-api-key": key,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: geminiModelIds(res.json) };
  },
};

const xai: ProviderDef = {
  id: "xai",
  label: "xAI (Grok)",
  defaultModel: "grok-4.5",
  consoleUrl: "https://console.x.ai",
  modelListIsAuthoritative: true,
  async chat(input) {
    const res = await postJson(
      "https://api.x.ai/v1/chat/completions",
      { Authorization: `Bearer ${input.key}` },
      {
        model: input.model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? 0.2,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      },
      input.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    if (!res.ok) return { text: null, error: res.error };
    const text = openAiText(res.json);
    if (!text) return { text: null, error: describeEmptyCompletion(res.json) };
    return { text };
  },
  async listModels(key) {
    const res = await getJson("https://api.x.ai/v1/models", { Authorization: `Bearer ${key}` });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: openAiModelIds(res.json) };
  },
};

const openrouter: ProviderDef = {
  id: "openrouter",
  label: "OpenRouter",
  defaultModel: "anthropic/claude-sonnet-5",
  consoleUrl: "https://openrouter.ai/keys",
  // OpenRouter proxies hundreds of models and adds new ones continuously;
  // absence from the list is not proof a model id is wrong.
  modelListIsAuthoritative: false,
  async chat(input) {
    const res = await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        Authorization: `Bearer ${input.key}`,
        "X-Title": "DAR Studio",
      },
      {
        model: input.model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: input.temperature ?? 0.2,
        // OpenRouter's unified reasoning control. `enabled: false` turns
        // thinking off on hybrid models (DeepSeek v3.1+); a model that cannot
        // comply errors back, and the call site retries without the hint.
        ...(input.reasoning === "none"
          ? { reasoning: { enabled: false } }
          : input.reasoning === "low"
            ? { reasoning: { effort: "low" } }
            : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      },
      input.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    if (!res.ok) return { text: null, error: res.error };
    const text = openAiText(res.json);
    if (!text) return { text: null, error: describeEmptyCompletion(res.json) };
    return { text };
  },
  async listModels(key) {
    const res = await getJson("https://openrouter.ai/api/v1/models", { Authorization: `Bearer ${key}` });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: openAiModelIds(res.json) };
  },
};

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic,
  openai,
  gemini,
  xai,
  openrouter,
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

export function providerDef(id: string): ProviderDef | null {
  return isProviderId(id) ? PROVIDERS[id] : null;
}

export function defaultModelFor(id: string): string {
  return providerDef(id)?.defaultModel ?? "";
}

/**
 * Check a key, and the model id against it. A model missing from an
 * authoritative list is reported as a warning rather than a hard failure so a
 * newly released model id is never rejected outright.
 */
export async function verifyProviderKey(
  id: string,
  key: string,
  modelName: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const def = providerDef(id);
  if (!def) return { ok: false, error: `Unknown provider “${id}”.` };
  const list = await def.listModels(key);
  if (!list.ok) return { ok: false, error: list.error };
  if (!modelName) return { ok: true };
  const known = list.models?.includes(modelName) ?? false;
  if (known) return { ok: true };
  if (!def.modelListIsAuthoritative) {
    return { ok: true, warning: `Key accepted. “${modelName}” was not in the catalogue, which is expected for ${def.label}.` };
  }
  return {
    ok: true,
    warning: `Key accepted, but “${modelName}” was not in ${def.label}'s model list. Drafting will fail unless the id is corrected.`,
  };
}
