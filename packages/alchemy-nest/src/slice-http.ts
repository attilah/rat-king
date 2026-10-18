// @effect-diagnostics nodeBuiltinImport:off -- The Node transport authenticates bearer digests with constant-time comparison.
import { createHash, timingSafeEqual } from "node:crypto";

import { Effect, Redacted, Schema } from "effect";

import { textDigest } from "./files.ts";
import {
  canonicalChunks,
  maxSliceBytes,
  SignatureSchema,
  SliceError,
  SliceSource,
} from "./slice-source.ts";
import type {
  ChunkPage,
  CountResult,
  QuoteResult,
  SliceResult,
} from "./slice-source.ts";

export interface SliceRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body?: string;
}

export interface SliceResponse {
  readonly status: number;
  readonly body: string;
}

type Payload =
  | SliceResult
  | QuoteResult
  | ChunkPage
  | CountResult
  | { readonly error: string };

const json = (status: number, payload: Payload): SliceResponse => ({
  body: JSON.stringify(payload),
  status,
});

const bounded = (payload: Payload): SliceResponse => {
  const response = json(200, payload);

  return Buffer.byteLength(response.body) > maxSliceBytes
    ? json(413, { error: "Response exceeds limit." })
    : response;
};

const authDigest = (value: string) =>
  createHash("sha256").update(value).digest();

export const isSliceAuthorized = (
  authorization: string | undefined,
  token: Redacted.Redacted
): boolean =>
  timingSafeEqual(
    authDigest(authorization ?? ""),
    authDigest(`Bearer ${Redacted.value(token)}`)
  );

const parameters = (
  query: URLSearchParams,
  names: readonly string[]
): boolean =>
  [...query.keys()].length === names.length &&
  names.every(
    (name) =>
      query.getAll(name).length === 1 &&
      (query.get(name)?.length ?? 0) > 0 &&
      (query.get(name)?.length ?? 0) <= 512
  );

const slice = Effect.fn("SliceHttp.slice")(function* slice(
  query: URLSearchParams
) {
  if (!parameters(query, ["conversation", "first", "last"])) {
    return json(400, { error: "Invalid chunk range." });
  }

  const conversation = query.get("conversation") ?? "";
  const first = query.get("first") ?? "";
  const last = query.get("last") ?? "";
  const source = yield* SliceSource;
  const chunks = yield* source.slice(conversation, first, last);

  return bounded({
    chunks,
    conversation,
    first,
    last,
    sha256: textDigest(canonicalChunks(chunks)),
  });
});

const quote = Effect.fn("SliceHttp.quote")(function* quote(
  query: URLSearchParams
) {
  if (
    !parameters(query, ["chunk", "start", "end"]) ||
    !["start", "end"].every((key) => /^\d+$/u.test(query.get(key) ?? ""))
  ) {
    return json(400, { error: "Invalid quote offsets." });
  }

  const chunk = query.get("chunk") ?? "";
  const start = Number(query.get("start"));
  const end = Number(query.get("end"));
  const source = yield* SliceSource;
  const text = yield* source.quote(chunk, start, end);

  return bounded({ chunk, end, sha256: textDigest(text), start, text });
});

const chunks = Effect.fn("SliceHttp.chunks")(function* chunks(
  query: URLSearchParams
) {
  if (
    !parameters(query, ["after", "limit", "idle_ms"]) ||
    !["after", "limit", "idle_ms"].every((key) =>
      /^\d+$/u.test(query.get(key) ?? "")
    )
  ) {
    return json(400, { error: "Invalid chunk cursor." });
  }

  const source = yield* SliceSource;

  return bounded(
    yield* source.chunks(
      Number(query.get("after")),
      Number(query.get("limit")),
      Number(query.get("idle_ms"))
    )
  );
});

const count = Effect.fn("SliceHttp.count")(function* count(
  request: SliceRequest,
  query: URLSearchParams
) {
  if (query.size !== 0 || Buffer.byteLength(request.body ?? "") > 8192) {
    return json(413, { error: "Count request exceeds limit." });
  }

  const input = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Struct({ signature: SignatureSchema }))
  )(request.body ?? "").pipe(
    Effect.mapError(
      () => new SliceError({ reason: "Invalid count signature.", status: 400 })
    )
  );

  const source = yield* SliceSource;

  return bounded(yield* source.count(input.signature));
});

const serve = Effect.fn("SliceHttp.serve")(function* serve(
  request: SliceRequest,
  token: Redacted.Redacted
) {
  if (!isSliceAuthorized(request.authorization, token)) {
    return json(401, { error: "Unauthorized." });
  }

  if (request.url.length > 2048) {
    return json(400, { error: "Invalid request." });
  }

  const url = yield* Effect.try({
    catch: () =>
      new SliceError({ reason: "Invalid request URL.", status: 400 }),
    try: () => new URL(request.url, "http://127.0.0.1"),
  });

  if (request.method !== (url.pathname === "/count" ? "POST" : "GET")) {
    return json(405, { error: "Method not allowed." });
  }

  switch (url.pathname) {
    case "/slice": {
      return yield* slice(url.searchParams);
    }

    case "/quote": {
      return yield* quote(url.searchParams);
    }

    case "/chunks": {
      return yield* chunks(url.searchParams);
    }

    case "/count": {
      return yield* count(request, url.searchParams);
    }

    default: {
      return json(404, { error: "Not found." });
    }
  }
});

export const handleSlice = (
  request: SliceRequest,
  token: Redacted.Redacted
): Effect.Effect<SliceResponse, never, SliceSource> =>
  serve(request, token).pipe(
    Effect.catchTag("SliceError", (failure) =>
      Effect.succeed(json(failure.status, { error: failure.reason }))
    )
  );
