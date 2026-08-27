/**
 * Large Stage 8 artifact delivery for the Render web service.
 *
 * Netlify issues a short-lived capability for the signed-in owner or exact assigned
 * reviewer. This service verifies that capability, re-authorizes its subject and active
 * assignment in Neon, resolves only the exact immutable publication it names, asks Neon
 * to hash the stored bytes before sending headers, and streams bounded chunks.
 */
import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validAbsoluteHttpsUrl, validNeonOhioConnection } from "./deployment-url-policy.mjs";
import {
  requireArtifactDeliverySecret,
  verifyArtifactDeliveryToken,
  type ArtifactDeliveryTokenPayload,
} from "../src/lib/damm-v17/artifact-delivery-token.ts";
import { ARTIFACT_DELIVERY_ENDPOINT_PATH } from "../src/lib/damm-v17/artifact-delivery-contract.ts";
import {
  MAX_WORKFLOW_ARTIFACT_BYTES,
  MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES,
  MAX_WORKFLOW_BUNDLE_BYTES,
} from "../src/lib/damm-v17/artifact-limits.ts";
import { DAR_WORKFLOW, DAR_WORKFLOW_SHA256 } from "../src/lib/damm-v17/workflow.ts";

const DEFAULT_CHUNK_BYTES = 1024 * 1024;

type MethodologyStatus = "canonical" | "legacy_unverified";

interface QueryResult<Row> {
  rows: Row[];
}

export interface ArtifactDatabase {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

export interface VerifiedDeliveryArtifact {
  runId: string;
  artifactSetId: string;
  key: string;
  sha256: string;
  filename: string;
  contentType: string;
  byteSize: number;
  methodologyStatus: MethodologyStatus;
  chunks(): AsyncIterable<Uint8Array>;
}

export type ArtifactOpenResult =
  | { ok: true; artifact: VerifiedDeliveryArtifact }
  | { ok: false; reason: "not_found" | "integrity" };

export interface ArtifactRepository {
  /** Returns success only after Neon has hashed and length-checked the exact stored bytes. */
  open(identity: ArtifactDeliveryTokenPayload): Promise<ArtifactOpenResult>;
}

interface ArtifactMetadataRow {
  run_id: string;
  artifact_set_id: string;
  artifact_key: string;
  filename: string;
  content_type: string;
  sha256: string;
  byte_size: string | number;
  actual_byte_size: string | number;
  actual_sha256: string;
  artifact_set_byte_size: string | number;
  actual_artifact_set_byte_size: string | number;
  content_verified_at: Date | string | null;
  methodology_status: MethodologyStatus;
}

const ARTIFACT_METADATA_SQL = `
  select workflow_run.id as run_id,
         workflow_run.workflow_artifact_set_id as artifact_set_id,
         artifact.artifact_key, artifact.filename, artifact.content_type,
         artifact.sha256, artifact.byte_size::text,
         octet_length(artifact.content)::text as actual_byte_size,
         encode(sha256(artifact.content), 'hex') as actual_sha256,
         (
           select coalesce(sum(sibling.byte_size), 0)::text
           from workflow_run_artifacts sibling
           where sibling.run_id = workflow_run.id
             and sibling.artifact_set_id = workflow_run.workflow_artifact_set_id
         ) as artifact_set_byte_size,
         (
           select coalesce(sum(octet_length(sibling.content)), 0)::text
           from workflow_run_artifacts sibling
           where sibling.run_id = workflow_run.id
             and sibling.artifact_set_id = workflow_run.workflow_artifact_set_id
         ) as actual_artifact_set_byte_size,
         artifact.content_verified_at,
         case when methodology.run_id is null then 'legacy_unverified'
              else 'canonical' end as methodology_status
  from runs workflow_run
  left join workflow_run_methodology methodology on methodology.run_id = workflow_run.id
  join workflow_run_artifacts artifact
    on artifact.run_id = workflow_run.id
   and artifact.artifact_set_id = workflow_run.workflow_artifact_set_id
  join workflow_run_artifacts bundle
    on bundle.run_id = workflow_run.id
   and bundle.artifact_set_id = workflow_run.workflow_artifact_set_id
   and bundle.artifact_key = 'bundle'
  left join workflow_approval_packages package
    on package.run_id = workflow_run.id
   and package.artifact_set_id = workflow_run.workflow_artifact_set_id
  where workflow_run.id = $1
    and workflow_run.workflow_artifact_set_id = $2
    and artifact.artifact_key = $3
    and artifact.sha256 = $4
    and workflow_run.pass = 'workflow'
    and workflow_run.status = 'done'
    and workflow_run.finished_at is not null
    and artifact.workflow_id = $5
    and artifact.workflow_version = $6
    and artifact.workflow_contract_sha256 = $7
    and (
      (
        methodology.run_id is not null
        and artifact.damm_model_version = methodology.model_version
        and artifact.damm_model_revision = methodology.model_revision
        and artifact.damm_model_sha256 = methodology.app_model_sha256
        and artifact.damm_source_commit = methodology.source_commit
        and artifact.assessment_input_sha256 is not null
        and artifact.content_verified_at is not null
      )
      or
      (
        methodology.run_id is null
        and artifact.damm_model_version is null
        and artifact.damm_model_revision is null
        and artifact.damm_model_sha256 is null
        and artifact.damm_source_commit is null
        and artifact.assessment_input_sha256 is null
      )
    )
    and (
      (
        $8 = 'country_owner'
        and workflow_run.user_id = $9
        and $10::text is null
        and $11::text is null
        and $12::text is null
        and $13::text is null
      )
      or
      (
        $8 = 'assigned_reviewer'
        and package.id = $10
        and package.target_identity_sha256 = $12
        and package.bundle_sha256 = $13
        and bundle.sha256 = $13
        and exists (
          select 1
          from workflow_approval_assignments assignment
          where assignment.id = $11
            and assignment.package_id = package.id
            and assignment.target_identity_sha256 = package.target_identity_sha256
            and assignment.reviewer_user_id = $9
            and assignment.active
            and not exists (
              select 1
              from workflow_approval_assignment_supersessions supersession
              where supersession.revoked_assignment_id = assignment.id
            )
        )
      )
    )
  limit 1`;

const VERIFY_LEGACY_ARTIFACT_SQL = `
  update workflow_run_artifacts artifact
     set content_verified_at = now()
   where artifact.run_id = $1
     and artifact.artifact_set_id = $2
     and artifact.artifact_key = $3
     and artifact.sha256 = $4
     and artifact.content_verified_at is null
     and exists (
       select 1
       from runs workflow_run
       where workflow_run.id = artifact.run_id
         and workflow_run.workflow_artifact_set_id = artifact.artifact_set_id
         and workflow_run.pass = 'workflow'
         and workflow_run.status = 'done'
         and workflow_run.finished_at is not null
     )`;

const ARTIFACT_CHUNK_SQL = `
  select substring(artifact.content from $5::int for $6::int) as chunk
  from runs workflow_run
  join workflow_run_artifacts artifact
    on artifact.run_id = workflow_run.id
   and artifact.artifact_set_id = workflow_run.workflow_artifact_set_id
  join workflow_run_artifacts bundle
    on bundle.run_id = workflow_run.id
   and bundle.artifact_set_id = workflow_run.workflow_artifact_set_id
   and bundle.artifact_key = 'bundle'
  left join workflow_approval_packages package
    on package.run_id = workflow_run.id
   and package.artifact_set_id = workflow_run.workflow_artifact_set_id
  where workflow_run.id = $1
    and workflow_run.workflow_artifact_set_id = $2
    and artifact.artifact_key = $3
    and artifact.sha256 = $4
    and workflow_run.pass = 'workflow'
    and workflow_run.status = 'done'
    and workflow_run.finished_at is not null
    and (
      (
        $8 = 'country_owner'
        and workflow_run.user_id = $7
        and $9::text is null
        and $10::text is null
        and $11::text is null
        and $12::text is null
      )
      or
      (
        $8 = 'assigned_reviewer'
        and package.id = $9
        and package.target_identity_sha256 = $11
        and package.bundle_sha256 = $12
        and bundle.sha256 = $12
        and exists (
          select 1
          from workflow_approval_assignments assignment
          where assignment.id = $10
            and assignment.package_id = package.id
            and assignment.target_identity_sha256 = package.target_identity_sha256
            and assignment.reviewer_user_id = $7
            and assignment.active
            and not exists (
              select 1
              from workflow_approval_assignment_supersessions supersession
              where supersession.revoked_assignment_id = assignment.id
            )
        )
      )
    )
  limit 1`;

function safeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function byteArray(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string" && /^\\x[0-9a-f]*$/i.test(value)) {
    return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  }
  return null;
}

function safeFilename(value: string, legacy: boolean): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? "";
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  const filename = cleaned || "workflow-artifact";
  return legacy ? `LEGACY-UNVERIFIED_${filename}` : filename;
}

function safeContentType(value: string): string {
  const trimmed = value.trim();
  const hasUnsafeCharacter = Array.from(trimmed).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  return trimmed && trimmed.length <= 200 && !hasUnsafeCharacter
    ? trimmed
    : "application/octet-stream";
}

function exactArtifact(row: ArtifactMetadataRow, identity: ArtifactDeliveryTokenPayload): boolean {
  return (
    row.run_id === identity.runId &&
    row.artifact_set_id === identity.artifactSetId &&
    row.artifact_key === identity.key &&
    row.sha256 === identity.sha256
  );
}

/**
 * Neon remains the byte and identity source of truth. The first query performs the
 * expensive digest inside PostgreSQL and returns no content; only a verified row gains
 * a chunk iterator. Published-row triggers make that second pass immutable.
 */
export function createPostgresArtifactRepository(
  database: ArtifactDatabase,
  options: { chunkBytes?: number } = {},
): ArtifactRepository {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 4 * 1024 * 1024) {
    throw new Error("Artifact delivery chunk size must be between 1 byte and 4 MB.");
  }

  return {
    async open(identity): Promise<ArtifactOpenResult> {
      const result = await database.query<ArtifactMetadataRow>(ARTIFACT_METADATA_SQL, [
        identity.runId,
        identity.artifactSetId,
        identity.key,
        identity.sha256,
        DAR_WORKFLOW.workflow_id,
        DAR_WORKFLOW.workflow_version,
        DAR_WORKFLOW_SHA256,
        identity.accessAs,
        identity.subjectUserId,
        identity.packageId,
        identity.assignmentId,
        identity.targetIdentitySha256,
        identity.bundleSha256,
      ]);
      const row = result.rows[0];
      if (!row) return { ok: false, reason: "not_found" };

      const byteSize = safeInteger(row.byte_size);
      const actualByteSize = safeInteger(row.actual_byte_size);
      const artifactSetByteSize = safeInteger(row.artifact_set_byte_size);
      const actualArtifactSetByteSize = safeInteger(row.actual_artifact_set_byte_size);
      const individualLimit =
        identity.key === "bundle" ? MAX_WORKFLOW_BUNDLE_BYTES : MAX_WORKFLOW_ARTIFACT_BYTES;
      if (
        !exactArtifact(row, identity) ||
        byteSize === null ||
        actualByteSize !== byteSize ||
        artifactSetByteSize === null ||
        actualArtifactSetByteSize !== artifactSetByteSize ||
        byteSize > individualLimit ||
        artifactSetByteSize > MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES ||
        actualArtifactSetByteSize > MAX_WORKFLOW_ARTIFACT_TOTAL_BYTES ||
        row.actual_sha256 !== identity.sha256 ||
        !["canonical", "legacy_unverified"].includes(row.methodology_status) ||
        (row.methodology_status === "canonical" && row.content_verified_at === null)
      ) {
        return { ok: false, reason: "integrity" };
      }

      if (row.methodology_status === "legacy_unverified" && row.content_verified_at === null) {
        // The immutable-artifact trigger permits only this null-to-timestamp transition.
        // Delivery remains available if the bookkeeping write races or transiently fails:
        // Neon has already verified the exact bytes, size, and digest above.
        await database
          .query(VERIFY_LEGACY_ARTIFACT_SQL, [
            identity.runId,
            identity.artifactSetId,
            identity.key,
            identity.sha256,
          ])
          .catch(() => undefined);
      }

      const artifact: VerifiedDeliveryArtifact = {
        runId: row.run_id,
        artifactSetId: row.artifact_set_id,
        key: row.artifact_key,
        sha256: row.sha256,
        filename: safeFilename(row.filename, false),
        contentType: safeContentType(row.content_type),
        byteSize,
        methodologyStatus: row.methodology_status,
        async *chunks(): AsyncIterable<Uint8Array> {
          let offset = 0;
          while (offset < byteSize) {
            const length = Math.min(chunkBytes, byteSize - offset);
            // PostgreSQL bytea substring positions are one-based.
            const chunkResult = await database.query<{ chunk: unknown }>(ARTIFACT_CHUNK_SQL, [
              identity.runId,
              identity.artifactSetId,
              identity.key,
              identity.sha256,
              offset + 1,
              length,
              identity.subjectUserId,
              identity.accessAs,
              identity.packageId,
              identity.assignmentId,
              identity.targetIdentitySha256,
              identity.bundleSha256,
            ]);
            const chunk = byteArray(chunkResult.rows[0]?.chunk);
            if (!chunk || chunk.byteLength !== length) {
              throw new Error("The immutable artifact changed while it was being delivered.");
            }
            offset += chunk.byteLength;
            yield chunk;
          }
        },
      };
      return { ok: true, artifact };
    },
  };
}

function downloadToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

function baseHeaders(cacheControl = "private, no-store"): Record<string, string> {
  return {
    "cache-control": cacheControl,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function textResponse(
  status: number,
  body: string,
  cacheControl?: string,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...baseHeaders(cacheControl),
      ...additionalHeaders,
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(body).toString(),
    },
  });
}

export function artifactAppOrigin(value: string): string {
  if (!validAbsoluteHttpsUrl(value)) {
    throw new Error("APP_ORIGIN must be an HTTPS origin with no path.");
  }
  return new URL(value).origin;
}

function corsHeaders(appOrigin: string): Record<string, string> {
  return {
    "access-control-allow-origin": appOrigin,
    "access-control-expose-headers":
      "Content-Disposition, Content-Length, Content-Type, Warning, X-Content-SHA256, X-DAMM-Methodology-Status",
    vary: "Origin",
  };
}

function isDeliveryEndpoint(url: URL): boolean {
  return url.pathname === ARTIFACT_DELIVERY_ENDPOINT_PATH && !url.search && !url.hash;
}

function validPreflight(request: Request): boolean {
  if (request.headers.get("access-control-request-method") !== "GET") return false;
  const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  return requestedHeaders.length === 1 && requestedHeaders[0] === "authorization";
}

function sameIdentity(
  artifact: VerifiedDeliveryArtifact,
  identity: ArtifactDeliveryTokenPayload,
): boolean {
  return (
    artifact.runId === identity.runId &&
    artifact.artifactSetId === identity.artifactSetId &&
    artifact.key === identity.key &&
    artifact.sha256 === identity.sha256
  );
}

async function writeWithBackpressure(response: ServerResponse, chunk: Uint8Array): Promise<void> {
  if (response.destroyed || !response.writable) {
    throw new Error("Artifact delivery client disconnected.");
  }
  if (response.write(chunk)) return;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      response.off("drain", drained);
      response.off("close", closed);
      response.off("error", failed);
    };
    const drained = () => {
      cleanup();
      resolvePromise();
    };
    const closed = () => {
      cleanup();
      rejectPromise(new Error("Artifact delivery client disconnected."));
    };
    const failed = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };
    response.once("drain", drained);
    response.once("close", closed);
    response.once("error", failed);
  });
}

function artifactBody(artifact: VerifiedDeliveryArtifact): ReadableStream<Uint8Array> {
  const iterator = artifact.chunks()[Symbol.asyncIterator]();
  let delivered = 0;
  const hash = createHash("sha256");
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (!next.done) {
          delivered += next.value.byteLength;
          hash.update(next.value);
          controller.enqueue(next.value);
          return;
        }
        if (delivered !== artifact.byteSize || hash.digest("hex") !== artifact.sha256) {
          controller.error(new Error("Artifact delivery integrity check failed."));
          return;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export function createArtifactGatewayHandler(input: {
  repository: ArtifactRepository;
  secret: string;
  appOrigin: string;
  now?: () => Date;
}): (request: Request) => Promise<Response> {
  const secret = requireArtifactDeliverySecret(input.secret);
  const appOrigin = artifactAppOrigin(input.appOrigin);
  const now = input.now ?? (() => new Date());

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz" && !url.search) {
      const body = JSON.stringify({ status: "ok" });
      return new Response(body, {
        status: 200,
        headers: {
          ...baseHeaders("no-store"),
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(body).toString(),
        },
      });
    }

    const fromApp = request.headers.get("origin") === appOrigin;
    if (request.method === "OPTIONS" && isDeliveryEndpoint(url)) {
      if (!fromApp || !validPreflight(request)) return textResponse(404, "Not found.");
      return new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders("no-store"),
          ...corsHeaders(appOrigin),
          "access-control-allow-methods": "GET",
          "access-control-allow-headers": "Authorization",
          "access-control-max-age": "0",
        },
      });
    }

    if (request.method !== "GET" || !isDeliveryEndpoint(url) || !fromApp) {
      return textResponse(404, "Not found.");
    }
    const responseCorsHeaders = corsHeaders(appOrigin);
    const token = downloadToken(request);
    if (!token) return textResponse(404, "Not found.", undefined, responseCorsHeaders);

    let identity: ArtifactDeliveryTokenPayload;
    try {
      identity = verifyArtifactDeliveryToken(token, secret, now());
    } catch {
      return textResponse(404, "Not found.", undefined, responseCorsHeaders);
    }
    const opened = await input.repository.open(identity);
    if (!opened.ok) {
      return opened.reason === "integrity"
        ? textResponse(
            409,
            "The stored artifact failed its integrity check.",
            undefined,
            responseCorsHeaders,
          )
        : textResponse(404, "Not found.", undefined, responseCorsHeaders);
    }
    if (!sameIdentity(opened.artifact, identity)) {
      return textResponse(
        409,
        "The stored artifact failed its integrity check.",
        undefined,
        responseCorsHeaders,
      );
    }
    const artifact = opened.artifact;
    const filename = safeFilename(
      artifact.filename,
      artifact.methodologyStatus === "legacy_unverified",
    );
    return new Response(artifactBody(artifact), {
      status: 200,
      headers: {
        ...baseHeaders(),
        ...responseCorsHeaders,
        "content-type": safeContentType(artifact.contentType),
        "content-length": artifact.byteSize.toString(),
        "content-disposition": `attachment; filename="${filename}"`,
        "x-content-sha256": artifact.sha256,
        "x-damm-methodology-status": artifact.methodologyStatus,
        ...(artifact.methodologyStatus === "legacy_unverified"
          ? {
              warning:
                '299 DAR-Studio "Legacy artifact: DAMM methodology identity was not recorded"',
            }
          : {}),
      },
    });
  };
}

async function pipeResponse(source: Response, target: ServerResponse): Promise<void> {
  target.writeHead(source.status, Object.fromEntries(source.headers.entries()));
  if (!source.body) {
    target.end();
    return;
  }
  const reader = source.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      await writeWithBackpressure(target, result.value);
    }
    target.end();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function createArtifactGatewayServer(input: {
  repository: ArtifactRepository;
  secret: string;
  appOrigin: string;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}): Server {
  const handler = createArtifactGatewayHandler(input);
  const logger = input.logger ?? console;

  return createServer(async (request, response) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }
      const result = await handler(
        new Request(`http://artifact-gateway.invalid${request.url ?? "/"}`, {
          method: request.method,
          headers,
        }),
      );
      await pipeResponse(result, response);
    } catch (error) {
      logger.error(
        `[artifact-gateway] request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      if (!response.headersSent) {
        await pipeResponse(textResponse(503, "Artifact delivery is unavailable."), response);
      } else {
        response.destroy();
      }
    }
  });
}

function requiredPort(value: string | undefined): number {
  const port = Number(value);
  if (!value || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be set to a valid TCP port.");
  }
  return port;
}

export function requireArtifactGatewayDatabaseUrl(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate || !validNeonOhioConnection(candidate, true)) {
    throw new Error(
      "DATABASE_URL must be Neon's pooled Ohio URL with exactly one sslmode=require.",
    );
  }
  return candidate;
}

async function startArtifactGateway(): Promise<void> {
  const secret = requireArtifactDeliverySecret();
  const databaseUrl = requireArtifactGatewayDatabaseUrl(process.env.DATABASE_URL);
  const appOrigin = artifactAppOrigin(process.env.APP_ORIGIN ?? "");
  const port = requiredPort(process.env.PORT);
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  await pool.query("select 1");
  const repository = createPostgresArtifactRepository(pool);
  const server = createArtifactGatewayServer({ repository, secret, appOrigin });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[artifact-gateway] listening on 0.0.0.0:${port}`);
  });

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      server.close(() => {
        void pool.end().finally(() => process.exit(0));
      });
    });
  }
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (directEntry === import.meta.url) {
  await startArtifactGateway();
}
