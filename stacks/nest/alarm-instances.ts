import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import type { AlarmSettingsValue } from "./alarm-config.ts";
import type { InstanceHealth } from "./alarm-sources.ts";
import { FleetError } from "./stage-config.ts";

const Version = Schema.Struct({
  commit: Schema.String,
  version: Schema.String,
});

const probeInstance = Effect.fn("Alarm.probeInstance")(
  function* probeInstance(
    instance: NonNullable<AlarmSettingsValue["instances"]>[number]
  ) {
    const response = yield* HttpClient.get(instance.versionUrl).pipe(
      Effect.mapError(() => new FleetError({ reason: "transport error" }))
    );

    if (response.status !== 200) {
      return yield* new FleetError({ reason: `HTTP ${response.status}` });
    }

    yield* HttpClientResponse.schemaBodyJson(Version)(response).pipe(
      Effect.mapError(
        () => new FleetError({ reason: "invalid version response" })
      )
    );

    return instance.page === true
      ? { name: instance.name, page: true, status: "ok" as const }
      : { name: instance.name, status: "ok" as const };
  },
  (
    effect,
    instance
  ): Effect.Effect<typeof InstanceHealth.Type, never, HttpClient.HttpClient> =>
    effect.pipe(
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "manual",
      }),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () =>
          Effect.fail(new FleetError({ reason: "probe timed out" })),
      }),
      Effect.match({
        onFailure: (error) =>
          instance.page === true
            ? {
                name: instance.name,
                page: true,
                reason: error.reason,
                status: "down" as const,
              }
            : {
                name: instance.name,
                reason: error.reason,
                status: "down" as const,
              },
        onSuccess: (reading) => reading,
      })
    )
);

export const collectInstanceHealth = Effect.fn("Alarm.collectInstanceHealth")(
  (instances: AlarmSettingsValue["instances"]) =>
    Effect.forEach(instances ?? [], probeInstance, { concurrency: "unbounded" })
);
