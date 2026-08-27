import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import installPageTemplate from "../scripts/install-page.html?raw";

import { handleGrokPwaRequest } from "./lib/pwa/grok-request";

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

const grokPwaRequestMiddleware = createMiddleware({ type: "request" }).server(
  ({ request, next }) => handleGrokPwaRequest(request, next, installPageTemplate),
);

/** Global server behavior shared by Netlify and the existing Nitro target. */
export const startInstance = createStart(() => ({
  // Defining src/start.ts replaces TanStack Start's implicit defaults, so the
  // CSRF guard must remain explicit whenever request middleware is extended.
  requestMiddleware: [csrfMiddleware, grokPwaRequestMiddleware],
}));
