import { Effect, Schema } from "effect";

import type { EdgeOptions } from "../src/http.ts";

export const externalId = "12345678-1234-4234-8234-123456789abc";

export const options: EdgeOptions = {
  desk: "lobby",
  forwardContact: () => Effect.die(new Error("Unexpected contact forwarding")),
  freshId: Effect.succeed(externalId),
  limit: () => Effect.succeed(true),
};

export const modernRequest = (
  method: string,
  params: Schema.JsonObject = {},
  authorization?: string
) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-protocol-version": "2026-07-28",
  });

  if (method === "tools/call" && params.name !== undefined) {
    headers.set(
      "mcp-name",
      Schema.decodeUnknownSync(Schema.String)(params.name)
    );
  }

  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }

  return new Request("https://ratking.sh/mcp", {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params: {
        ...Object.fromEntries(Object.entries(params)),
        _meta: {
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "example",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        },
      },
    }),
    headers,
    method: "POST",
  });
};

export const rpcReply = Effect.fn("Test.rpcReply")(function* decodeReply(
  response: Response
) {
  const text = yield* Effect.promise(response.text.bind(response));

  const payload = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .flatMap((line) => (line.startsWith("data: ") ? [line.slice(6)] : []))
        .at(-1) ?? "");

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
    payload
  );
});

export const legacyRequest = (method: string, version = "2025-11-25") =>
  new Request("https://ratking.sh/mcp", {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params:
        method === "initialize"
          ? {
              capabilities: {},
              clientInfo: { name: "example", version: "1.0.0" },
              protocolVersion: version,
            }
          : { arguments: {}, name: "whoami" },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": version,
    },
    method: "POST",
  });
