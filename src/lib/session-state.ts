import type { UserSettingsMutation } from "./damm-v17/settings-store.ts";

export type SessionIdentity = {
  id: string;
  displayName: string | null;
} | null;

export type SessionSettings = {
  role?: string | null;
  actorName?: string | null;
};

export type OwnedSessionState = {
  userId: string | null;
  role: string;
  actorName: string;
};

export type DirtySessionFields = {
  role: boolean;
  actorName: boolean;
};

export function defaultSessionState(user: SessionIdentity): OwnedSessionState {
  return {
    userId: user?.id ?? null,
    role: "TTL",
    actorName: user?.displayName ?? "",
  };
}

export function resolveSessionState(
  user: Exclude<SessionIdentity, null>,
  settings: SessionSettings,
): OwnedSessionState {
  return {
    userId: user.id,
    role: settings.role || "TTL",
    actorName: settings.actorName || user.displayName || "",
  };
}

/** Applies a settings response without replacing fields edited after that request began. */
export function mergeHydratedSessionState(
  user: Exclude<SessionIdentity, null>,
  settings: SessionSettings,
  current: OwnedSessionState,
  dirty: DirtySessionFields,
): OwnedSessionState {
  if (current.userId !== user.id) return current;
  const hydrated = resolveSessionState(user, settings);
  return {
    userId: user.id,
    role: dirty.role ? current.role : hydrated.role,
    actorName: dirty.actorName ? current.actorName : hydrated.actorName,
  };
}

/** Never expose one account's acting identity while another account hydrates. */
export function visibleSessionState(
  state: OwnedSessionState,
  user: SessionIdentity,
): OwnedSessionState {
  return state.userId === (user?.id ?? null) ? state : defaultSessionState(user);
}

export function actorNameSettingsPatch(
  expectedUserId: string,
  actorName: string,
): UserSettingsMutation & { actorName: string } {
  return { expectedUserId, actorName };
}

export function roleSettingsPatch(
  expectedUserId: string,
  role: string,
): UserSettingsMutation & { role: string } {
  return { expectedUserId, role };
}

export type OrderedMutationQueue<T> = {
  enqueue(value: T): Promise<void>;
};

/** Starts each write only after the preceding write settles, preserving UI order. */
export function createOrderedMutationQueue<T>(
  persist: (value: T) => Promise<unknown>,
): OrderedMutationQueue<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue(value) {
      const result = tail.then(() => persist(value)).then(() => undefined);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
