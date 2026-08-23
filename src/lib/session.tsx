import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSettings, saveSettings } from "@/lib/damm-v17/actions";
import { useCurrentUser } from "@/lib/auth/use-current-user";

type Session = {
  role: string;
  actorName: string;
  setRole: (role: string) => void;
  setActorName: (name: string) => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const [role, setRoleState] = useState("TTL");
  const [actorName, setActorNameState] = useState("");

  useEffect(() => {
    if (!user) return;
    getSettings()
      .then((s) => {
        if (s.role) setRoleState(s.role);
        if (s.actorName) setActorNameState(s.actorName);
        else if (user.displayName) setActorNameState(user.displayName);
      })
      .catch(() => {
        if (user.displayName) setActorNameState(user.displayName);
      });
  }, [user?.id]);

  const value = useMemo<Session>(
    () => ({
      role,
      actorName: actorName || user?.displayName || "Unnamed",
      setRole: (r) => {
        setRoleState(r);
        saveSettings({ data: { role: r, actorName: actorName || user?.displayName || "" } }).catch(() => undefined);
      },
      setActorName: (n) => {
        setActorNameState(n);
        saveSettings({ data: { role, actorName: n } }).catch(() => undefined);
      },
    }),
    [role, actorName, user?.displayName],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionRole() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("SessionProvider missing");
  return ctx;
}

/**
 * Acting roles are part of the engagement chassis, not the model: who may act
 * is an app concern, while the model only records who did.
 */
export const ACTING_ROLES = [
  "TTL",
  "Assessment lead",
  "Evidence panel",
  "Digital authority",
  "Statistics office",
  "Private-sector panel",
  "Farmer representative",
  "Independent challenger",
  "Steering committee",
  "Model steward",
];
