import { Failure } from "@rat-king/remembers";
import type { DefectValue, SliceKeyValue } from "@rat-king/remembers";
import { Effect, Option, Schema, Stream } from "effect";

export const promisedResponse = Promise.resolve.bind(Promise)<Response>;

export interface SourceOptions {
  readonly baseUrl: string;
  readonly bearer: string;
  readonly dayEnd: number;
  readonly dayStart: number;
  readonly idleMs: number;
  readonly transport: typeof fetch;
}

const Metadata = Schema.Struct({
  chunk_id: Schema.NonEmptyString,
  conversation: Schema.NonEmptyString,
  role: Schema.String,
  rowid: Schema.Int.check(Schema.isGreaterThan(0)),
  started_at: Schema.Int,
  token_count: Schema.Int,
});

const Window = Schema.Struct({
  items: Schema.Array(Metadata),
  next: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const responseJson = Effect.fn("RemembersHost.response")(
  function* responseJson(response: Response) {
    if (!response.ok) {
      return yield* new Failure({
        code: String(response.status),
        operation: "http",
      });
    }

    return yield* Effect.tryPromise({
      catch: () => new Failure({ code: "json", operation: "http" }),
      try: response.json.bind(response),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
      Effect.mapError(
        () => new Failure({ code: "response", operation: "http" })
      )
    );
  }
);

export const fetchJson = Effect.fn("RemembersHost.fetch")(function* fetchJson(
  options: Pick<SourceOptions, "baseUrl" | "bearer" | "transport">,
  path: string,
  init?: RequestInit
) {
  const response = yield* Effect.tryPromise({
    catch: () => new Failure({ code: "transport", operation: "http" }),
    try: options.transport.bind(null, new URL(path, options.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${options.bearer}`,
        "content-type": "application/json",
      },
    }),
  });

  return yield* responseJson(response);
});

export const cursorJob = (options: SourceOptions) =>
  Effect.fn("RemembersHost.cursor")(function* readCursor(cursor: string) {
    const initial = cursor === "" ? 0 : Number(cursor);

    if (!Number.isSafeInteger(initial) || initial < 0 || options.idleMs < 1) {
      return yield* new Failure({ code: "cursor", operation: "chunks" });
    }

    let next = initial;
    const keys = new Map<string, SliceKeyValue>();
    yield* Stream.paginate(initial, (after) =>
      Effect.gen(function* window() {
        const params = new URLSearchParams({
          after: String(after),
          idle_ms: String(options.idleMs),
          limit: "2000",
        });

        const body = yield* fetchJson(
          options,
          `/chunks?${params.toString()}`
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Window)),
          Effect.mapError(
            () => new Failure({ code: "window", operation: "chunks" })
          )
        );

        let previous = after;

        for (const item of body.items) {
          if (item.rowid <= previous) {
            return yield* new Failure({ code: "order", operation: "chunks" });
          }

          previous = item.rowid;
        }

        if (body.next !== previous) {
          return yield* new Failure({ code: "next", operation: "chunks" });
        }

        const stop = body.items.findIndex(
          (item) => item.started_at >= options.dayEnd
        );

        const prefix = stop === -1 ? body.items : body.items.slice(0, stop);
        next = prefix.at(-1)?.rowid ?? after;

        for (const item of prefix) {
          if (item.started_at < options.dayStart) {
            continue;
          }

          const first =
            keys.get(item.conversation)?.first_chunk ?? item.chunk_id;

          keys.set(item.conversation, {
            conversation: item.conversation,
            first_chunk: first,
            last_chunk: item.chunk_id,
          });
        }

        return [
          [],
          stop === -1 && body.next > after
            ? Option.some(body.next)
            : Option.none<number>(),
        ] as const;
      })
    ).pipe(Stream.runDrain);

    return { cursor: String(next), keys: [...keys.values()] };
  });

export const defectCountJob = (
  options: Pick<SourceOptions, "baseUrl" | "bearer" | "transport">
) =>
  Effect.fn("RemembersHost.defectCount")(function* defectCount(
    defect: DefectValue,
    since: number
  ) {
    const signature =
      defect.signature.role === null
        ? { literal: defect.signature.literal, since_ms: since }
        : {
            literal: defect.signature.literal,
            role: defect.signature.role,
            since_ms: since,
          };

    const result = yield* fetchJson(options, "/count", {
      body: JSON.stringify({ signature }),
      method: "POST",
    }).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            conversations: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          })
        )
      ),
      Effect.mapError(
        () => new Failure({ code: "count", operation: "defectCount" })
      )
    );

    return result.conversations;
  });
