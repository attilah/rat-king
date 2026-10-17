import { it } from "@effect/vitest";
import { TrustResult } from "@rat-king/lexicon/trust";
import { signatures } from "@rat-king/lexicon/webcrypto";
import { Arbitrary, Effect, Layer, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  credential,
  fixture,
  now,
} from "../../../packages/lexicon/test/trust-helpers.ts";
import { authorityFrom } from "../src/authority.ts";
import { handleEdge } from "../src/http.ts";
import { readOnlyTools } from "../src/policy.ts";
import { modernRequest, options, rpcReply } from "./http-helpers.ts";

const services = Layer.merge(signatures, authorityFrom());

const ToolList = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        annotations: Schema.Struct({
          destructiveHint: Schema.Boolean,
          readOnlyHint: Schema.Boolean,
        }),
        name: Schema.String,
      })
    ),
  }),
});

const IdentityReply = Schema.Struct({
  result: Schema.Struct({ structuredContent: TrustResult }),
});

it.effect.prop(
  "stateless requests list only read-only capabilities and never retain another request's credential",
  [Arbitrary.schema(Schema.Boolean)],
  ([reverse]) =>
    Effect.gen(function* statelessIsolation() {
      yield* TestClock.setTime(now);
      const sample = yield* fixture;
      const list = yield* handleEdge(modernRequest("tools/list"), options);
      expect(list.status).toBe(200);
      expect(list.headers.has("mcp-session-id")).toBe(false);

      const catalog = yield* Schema.decodeUnknownEffect(ToolList)(
        yield* rpcReply(list)
      );

      expect(catalog.result.tools.map((tool) => tool.name).toSorted()).toEqual(
        [...readOnlyTools].toSorted()
      );
      expect(
        catalog.result.tools.every(
          (tool) =>
            tool.annotations.readOnlyHint && !tool.annotations.destructiveHint
        )
      ).toBe(true);

      const bearer = `Bearer ${Base64Url.encode(JSON.stringify(credential(sample, false)))}`;
      const tokens = reverse ? [undefined, bearer] : [bearer, undefined];

      for (const token of tokens) {
        const response = yield* handleEdge(
          modernRequest("tools/call", { arguments: {}, name: "whoami" }, token),
          options
        );

        const result = yield* Schema.decodeUnknownEffect(IdentityReply)(
          yield* rpcReply(response)
        );

        expect(result.result.structuredContent.tier).toBe(
          token === undefined ? 0 : 1
        );
      }

      const blocked = yield* handleEdge(
        modernRequest("tools/call", { arguments: {}, name: "send" }),
        options
      );

      const rejection = yield* rpcReply(blocked);
      expect(JSON.stringify(rejection)).toContain("error");
    }).pipe(Effect.provide(services)),
  { arbitrary: { runs: 4 } }
);

const Refusal = Schema.Literals([
  "origin",
  "body",
  "rate",
  "credential",
  "media",
  "method-header",
]);

it.effect.prop(
  "the MCP boundary rejects cross-origin, oversized, rate-limited and malformed requests",
  [Arbitrary.schema(Refusal)],
  ([kind]) =>
    Effect.gen(function* admissionRefusals() {
      const request = modernRequest("tools/list");
      const headers = new Headers(request.headers);

      if (kind === "origin") {
        headers.set("origin", "https://untrusted.example.invalid");
      }

      if (kind === "credential") {
        headers.set("authorization", "Bearer not-a-credential");
      }

      if (kind === "media") {
        headers.set("content-type", "text/plain");
      }

      if (kind === "method-header") {
        headers.delete("mcp-method");
      }

      const body =
        kind === "body"
          ? "x".repeat(65_537)
          : yield* Effect.promise(request.text.bind(request));

      const response = yield* handleEdge(
        new Request(request.url, { body, headers, method: "POST" }),
        { ...options, limit: () => Effect.succeed(kind !== "rate") }
      );

      const statuses = {
        body: 413,
        credential: 401,
        media: 415,
        "method-header": 400,
        origin: 403,
        rate: 429,
      };

      expect(response.status).toBe(statuses[kind]);
    }).pipe(Effect.provide(services)),
  { arbitrary: { runs: 30 } }
);

it.effect.prop(
  "the Foldkit landing page and agent instructions describe the same closed mail boundary",
  [Arbitrary.schema(Schema.Literals(["/", "/llms.txt"]))],
  ([path]) =>
    Effect.gen(function* publicDiscovery() {
      const response = yield* handleEdge(
        new Request(`https://ratking.sh${path}`),
        options
      );

      const text = yield* Effect.promise(response.text.bind(response));
      expect(response.status).toBe(200);
      expect(text).toContain("https://ratking.sh/mcp");
      expect(text).toContain("read-only");
      expect(text).not.toMatch(/100\.\d+\.\d+\.\d+/u);

      if (path === "/") {
        expect(text).toContain("<!doctype html>");
      }
    }).pipe(Effect.provide(services)),
  { arbitrary: { runs: 4 } }
);
