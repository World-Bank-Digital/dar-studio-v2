import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSettings, saveSettings } from "@/lib/damm-v17/actions";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { SessionContext, type Session } from "@/lib/session-context";
import {
  actorNameSettingsPatch,
  createOrderedMutationQueue,
  defaultSessionState,
  mergeHydratedSessionState,
  roleSettingsPatch,
  visibleSessionState,
  type SessionIdentity,
} from "@/lib/session-state";
import type { UserSettingsMutation } from "@/lib/damm-v17/settings-store";

export function SessionProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const userId = user?.id ?? null;
  const userDisplayName = user?.displayName ?? null;
  const identity: SessionIdentity = userId ? { id: userId, displayName: userDisplayName } : null;
  const [loadedSession, setLoadedSession] = useState(() => defaultSessionState(identity));
  const hydrationRevision = useRef(0);
  const fieldRevisions = useRef({ role: 0, actorName: 0 });
  const settingsWrites = useRef<ReturnType<
    typeof createOrderedMutationQueue<UserSettingsMutation>
  > | null>(null);
  settingsWrites.current ??= createOrderedMutationQueue((data: UserSettingsMutation) =>
    saveSettings({ data }),
  );
  const { role, actorName } = visibleSessionState(loadedSession, identity);

  useEffect(() => {
    const effectIdentity = userId ? { id: userId, displayName: userDisplayName } : null;
    const fallback = defaultSessionState(effectIdentity);
    const revision = ++hydrationRevision.current;
    const startedFieldRevisions = { ...fieldRevisions.current };

    setLoadedSession((current) => (current.userId === fallback.userId ? current : fallback));
    if (!effectIdentity) return;

    getSettings()
      .then((s) => {
        if (hydrationRevision.current !== revision) return;
        setLoadedSession((current) =>
          mergeHydratedSessionState(effectIdentity, s, current, {
            role: fieldRevisions.current.role !== startedFieldRevisions.role,
            actorName: fieldRevisions.current.actorName !== startedFieldRevisions.actorName,
          }),
        );
      })
      .catch(() => {
        if (hydrationRevision.current !== revision) return;
        setLoadedSession((current) => (current.userId === effectIdentity.id ? current : fallback));
      });

    return () => {
      if (hydrationRevision.current === revision) hydrationRevision.current += 1;
    };
  }, [userId, userDisplayName]);

  const value = useMemo<Session>(
    () => ({
      role,
      actorName: actorName || userDisplayName || "Unnamed",
      setRole: (r) => {
        fieldRevisions.current.role += 1;
        setLoadedSession({ userId, role: r, actorName });
        if (userId) {
          settingsWrites.current?.enqueue(roleSettingsPatch(userId, r)).catch(() => undefined);
        }
      },
      setActorName: (n) => {
        fieldRevisions.current.actorName += 1;
        setLoadedSession({ userId, role, actorName: n });
        if (userId) {
          settingsWrites.current?.enqueue(actorNameSettingsPatch(userId, n)).catch(() => undefined);
        }
      },
    }),
    [role, actorName, userId, userDisplayName],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
