import { whoami } from "@rat-king/lexicon/trust";
import { Clock, Effect, Option, Schema } from "effect";
import { createMachine, initialTransition, transition } from "xstate";

import { presentedCredential } from "./credential.ts";
import { legacyProtocols, openMcp } from "./mcp.ts";
import { ContactPolicy, PublicDesk, contactPolicy } from "./policy.ts";

export const sessionMachine = createMachine({
  context: {},
  id: "contact",
  initial: "unopened",
  states: {
    active: { on: { CLOSE: { target: "closed" } } },
    closed: { type: "final" },
    unopened: { on: { OPEN: { target: "active" } } },
  },
});

export const StoredSession = Schema.Struct({
  createdAt: Schema.Finite,
  desk: PublicDesk,
  initialize: Schema.String,
  phase: Schema.Literals(["active", "closed"]),
  policy: ContactPolicy,
});

export type StoredSessionValue = typeof StoredSession.Type;

export interface SessionStorage<R = never> {
  readonly load: Effect.Effect<StoredSessionValue | undefined, never, R>;
  readonly save: (session: StoredSessionValue) => Effect.Effect<void, never, R>;
}

const Envelope = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(
      Schema.Union([Schema.String, Schema.Finite, Schema.Null])
    ),
    method: Schema.String,
  })
);

const Initialize = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Union([Schema.String, Schema.Finite, Schema.Null]),
    jsonrpc: Schema.Literal("2.0"),
    method: Schema.Literal("initialize"),
    params: Schema.Struct({
      clientInfo: Schema.Struct({
        name: Schema.String.check(Schema.isMaxLength(256)),
        version: Schema.String.check(Schema.isMaxLength(128)),
      }),
      protocolVersion: Schema.Literals([
        "2025-11-25",
        "2025-06-18",
        "2025-03-26",
        "2024-11-05",
      ]),
    }),
  })
);

const rpcError = (
  status: number,
  code: number,
  message: string,
  id: string | number | null = null
) =>
  Response.json(
    { error: { code, message }, id, jsonrpc: "2.0" },
    { headers: { "cache-control": "no-store" }, status }
  );

const withBody = (request: Request, body: string, sessionId?: string) => {
  const headers = new Headers(request.headers);
  headers.delete("mcp-session-id");

  if (sessionId !== undefined) {
    headers.set("mcp-session-id", sessionId);
  }

  return new Request(request.url, { body, headers, method: "POST" });
};

const externalResponse = (response: Response, externalId: string) => {
  const headers = new Headers(response.headers);
  headers.set("mcp-session-id", externalId);
  headers.set("cache-control", "no-store");

  return new Response(response.body, { headers, status: response.status });
};

interface ContactContext<R> {
  readonly desk: string;
  readonly externalId: string;
  readonly now: number;
  readonly policy: typeof ContactPolicy.Type;
  readonly storage: SessionStorage<R>;
}

type McpHandler = (request: Request) => Effect.Effect<Response>;

const initializeContact = Effect.fn("ContactSession.initialize")(
  function* initializeContact<R>(
    run: McpHandler,
    request: Request,
    body: string,
    contact: ContactContext<R>
  ) {
    const initialize = yield* Schema.decodeEffect(Initialize)(body).pipe(
      Effect.option
    );

    if (Option.isNone(initialize)) {
      return rpcError(400, -32_602, "Invalid initialize parameters");
    }

    const normalized = JSON.stringify({
      ...initialize.value,
      params: { ...initialize.value.params, capabilities: {} },
    });

    const response = yield* run(withBody(request, normalized));

    if (!response.ok || !response.headers.has("mcp-session-id")) {
      return response;
    }

    const [initial] = initialTransition(sessionMachine);
    const [opened] = transition(sessionMachine, initial, { type: "OPEN" });

    if (opened.matches("active")) {
      yield* contact.storage.save({
        createdAt: contact.now,
        desk: contact.desk,
        initialize: normalized,
        phase: "active",
        policy: contact.policy,
      });
    }

    return externalResponse(response, contact.externalId);
  }
);

export const handleContact = Effect.fn("ContactSession.handle")(
  function* contactRequest<R>(
    request: Request,
    body: string,
    externalId: string,
    desk: string,
    storage: SessionStorage<R>
  ) {
    const now = yield* Clock.currentTimeMillis;
    const stored = yield* storage.load;

    const state = sessionMachine.resolveState({
      context: {},
      value: stored?.phase ?? "unopened",
    });

    const credential = Option.getOrUndefined(
      yield* presentedCredential(request)
    );

    const trust = yield* whoami(credential, desk, now);
    const policy = contactPolicy(desk, trust, now);

    if (
      stored !== undefined &&
      (stored.desk !== desk ||
        now - stored.createdAt >= 86_400_000 ||
        state.matches("closed"))
    ) {
      return rpcError(404, -32_001, "Session not found");
    }

    if (request.method === "DELETE") {
      if (stored === undefined) {
        return rpcError(404, -32_001, "Session not found");
      }

      const [closed] = transition(sessionMachine, state, { type: "CLOSE" });

      if (closed.matches("closed")) {
        yield* storage.save({ ...stored, phase: "closed", policy });
      }

      return new Response(null, { status: 204 });
    }

    if (request.method !== "POST") {
      return new Response(null, {
        headers: { allow: "POST, DELETE" },
        status: 405,
      });
    }

    const envelope = yield* Schema.decodeUnknownEffect(Envelope)(body).pipe(
      Effect.option
    );

    const run = yield* openMcp(legacyProtocols, credential, desk);

    if (Option.isSome(envelope) && envelope.value.method === "initialize") {
      if (!state.matches("unopened")) {
        return rpcError(
          409,
          -32_600,
          "Session already initialized",
          envelope.value.id ?? null
        );
      }

      return yield* initializeContact(run, request, body, {
        desk,
        externalId,
        now,
        policy,
        storage,
      });
    }

    if (stored === undefined) {
      return rpcError(404, -32_001, "Session not found");
    }

    const replayHeaders = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    });

    const initialized = yield* run(
      new Request(request.url, {
        body: stored.initialize,
        headers: replayHeaders,
        method: "POST",
      })
    );

    const internalId = initialized.headers.get("mcp-session-id");

    if (!initialized.ok || internalId === null) {
      return rpcError(503, -32_603, "Session restoration failed");
    }

    yield* Effect.promise(initialized.arrayBuffer.bind(initialized));
    replayHeaders.set(
      "mcp-protocol-version",
      initialized.headers.get("mcp-protocol-version") ?? "2025-03-26"
    );

    const notification = yield* run(
      new Request(request.url, {
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        headers: {
          ...Object.fromEntries(replayHeaders),
          "mcp-session-id": internalId,
        },
        method: "POST",
      })
    );

    yield* Effect.promise(notification.arrayBuffer.bind(notification));

    if (!notification.ok) {
      return rpcError(503, -32_603, "Session restoration failed");
    }

    yield* storage.save({ ...stored, policy });

    return externalResponse(
      yield* run(withBody(request, body, internalId)),
      externalId
    );
  },
  Effect.scoped
);
