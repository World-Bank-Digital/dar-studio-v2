import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  actorNameSettingsPatch,
  createOrderedMutationQueue,
  defaultSessionState,
  mergeHydratedSessionState,
  resolveSessionState,
  roleSettingsPatch,
  visibleSessionState,
  type SessionIdentity,
} from "./session-state.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("account-scoped session state", () => {
  it("never exposes the preceding account's acting identity during an account change", () => {
    const previous = {
      userId: "user-a",
      role: "Model steward",
      actorName: "User A",
    };
    const current: SessionIdentity = { id: "user-b", displayName: "User B" };

    assert.deepEqual(visibleSessionState(previous, current), {
      userId: "user-b",
      role: "TTL",
      actorName: "User B",
    });
  });

  it("clears account-scoped values immediately when the user signs out", () => {
    const previous = {
      userId: "user-a",
      role: "Assessment lead",
      actorName: "User A",
    };

    assert.deepEqual(visibleSessionState(previous, null), defaultSessionState(null));
  });

  it("resolves missing settings against only the current account's defaults", () => {
    const current: SessionIdentity = { id: "user-b", displayName: "User B" };

    assert.deepEqual(resolveSessionState(current, { role: "", actorName: "" }), {
      userId: "user-b",
      role: "TTL",
      actorName: "User B",
    });
  });

  it("persists a pre-hydration edit without sending fallback sibling fields", async () => {
    const gate = deferred<void>();
    const calls: Array<Record<string, unknown>> = [];
    const queue = createOrderedMutationQueue<Record<string, unknown>>(async (patch) => {
      calls.push(patch);
      await gate.promise;
    });

    const pending = queue.enqueue(actorNameSettingsPatch("user-1", "New actor"));
    await Promise.resolve();

    assert.deepEqual(calls, [{ expectedUserId: "user-1", actorName: "New actor" }]);
    gate.resolve();
    await pending;
  });

  it("merges a late hydration into a locally edited role without losing the saved actor", async () => {
    const current: Exclude<SessionIdentity, null> = {
      id: "user-1",
      displayName: "Display fallback",
    };
    const response = deferred<{ role: string; actorName: string }>();
    let state = defaultSessionState(current);
    const hydration = response.promise.then((settings) => {
      state = mergeHydratedSessionState(current, settings, state, {
        role: true,
        actorName: false,
      });
    });

    state = { ...state, role: "Assessment lead" };
    response.resolve({ role: "Model steward", actorName: "Saved actor" });
    await hydration;

    assert.deepEqual(state, {
      userId: "user-1",
      role: "Assessment lead",
      actorName: "Saved actor",
    });
  });

  it("merges a late hydration into a locally edited actor without losing the saved role", async () => {
    const current: Exclude<SessionIdentity, null> = {
      id: "user-1",
      displayName: "Display fallback",
    };
    const response = deferred<{ role: string; actorName: string }>();
    let state = defaultSessionState(current);
    const hydration = response.promise.then((settings) => {
      state = mergeHydratedSessionState(current, settings, state, {
        role: false,
        actorName: true,
      });
    });

    state = { ...state, actorName: "Local actor" };
    response.resolve({ role: "Model steward", actorName: "Saved actor" });
    await hydration;

    assert.deepEqual(state, {
      userId: "user-1",
      role: "Model steward",
      actorName: "Local actor",
    });
  });

  it("serializes writes so an older completion cannot overwrite a newer edit", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const started: string[] = [];
    const completed: string[] = [];
    const queue = createOrderedMutationQueue<{ expectedUserId: string; role: string }>(
      async (patch) => {
        started.push(patch.role);
        await (patch.role === "Assessment lead" ? first.promise : second.promise);
        completed.push(patch.role);
      },
    );

    const older = queue.enqueue(roleSettingsPatch("user-1", "Assessment lead"));
    const newer = queue.enqueue(roleSettingsPatch("user-1", "Model steward"));
    await Promise.resolve();
    assert.deepEqual(started, ["Assessment lead"]);

    second.resolve();
    await Promise.resolve();
    assert.deepEqual(completed, []);

    first.resolve();
    await older;
    await newer;
    assert.deepEqual(started, ["Assessment lead", "Model steward"]);
    assert.deepEqual(completed, ["Assessment lead", "Model steward"]);
  });

  it("remounts the settings surface when the authenticated account changes", () => {
    const route = readFileSync(new URL("../routes/settings.tsx", import.meta.url), "utf8");
    assert.match(route, /<SettingsInner key=\{user\.id\} userId=\{user\.id\} \/>/);
  });
});
