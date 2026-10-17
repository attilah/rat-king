import { Effect, Option, Schema, Stream } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { llms } from "./content.ts";
import { presentedCredential } from "./credential.ts";
import { modernProtocols, openMcp } from "./mcp.ts";
import { renderPage } from "./page.ts";

export class EdgeFailure extends Schema.TaggedError<EdgeFailure>()(
  "EdgeFailure",
  { status: Schema.Int }
) {}

export const readBody = Effect.fn("Edge.readBody")(function* readBody(
  request: Request
) {
  if (request.body === null) {
    return "";
  }

  const buffer = new Uint8Array(65_536);

  const size = yield* HttpServerRequest.fromWeb(request).stream.pipe(
    Stream.mapError(() => new EdgeFailure({ status: 400 })),
    Stream.runFoldEffect(
      () => 0,
      (offset, chunk) => {
        if (offset + chunk.length > buffer.length) {
          return Effect.fail(new EdgeFailure({ status: 413 }));
        }

        buffer.set(chunk, offset);

        return Effect.succeed(offset + chunk.length);
      }
    )
  );

  return yield* Effect.try({
    catch: () => new EdgeFailure({ status: 400 }),
    try: () =>
      new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, size)
      ),
  });
});

const SessionId = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  )
);

const InitializeMethod = Schema.fromJsonString(
  Schema.Struct({ method: Schema.Literal("initialize") })
);

export interface EdgeOptions<R = never> {
  readonly desk: string;
  readonly freshId: Effect.Effect<string>;
  readonly forwardContact: (
    id: string,
    request: Request
  ) => Effect.Effect<Response, never, R>;
  readonly limit: (key: string) => Effect.Effect<boolean, never, R>;
}

export const secure = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
  );
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "no-store");

  return new Response(response.body, { headers, status: response.status });
};

const publicPage = Effect.fn("Edge.publicPage")(function* publicPage(
  request: Request,
  pathname: string
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Option.none<Response>();
  }

  if (pathname === "/") {
    return Option.some(
      secure(
        new Response(
          request.method === "HEAD"
            ? null
            : yield* renderPage().pipe(Effect.orDie),
          { headers: { "content-type": "text/html; charset=utf-8" } }
        )
      )
    );
  }

  if (pathname === "/llms.txt") {
    return Option.some(
      secure(
        new Response(request.method === "HEAD" ? null : llms, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      )
    );
  }

  return Option.none<Response>();
});

export const handleEdge = Effect.fn("Edge.handle")(
  function* handleEdge<R>(request: Request, options: EdgeOptions<R>) {
    const { pathname } = new URL(request.url);
    const page = yield* publicPage(request, pathname);

    if (Option.isSome(page)) {
      return page.value;
    }

    if (pathname !== "/mcp") {
      return secure(new Response("Not found", { status: 404 }));
    }

    const origin = request.headers.get("origin");

    if (origin !== null && origin !== "https://ratking.sh") {
      return secure(new Response("Forbidden origin", { status: 403 }));
    }

    if (
      !(yield* options.limit(
        request.headers.get("cf-connecting-ip") ?? "unknown"
      ))
    ) {
      return secure(
        new Response("Rate limited", {
          headers: { "retry-after": "60" },
          status: 429,
        })
      );
    }

    const body = request.method === "POST" ? yield* readBody(request) : "";

    const forwarded = new Request(request.url, {
      body: request.method === "POST" ? body : null,
      headers: request.headers,
      method: request.method,
    });

    if (request.headers.get("mcp-protocol-version") === "2026-07-28") {
      const credential = Option.getOrUndefined(
        yield* presentedCredential(request)
      );

      const run = yield* openMcp(modernProtocols, credential, options.desk);

      return secure(yield* run(forwarded));
    }

    const sessionId = request.headers.get("mcp-session-id");

    if (sessionId !== null) {
      if (!Schema.is(SessionId)(sessionId)) {
        return secure(new Response("Session not found", { status: 404 }));
      }

      return secure(yield* options.forwardContact(sessionId, forwarded));
    }

    if (
      request.method === "POST" &&
      Option.isSome(Schema.decodeUnknownOption(InitializeMethod)(body))
    ) {
      return secure(
        yield* options.forwardContact(yield* options.freshId, forwarded)
      );
    }

    if (request.method !== "POST") {
      return secure(
        new Response(null, { headers: { allow: "POST" }, status: 405 })
      );
    }

    return secure(
      Response.json(
        {
          error: {
            code: -32_001,
            message:
              "Initialize a legacy session or send stateless protocol headers",
          },
          id: null,
          jsonrpc: "2.0",
        },
        { status: 400 }
      )
    );
  },
  Effect.scoped,
  Effect.catchTags({
    EdgeFailure: (error) =>
      Effect.succeed(
        secure(
          new Response("Invalid or oversized request", { status: error.status })
        )
      ),
    TrustFailure: () =>
      Effect.succeed(
        secure(new Response("Invalid credential", { status: 401 }))
      ),
  })
);
