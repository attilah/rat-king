// @effect-diagnostics nodeBuiltinImport:off -- This adapter owns the loopback Node HTTP listener.
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, Redacted } from "effect";

import { readPrivateFile } from "./private-file.ts";
import { handleSlice, isSliceAuthorized } from "./slice-http.ts";
import { SliceError } from "./slice-source.ts";
import type { SliceSource } from "./slice-source.ts";
import { sqliteSliceSource } from "./slice-sqlite.ts";

const failure = () =>
  new SliceError({ reason: "Slice service failed.", status: 500 });

const body = (request: IncomingMessage) =>
  Effect.callback<string, SliceError>((resume) => {
    const parts: Buffer[] = [];
    let bytes = 0;
    request.on("data", (part: Buffer) => {
      bytes += part.length;

      if (bytes > 8192) {
        resume(
          Effect.fail(
            new SliceError({ reason: "Request exceeds limit.", status: 413 })
          )
        );
        request.pause();
      } else {
        parts.push(part);
      }
    });
    request.once("end", () => {
      resume(Effect.succeed(Buffer.concat(parts).toString("utf-8")));
    });
    request.once("error", () => {
      resume(Effect.fail(failure()));
    });
    request.once("aborted", () => {
      resume(Effect.fail(failure()));
    });
  });

const main = Effect.gen(function* main() {
  const database = yield* Config.String("SLICE_DATABASE");
  const tokenPath = yield* Config.String("SLICE_TOKEN_FILE");
  const port = yield* Config.Int("SLICE_PORT");
  const lookbackDays = yield* Config.Int("SLICE_COUNT_LOOKBACK_DAYS");

  if (port < 1024 || port > 65_535) {
    return yield* failure();
  }

  const tokenText = yield* readPrivateFile(tokenPath).pipe(
    Effect.mapError(failure)
  );

  if (
    tokenText.length < 32 ||
    Array.from(tokenText, (character) => character.codePointAt(0) ?? 0).some(
      (point) => point < 32
    )
  ) {
    return yield* failure();
  }

  const token = Redacted.make(tokenText);

  const serve = Effect.gen(function* serve() {
    const services = yield* Effect.context<SliceSource>();

    const run = Effect.runPromiseWith(services);

    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServer(
          { headersTimeout: 5000, maxHeaderSize: 8192, requestTimeout: 5000 },
          (request, response) => {
            const operation = Effect.gen(function* operation() {
              if (!isSliceAuthorized(request.headers.authorization, token)) {
                request.resume();

                return yield* handleSlice(
                  {
                    authorization: request.headers.authorization,
                    method: request.method ?? "",
                    url: request.url ?? "",
                  },
                  token
                );
              }

              const text = yield* body(request);

              return yield* handleSlice(
                {
                  authorization: request.headers.authorization,
                  body: text,
                  method: request.method ?? "",
                  url: request.url ?? "",
                },
                token
              );
            }).pipe(
              Effect.catchTag("SliceError", (error) =>
                Effect.succeed({
                  body: JSON.stringify({ error: error.reason }),
                  status: error.status,
                })
              )
            );

            void run(operation)
              .then((result) => {
                response.writeHead(result.status, {
                  "cache-control": "no-store",
                  "content-type": "application/json; charset=utf-8",
                  "x-content-type-options": "nosniff",
                });
                response.end(result.body);
              })
              .catch(() => {
                response.writeHead(500, {
                  "cache-control": "no-store",
                  "content-type": "application/json",
                });
                response.end('{"error":"Slice service failed."}');
              });
          }
        )
      ),
      (opened) =>
        Effect.callback<boolean>((resume) => {
          opened.closeAllConnections();
          opened.close(() => {
            resume(Effect.succeed(true));
          });
        })
    );

    yield* Effect.callback<boolean, SliceError>((resume) => {
      server.once("error", () => {
        resume(Effect.fail(failure()));
      });
      server.listen(port, "127.0.0.1", () => {
        resume(Effect.succeed(true));
      });
    });

    return yield* Effect.never;
  });

  return yield* serve.pipe(
    Effect.provide(sqliteSliceSource(database, lookbackDays))
  );
});

if (import.meta.main) {
  NodeRuntime.runMain(
    main.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
