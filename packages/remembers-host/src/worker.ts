import { CanonSource, Failure, Store } from "@rat-king/remembers";
import { sliceHttp } from "@rat-king/remembers/slices";
import { composeWorker } from "@rat-king/remembers/worker";
import { Effect, Function as Fn, Layer, Schema } from "effect";

import { safeWorkerReport, validateSubmission } from "./plans.ts";
import { promisedResponse, responseJson } from "./source-jobs.ts";

export interface WorkerEnvironment {
  readonly MISCHIEF_MODEL: string;
  readonly REMEMBERS_CANON_JSON: string;
  readonly REMEMBERS_SLICE_BEARER: string;
  readonly REMEMBERS_SLICE_URL: string;
}

const unavailable = () =>
  Effect.fail(new Failure({ code: "supervisor_only", operation: "worker" }));

const store = Layer.succeed(
  Store,
  Store.of({
    commit: unavailable,
    cursor: unavailable,
    defects: unavailable,
    finish: unavailable,
    fired: unavailable,
    markFired: unavailable,
    owed: unavailable,
    search: unavailable,
    start: unavailable,
    use: unavailable,
  })
);

const normalize = (text: string) =>
  text.trim().toLowerCase().replaceAll(/\s+/gu, " ");

const unavailableError = () =>
  new Failure({ code: "unsafe_request", operation: "worker" });

const checkRequest = Effect.fn("RemembersHost.checkRequest")(
  function* checkRequest(request: Request) {
    const path = new URL(request.url).pathname;

    if (request.method === "GET" && path === "/.well-known/rat-king/version") {
      return yield* Effect.void;
    }

    if (
      request.method !== "POST" ||
      (path !== "/submitPlan" && path !== "/inspectRun")
    ) {
      return yield* new Failure({ code: "unsupported", operation: "worker" });
    }

    const copy = request.clone();

    const text = yield* Effect.tryPromise({
      catch: unavailableError,
      try: copy.text.bind(copy),
    });

    if (text.length > 1_048_576) {
      return yield* unavailableError();
    }

    const input = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.Json)
    )(text).pipe(Effect.mapError(unavailableError));

    return yield* path === "/submitPlan"
      ? validateSubmission(input).pipe(Effect.asVoid)
      : Schema.decodeUnknownEffect(
          Schema.Struct({ runId: Schema.NonEmptyString }),
          { onExcessProperty: "error" }
        )(input).pipe(Effect.asVoid, Effect.mapError(unavailableError));
  }
);

const projectResponse = Effect.fn("RemembersHost.projectResponse")(
  function* projectResponse(request: Request, response: Response) {
    if (new URL(request.url).pathname === "/.well-known/rat-king/version") {
      return response;
    }

    if (!response.ok) {
      return Response.json(
        { error: "Worker call failed" },
        { status: response.status }
      );
    }

    const report = yield* responseJson(response).pipe(
      Effect.flatMap(safeWorkerReport)
    );

    return Response.json(report);
  }
);

export const createHostWorker = Effect.fn("RemembersHost.createWorker")(
  function* createHostWorker(environment: WorkerEnvironment) {
    if (environment.MISCHIEF_MODEL === "faux") {
      return yield* unavailableError();
    }

    const canon = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Schema.NonEmptyArray(Schema.NonEmptyString))
    )(environment.REMEMBERS_CANON_JSON).pipe(Effect.mapError(unavailableError));

    const source = sliceHttp({
      baseUrl: environment.REMEMBERS_SLICE_URL,
      bearer: environment.REMEMBERS_SLICE_BEARER,
      defectCount: unavailable,
      page: unavailable,
      transport: fetch,
    });

    const canonSource = Layer.succeed(
      CanonSource,
      CanonSource.of({
        loaded: () => Effect.succeed(canon),
        states: (claim, loaded) =>
          Effect.succeed(
            loaded.some((text) =>
              normalize(text).includes(normalize(claim.sentence))
            )
          ),
      })
    );

    const worker = yield* composeWorker.pipe(
      Effect.provide([source, store, canonSource])
    );

    const delegate = worker.default.fetch;

    if (delegate === undefined) {
      return yield* unavailableError();
    }

    const services = yield* Effect.context();

    const handler: ExportedHandler = {
      fetch: Fn.flow(
        (request, bindings, context) =>
          checkRequest(request).pipe(
            Effect.flatMap(() =>
              Effect.tryPromise({
                catch: unavailableError,
                try: Fn.flow(
                  delegate.bind(worker.default, request, bindings, context),
                  promisedResponse
                ),
              })
            ),
            Effect.flatMap((response) => projectResponse(request, response)),
            Effect.orElseSucceed(() =>
              Response.json({ error: "Request refused" }, { status: 400 })
            )
          ),
        Effect.runPromiseWith(services)
      ),
    };

    return { ...worker, default: handler };
  }
);
