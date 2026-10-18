import { Effect, Layer, Schema } from "effect";

import { codePoints } from "../src/code-points.ts";
import { Failure, SliceSource } from "../src/contract.ts";
import type { DefectValue, Job, Page } from "../src/contract.ts";
import { sha256 } from "../src/pipeline.ts";

const WireSlice = Schema.Struct({
  chunks: Schema.Array(
    Schema.Struct({
      chunk_id: Schema.String,
      role: Schema.String,
      started_at: Schema.String,
      text: Schema.String,
    })
  ),
  conversation: Schema.String,
  first: Schema.String,
  last: Schema.String,
  sha256: Schema.String,
});

const WireQuote = Schema.Struct({
  chunk: Schema.String,
  end: Schema.Int,
  sha256: Schema.String,
  start: Schema.Int,
  text: Schema.String,
});

export interface SliceHttpConfig {
  readonly baseUrl: string;
  readonly bearer: string;
  readonly defectCount: (defect: DefectValue, since: number) => Job<number>;
  readonly page: (cursor: string) => Job<typeof Page.Type>;
  readonly transport: typeof globalThis.fetch;
}

const request = Effect.fn("Remembers.http.request")(function* request(
  config: SliceHttpConfig,
  path: string,
  params: Record<string, string>
) {
  const url = new URL(path, config.baseUrl);
  url.search = new URLSearchParams(params).toString();

  return yield* Effect.tryPromise({
    catch: () => new Failure({ code: "transport", operation: "slice_http" }),
    try: config.transport.bind(null, url, {
      headers: { authorization: `Bearer ${config.bearer}` },
    }),
  });
});

const decodeResponse = <A>(
  response: Response,
  schema: Schema.Codec<A>
): Job<A> => {
  if (!response.ok) {
    return Effect.fail(
      new Failure({ code: String(response.status), operation: "slice_http" })
    );
  }

  return Effect.tryPromise({
    catch: () => new Failure({ code: "json", operation: "slice_http" }),
    try: response.json.bind(response),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      () => new Failure({ code: "response", operation: "slice_http" })
    )
  );
};

export const sliceHttp = (config: SliceHttpConfig) =>
  Layer.succeed(
    SliceSource,
    SliceSource.of({
      defectCount: config.defectCount,
      page: config.page,
      quote: Effect.fn("Remembers.http.quote")(function* quote(cite) {
        const response = yield* request(config, "/quote", {
          chunk: cite.chunk_id,
          end: String(cite.end),
          start: String(cite.start),
        });

        if (response.status === 404) {
          return null;
        }

        const body = yield* decodeResponse(response, WireQuote);

        if (
          body.chunk !== cite.chunk_id ||
          body.start !== cite.start ||
          body.end !== cite.end ||
          body.sha256 !== cite.sha256 ||
          (yield* sha256(body.text)) !== cite.sha256
        ) {
          return yield* new Failure({ code: "cite_stale", operation: "quote" });
        }

        return body.text;
      }),
      read: Effect.fn("Remembers.http.read")(function* read(key) {
        const response = yield* request(config, "/slice", {
          conversation: key.conversation,
          first: key.first_chunk,
          last: key.last_chunk,
        });

        const body = yield* decodeResponse(response, WireSlice);

        if (
          body.conversation !== key.conversation ||
          body.first !== key.first_chunk ||
          body.last !== key.last_chunk
        ) {
          return yield* new Failure({ code: "wrong_slice", operation: "read" });
        }

        return {
          chunks: body.chunks.map((chunk) => ({
            id: chunk.chunk_id,
            role: chunk.role,
            text: codePoints(chunk.text)
              .slice(0, chunk.role === "tool" ? 700 : 4000)
              .join(""),
          })),
          key,
        };
      }),
    })
  );
