import {
  acceptsHtml,
  appNameFromHost,
  createHeadInjector,
  isDocumentPath,
  isInstallQuery,
  renderInstallPageHtml,
  renderWebManifest,
} from "../../../scripts/grok-pwa-shared.mjs";

export interface StartRequestResult<TContext = unknown> {
  request: Request;
  response: Response;
  pathname: string;
  context: TContext;
}

type NextRequest<TResult extends StartRequestResult> = () => TResult | Promise<TResult>;

function requestHost(request: Request): string {
  return (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host
  );
}

export function injectGrokHeadStreaming(response: Response, appName: string): Response {
  if (!response.body) return response;
  const injector = createHeadInjector(appName);
  const transformed = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        for (const output of injector.push(chunk)) controller.enqueue(output);
      },
      flush(controller) {
        for (const output of injector.flush()) controller.enqueue(output);
      },
    }),
  );
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Provider-neutral PWA handling used by the TanStack server entry. */
export async function handleGrokPwaRequest<TResult extends StartRequestResult>(
  request: Request,
  next: NextRequest<TResult>,
  installPageTemplate: string,
): Promise<Response | TResult> {
  if (request.method.toUpperCase() !== "GET") return next();

  const url = new URL(request.url);
  const path = url.pathname;
  const urlWithQuery = `${path}${url.search}`;
  const host = requestHost(request);

  if (path === "/__grok/manifest.webmanifest" || path === "/__grok/manifest.json") {
    return new Response(renderWebManifest(host), {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  if (
    isInstallQuery(urlWithQuery) &&
    isDocumentPath(path) &&
    acceptsHtml(request.headers.get("accept"))
  ) {
    return new Response(renderInstallPageHtml(installPageTemplate, { host, url: urlWithQuery }), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }

  const result = await next();
  if (!isDocumentPath(path)) return result;
  const response = result.response;
  if (
    response.body &&
    String(response.headers.get("content-type") ?? "").includes("text/html") &&
    !response.headers.get("content-encoding")
  ) {
    return {
      ...result,
      response: injectGrokHeadStreaming(response, appNameFromHost(host)),
    };
  }
  return result;
}
