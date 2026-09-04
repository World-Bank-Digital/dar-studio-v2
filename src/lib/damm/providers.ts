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

export type ModelListResult =
  | {
      ok: true;
      models: string[];
      /** False when the provider reported another page or the client bounded the list. */
      complete: boolean;
      /** True when valid entries were omitted by the local model-count bound. */
      truncated?: boolean;
      error?: never;
    }
  | {
      ok: false;
      error: string;
      models?: never;
      complete?: never;
      truncated?: never;
    };

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

/** Catalogue failures cross a credential boundary, so never reflect response bodies. */
function catalogueErrText(status: number): string {
  if (status === 401 || status === 403) return `Authentication failed (${status}). Check the key.`;
  if (status === 404) return "Provider catalogue endpoint not found (404).";
  if (status === 429) return "Rate limited (429). The provider is throttling this key.";
  if (status >= 500) return `Provider catalogue error ${status}. Try again shortly.`;
  return `Provider catalogue returned ${status}.`;
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
      redirect: "error",
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
    const res = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await boundedResponseText(res, 1_000_000);
    if (!res.ok) return { ok: false, error: catalogueErrText(res.status) };
    try {
      return { ok: true, json: JSON.parse(body) };
    } catch {
      return { ok: false, error: "Provider catalogue returned malformed data." };
    }
  } catch (err) {
    return { ok: false, error: failure(err) };
  }
}

/** Read an untrusted catalogue response without buffering an unbounded body. */
async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(
      `Provider catalogue response exceeded ${maxBytes.toLocaleString("en-US")} bytes.`,
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `Provider catalogue response exceeded ${maxBytes.toLocaleString("en-US")} bytes.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
      .map((c) =>
        c && typeof c === "object" && typeof (c as { text?: string }).text === "string"
          ? (c as { text: string }).text
          : "",
      )
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
  const text = parts
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("");
  return text || null;
}

/** `{ data: [{ id }] }` — the OpenAI model-list convention. */
export function openAiModelIds(json: unknown): string[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const id = (entry as { id?: unknown }).id;
    return typeof id === "string" && id ? [id] : [];
  });
}

/** `{ models: [{ name: "models/gemini-..." }] }` — Gemini strips the prefix. */
export function geminiModelIds(json: unknown): string[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const models = (json as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const model = entry as { name?: unknown; supportedGenerationMethods?: unknown };
    if (typeof model.name !== "string" || !model.name) return [];
    if (
      Array.isArray(model.supportedGenerationMethods) &&
      !model.supportedGenerationMethods.includes("generateContent")
    ) {
      return [];
    }
    return [model.name.replace(/^models\//, "")];
  });
}

function objectBody(json: unknown): Record<string, unknown> {
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : {};
}

const NON_TEXT_MODEL_MARKERS = [
  "image",
  "vision",
  "tts",
  "audio",
  "speech",
  "embed",
  "moderation",
  "whisper",
  "dall",
  "sora",
  "veo",
  "imagen",
  "lyria",
  "banana",
  "realtime",
  "live",
  "transcribe",
  "computer-use",
  "robotics",
  "customtools",
  "translate",
] as const;

const MAX_SELECTABLE_MODELS = 500;

function normaliseSelectableModels(models: readonly string[]): {
  models: string[];
  truncated: boolean;
} {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const candidate of models) {
    const model = candidate.trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model) ||
      NON_TEXT_MODEL_MARKERS.some((marker) => model.toLowerCase().includes(marker)) ||
      seen.has(model)
    ) {
      continue;
    }
    if (selected.length === MAX_SELECTABLE_MODELS) {
      return { models: selected, truncated: true };
    }
    seen.add(model);
    selected.push(model);
  }
  return { models: selected, truncated: false };
}

/**
 * Reduce a credential-scoped provider response to model ids safe to render in
 * the text-drafting selector. Provider order is retained because several
 * catalogues put their current models first; duplicates and obviously
 * non-text modalities are removed, and the client response is bounded.
 */
export function selectableModelIds(models: readonly string[]): string[] {
  return normaliseSelectableModels(models).models;
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
    const body = objectBody(res.json);
    return {
      ok: true,
      models: openAiModelIds(body),
      complete: body.has_more !== true,
    };
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
    const res = await getJson("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${key}`,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: openAiModelIds(res.json), complete: true };
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
    const res = await getJson(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      {
        "x-goog-api-key": key,
      },
    );
    if (!res.ok) return { ok: false, error: res.error };
    const body = objectBody(res.json);
    return {
      ok: true,
      models: geminiModelIds(body),
      complete: typeof body.nextPageToken !== "string" || !body.nextPageToken.trim(),
    };
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
    return { ok: true, models: openAiModelIds(res.json), complete: true };
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
    const res = await getJson("https://openrouter.ai/api/v1/models", {
      Authorization: `Bearer ${key}`,
    });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, models: openAiModelIds(res.json), complete: true };
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
 * Refresh the credential-scoped drafting catalogue without exposing the key to
 * the caller. This metadata request never sends a prompt or invokes the chat
 * interface; provider authentication and response parsing stay in the adapter.
 */
export async function refreshModelCatalogue(id: string, key: string): Promise<ModelListResult> {
  const def = providerDef(id);
  if (!def) return { ok: false, error: `Unknown provider “${id}”.` };
  let result: ModelListResult;
  try {
    result = await def.listModels(key);
  } catch {
    return { ok: false, error: "The provider catalogue could not be read safely." };
  }
  if (!result.ok) return result;
  const normalised = normaliseSelectableModels(result.models ?? []);
  const models = normalised.models;
  if (!models.length) {
    return {
      ok: false,
      error: `${def.label} returned no valid provider-listed drafting candidates for this key.`,
    };
  }
  const truncated = result.truncated === true || normalised.truncated;
  return {
    ok: true,
    models,
    complete: result.complete === true && !truncated,
    truncated,
  };
}

/** Re-fetch and require positive catalogue membership before storing a model id. */
export async function verifySelectableModel(
  id: string,
  key: string,
  requestedModel: string,
): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  const def = providerDef(id);
  if (!def) return { ok: false, error: `Unknown provider “${id}”.` };
  const model = requestedModel.trim();
  if (selectableModelIds([model])[0] !== model) {
    return { ok: false, error: "Select a valid drafting-model identifier." };
  }
  const catalogue = await refreshModelCatalogue(id, key);
  if (!catalogue.ok) {
    return { ok: false, error: catalogue.error ?? "The provider catalogue could not be read." };
  }
  if (!catalogue.models?.includes(model)) {
    if (catalogue.complete === false) {
      return {
        ok: false,
        error: `The refreshed provider catalogue was partial, so “${model}” could not be verified. Refresh and try again.`,
      };
    }
    if (!def.modelListIsAuthoritative) {
      return {
        ok: false,
        error: `“${model}” was not present in ${def.label}'s catalogue, so it could not be verified for this key.`,
      };
    }
    return {
      ok: false,
      error: `“${model}” is not available to this key in the refreshed provider catalogue.`,
    };
  }
  return { ok: true, model };
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
    return {
      ok: true,
      warning: `Key accepted. “${modelName}” was not in the catalogue, which is expected for ${def.label}.`,
    };
  }
  return {
    ok: true,
    warning: `Key accepted, but “${modelName}” was not in ${def.label}'s model list. Drafting will fail unless the id is corrected.`,
  };
}
