import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_IDS,
  anthropicText,
  defaultModelFor,
  geminiModelIds,
  geminiText,
  isProviderId,
  openAiModelIds,
  openAiText,
  providerDef,
  refreshModelCatalogue,
  selectableModelIds,
  verifySelectableModel,
} from "./providers.ts";

describe("provider catalogue", () => {
  it("offers every provider the studio claims to support", () => {
    assert.deepEqual(PROVIDER_IDS.slice().sort(), [
      "anthropic",
      "gemini",
      "openai",
      "openrouter",
      "xai",
    ]);
  });

  it("gives each provider a default model and a console link", () => {
    for (const id of PROVIDER_IDS) {
      const def = providerDef(id);
      assert.ok(def, `${id} is missing`);
      assert.ok(def.defaultModel.length > 0, `${id} has no default model`);
      assert.match(def.consoleUrl, /^https:\/\//, `${id} console url`);
    }
  });

  it("rejects an unknown provider id rather than guessing", () => {
    assert.equal(isProviderId("mistral"), false);
    assert.equal(providerDef("mistral"), null);
    assert.equal(defaultModelFor("mistral"), "");
  });

  it("turns a live provider catalogue into a bounded text-model selector", () => {
    assert.deepEqual(
      selectableModelIds([
        " claude-opus-5 ",
        "claude-opus-5",
        "text-embedding-3-large",
        "gpt-image-1",
        "gpt-5.6-terra",
        "",
      ]),
      ["claude-opus-5", "gpt-5.6-terra"],
    );

    const oversized = Array.from({ length: 600 }, (_, index) => `text-model-${index}`);
    const bounded = selectableModelIds(oversized);
    assert.equal(bounded.length, 500);
    assert.equal(bounded[0], "text-model-0");
    assert.equal(bounded[499], "text-model-499");
  });

  it("rejects malformed model identifiers before they reach a selector or provider", () => {
    assert.deepEqual(
      selectableModelIds([
        "gpt-5.6-terra",
        "contains whitespace",
        "contains\nnewline",
        "x".repeat(201),
        "anthropic/claude-sonnet-5",
      ]),
      ["gpt-5.6-terra", "anthropic/claude-sonnet-5"],
    );
  });

  it("refreshes the selectable catalogue with the key kept inside the provider adapter", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), "https://api.openai.com/v1/models");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer sk-private");
      assert.equal(init?.redirect, "error");
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-5.6-terra" }, { id: "text-embedding-3-large" }, { id: "gpt-5.6-luna" }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      assert.deepEqual(await refreshModelCatalogue("openai", "sk-private"), {
        ok: true,
        models: ["gpt-5.6-terra", "gpt-5.6-luna"],
        complete: true,
        truncated: false,
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("bounds untrusted provider catalogue bodies before parsing them", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("x".repeat(1_000_001), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      const result = await refreshModelCatalogue("openai", "sk-private");
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /catalogue response exceeded 1,000,000 bytes/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("never reflects authenticated catalogue response bodies to the browser", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("credential=sk-private; tenant=confidential", { status: 400 })) as typeof fetch;
    try {
      const result = await refreshModelCatalogue("openai", "sk-private");
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /provider catalogue returned 400/i);
      assert.doesNotMatch(result.error ?? "", /sk-private|confidential|credential|tenant/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("never reflects malformed successful catalogue bodies to the browser", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('credential="sk-private-confidential"', { status: 200 })) as typeof fetch;
    try {
      const result = await refreshModelCatalogue("openai", "sk-private");
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /catalogue returned malformed data/i);
      assert.doesNotMatch(result.error ?? "", /sk-private|confidential|credential/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("returns a controlled result for malformed catalogue shapes and entries", async () => {
    const original = globalThis.fetch;
    const bodies: unknown[] = [null, { data: [null, { id: "gpt-5.6-terra" }] }];
    let index = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(bodies[index++]), { status: 200 })) as typeof fetch;
    try {
      const malformedBody = await refreshModelCatalogue("openai", "sk-private");
      assert.equal(malformedBody.ok, false);
      assert.match(malformedBody.error ?? "", /no valid provider-listed drafting candidates/i);

      assert.deepEqual(await refreshModelCatalogue("openai", "sk-private"), {
        ok: true,
        models: ["gpt-5.6-terra"],
        complete: true,
        truncated: false,
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reports provider pagination and selector truncation instead of claiming completeness", async () => {
    const original = globalThis.fetch;
    const ids = Array.from({ length: 501 }, (_, index) => ({ id: `text-model-${index}` }));
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: ids, has_more: true }), { status: 200 })) as typeof fetch;
    try {
      const result = await refreshModelCatalogue("anthropic", "sk-private");
      assert.equal(result.ok, true);
      assert.equal(result.models?.length, 500);
      assert.equal(result.complete, false);
      assert.equal(result.truncated, true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("fails closed when a provider catalogue has no selectable drafting model", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "text-embedding-3-large" }] }), {
        status: 200,
      })) as typeof fetch;
    try {
      const result = await refreshModelCatalogue("openai", "sk-private");
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /no valid provider-listed drafting candidates/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("re-reads the provider catalogue before accepting an exact model selection", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5.6-terra" }, { id: "gpt-image-1" }] }), {
        status: 200,
      })) as typeof fetch;
    try {
      assert.deepEqual(await verifySelectableModel("openai", "sk-private", "gpt-5.6-terra"), {
        ok: true,
        model: "gpt-5.6-terra",
      });
      const missing = await verifySelectableModel("openai", "sk-private", "gpt-5.6-sol");
      assert.equal(missing.ok, false);
      assert.match(missing.error ?? "", /not available.*this key/i);
      const wrongModality = await verifySelectableModel("openai", "sk-private", "gpt-image-1");
      assert.equal(wrongModality.ok, false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("fails closed without making an absent-model claim when the catalogue is partial", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5" }], has_more: true }), {
        status: 200,
      })) as typeof fetch;
    try {
      const missing = await verifySelectableModel("anthropic", "sk-private", "claude-opus-5");
      assert.equal(missing.ok, false);
      assert.match(missing.error ?? "", /partial.*could not be verified/i);
      assert.doesNotMatch(missing.error ?? "", /not available/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not make a negative availability claim from a non-authoritative catalogue", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-5" }] }), {
        status: 200,
      })) as typeof fetch;
    try {
      const missing = await verifySelectableModel(
        "openrouter",
        "sk-private",
        "openai/gpt-5.6-terra",
      );
      assert.equal(missing.ok, false);
      assert.match(missing.error ?? "", /not present.*could not be verified/i);
      assert.doesNotMatch(missing.error ?? "", /not available/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("response parsing", () => {
  it("reads OpenAI-shaped content, string or parts", () => {
    assert.equal(openAiText({ choices: [{ message: { content: "hello" } }] }), "hello");
    assert.equal(
      openAiText({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }),
      "ab",
    );
    assert.equal(openAiText({ choices: [] }), null);
  });

  it("concatenates every Anthropic text block, not just the first", () => {
    assert.equal(
      anthropicText({
        content: [
          { type: "text", text: "one " },
          { type: "text", text: "two" },
        ],
      }),
      "one two",
    );
    assert.equal(anthropicText({ content: [] }), null);
  });

  it("reads Gemini candidate parts", () => {
    assert.equal(
      geminiText({ candidates: [{ content: { parts: [{ text: "x" }, { text: "y" }] } }] }),
      "xy",
    );
    assert.equal(geminiText({ candidates: [] }), null);
  });

  it("normalises model listings across the two conventions", () => {
    assert.deepEqual(openAiModelIds({ data: [{ id: "gpt-5" }, { id: "o4" }] }), ["gpt-5", "o4"]);
    assert.deepEqual(geminiModelIds({ models: [{ name: "models/gemini-2.5-pro" }] }), [
      "gemini-2.5-pro",
    ]);
    assert.deepEqual(openAiModelIds({}), []);
    assert.deepEqual(geminiModelIds({}), []);
  });
});

describe("empty completions (LEARNINGS L14)", () => {
  it("treats an empty string as no text, not as prose", () => {
    assert.equal(openAiText({ choices: [{ message: { content: "" } }] }), null);
    assert.equal(openAiText({ choices: [{ message: { content: "  " } }] }), null);
  });

  it("explains a budget exhausted by reasoning", async () => {
    const { describeEmptyCompletion } = await import("./providers.ts");
    const msg = describeEmptyCompletion({
      choices: [{ finish_reason: "length", message: { content: "", reasoning: "…" } }],
      usage: { completion_tokens_details: { reasoning_tokens: 4000 } },
    });
    assert.match(msg, /reasoning \(4000 tokens\)/);
    assert.match(msg, /Raise max tokens/);
  });

  it("still explains a plain truncation", async () => {
    const { describeEmptyCompletion } = await import("./providers.ts");
    assert.match(
      describeEmptyCompletion({ choices: [{ finish_reason: "length" }] }),
      /token limit/,
    );
  });
});

describe("openrouter reasoning control (round-3)", () => {
  it("maps the hint to the unified reasoning parameter and omits it by default", async () => {
    const { PROVIDERS } = await import("./providers.ts");
    const original = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      await PROVIDERS.openrouter.chat({
        key: "k",
        model: "m",
        system: "s",
        user: "u",
        reasoning: "none",
      });
      await PROVIDERS.openrouter.chat({
        key: "k",
        model: "m",
        system: "s",
        user: "u",
        reasoning: "low",
      });
      await PROVIDERS.openrouter.chat({ key: "k", model: "m", system: "s", user: "u" });
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(
      bodies[0].reasoning,
      { enabled: false },
      "extraction calls switch thinking off",
    );
    assert.deepEqual(bodies[1].reasoning, { effort: "low" });
    assert.ok(!("reasoning" in bodies[2]), "prose calls keep the provider default");
  });
});
