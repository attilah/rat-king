/* oxlint-disable typescript/promise-function-async -- WebCrypto is a platform Promise adapter. */
import { Clock, Effect, Predicate, Schema, Stream } from "effect";
import type { HttpServerRequest } from "effect/http";
import { HttpServerResponse } from "effect/http";

import {
  Ack,
  AlertQueue,
  BillingFailure,
  BODY_LIMIT,
  IngressAuth,
  isJsonObject,
} from "./contracts.ts";

export const digest = (text: string) =>
  Effect.tryPromise({
    catch: () => new BillingFailure({ status: 503 }),
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  }).pipe(
    Effect.map((buffer) =>
      [...new Uint8Array(buffer)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    )
  );

export const readJson = Effect.fn("Billing.readJson")(function* readJson(
  request: HttpServerRequest.HttpServerRequest
) {
  const declared = request.headers["content-length"];

  if (declared !== undefined && Number(declared) > BODY_LIMIT) {
    return yield* Effect.fail(new BillingFailure({ status: 413 }));
  }

  let size = 0;
  const chunks: Uint8Array[] = [];
  yield* request.stream.pipe(
    Stream.runForEach((chunk) => {
      size += chunk.byteLength;

      if (size > BODY_LIMIT) {
        return Effect.fail(new BillingFailure({ status: 413 }));
      }

      chunks.push(chunk);

      return Effect.void;
    }),
    Effect.mapError((error) =>
      Predicate.isTagged(error, "BillingFailure")
        ? error
        : new BillingFailure({ status: 400 })
    )
  );
  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder().decode(bytes);

  const payload = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Json)
  )(text).pipe(Effect.mapError(() => new BillingFailure({ status: 400 })));

  return { payload, text };
});

export const alertKey = (payload: Schema.Json, text: string) => {
  if (isJsonObject(payload)) {
    for (const key of ["alert_id", "notification_id", "id"]) {
      const id = payload[key];

      if ((Predicate.isString(id) && id.length > 0) || Predicate.isNumber(id)) {
        return digest(`notification:${String(id)}`);
      }
    }
  }

  return digest(`body:${text}`);
};

export const handle = Effect.fn("Billing.handle")(
  function* handle(request: HttpServerRequest.HttpServerRequest) {
    const path = new URL(request.url, "https://invented.example").pathname;

    if (!["/", "/pull", "/ack"].includes(path)) {
      return HttpServerResponse.empty({ status: 404 });
    }

    const method = path === "/pull" ? "GET" : "POST";

    if (request.method !== method) {
      return HttpServerResponse.empty({
        headers: { allow: method },
        status: 405,
      });
    }

    const auth = yield* IngressAuth;

    const authorized =
      path === "/"
        ? yield* auth.webhook(request.headers["cf-webhook-auth"] ?? "")
        : yield* auth.pull(request.headers.authorization ?? "");

    if (!authorized) {
      return HttpServerResponse.empty({ status: 401 });
    }

    if (path === "/" && !(yield* auth.limit())) {
      return HttpServerResponse.empty({ status: 429 });
    }

    const queue = yield* AlertQueue;

    if (path === "/pull") {
      return HttpServerResponse.jsonUnsafe(yield* queue.pull(), {
        headers: { "cache-control": "no-store" },
      });
    }

    const { payload, text } = yield* readJson(request);

    if (path === "/ack") {
      const ack = yield* Schema.decodeUnknownEffect(Ack)(payload).pipe(
        Effect.mapError(() => new BillingFailure({ status: 400 }))
      );

      yield* queue.ack(ack.ids);
    } else {
      yield* queue.insert({
        id: yield* alertKey(payload, text),
        payload,
        receivedAt: yield* Clock.currentTimeMillis,
      });
    }

    return HttpServerResponse.empty({ status: 200 });
  },
  (effect) =>
    effect.pipe(
      Effect.catchTag("BillingFailure", ({ status }) =>
        Effect.succeed(HttpServerResponse.empty({ status }))
      )
    )
);
