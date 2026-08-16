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
} from "./providers.ts";

describe("provider catalogue", () => {
  it("offers every provider the studio claims to support", () => {
    assert.deepEqual(PROVIDER_IDS.slice().sort(), ["anthropic", "gemini", "openai", "openrouter", "xai"]);
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
});

describe("response parsing", () => {
  it("reads OpenAI-shaped content, string or parts", () => {
    assert.equal(openAiText({ choices: [{ message: { content: "hello" } }] }), "hello");
    assert.equal(openAiText({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }), "ab");
    assert.equal(openAiText({ choices: [] }), null);
  });

  it("concatenates every Anthropic text block, not just the first", () => {
    assert.equal(
      anthropicText({ content: [{ type: "text", text: "one " }, { type: "text", text: "two" }] }),
      "one two",
    );
    assert.equal(anthropicText({ content: [] }), null);
  });

  it("reads Gemini candidate parts", () => {
    assert.equal(geminiText({ candidates: [{ content: { parts: [{ text: "x" }, { text: "y" }] } }] }), "xy");
    assert.equal(geminiText({ candidates: [] }), null);
  });

  it("normalises model listings across the two conventions", () => {
    assert.deepEqual(openAiModelIds({ data: [{ id: "gpt-5" }, { id: "o4" }] }), ["gpt-5", "o4"]);
    assert.deepEqual(geminiModelIds({ models: [{ name: "models/gemini-2.5-pro" }] }), ["gemini-2.5-pro"]);
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
    assert.match(describeEmptyCompletion({ choices: [{ finish_reason: "length" }] }), /token limit/);
  });
});
