import { Failure } from "@rat-king/remembers";
import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";

import { createHostWorker } from "./worker.ts";

const worker = await Effect.runPromise(
  Schema.decodeUnknownEffect(
    Schema.Struct({
      MISCHIEF_MODEL: Schema.NonEmptyString,
      REMEMBERS_CANON_JSON: Schema.NonEmptyString,
      REMEMBERS_SLICE_BEARER: Schema.NonEmptyString,
      REMEMBERS_SLICE_URL: Schema.NonEmptyString,
    })
  )(env).pipe(
    Effect.mapError(
      () => new Failure({ code: "worker_config", operation: "startup" })
    ),
    Effect.flatMap(createHostWorker)
  )
);

export const { PlanRun } = worker;

export const { Postbox } = worker;

export const { Schedule } = worker;

export const { ServiceTokenLedger } = worker;

export default worker.default;
