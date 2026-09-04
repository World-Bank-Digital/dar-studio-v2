import { createContext, useContext } from "react";

export type Session = {
  role: string;
  actorName: string;
  setRole: (role: string) => void;
  setActorName: (name: string) => void;
};

export const SessionContext = createContext<Session | null>(null);

export function useSessionRole() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider missing");
  return session;
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
