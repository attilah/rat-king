import { it } from "@effect/vitest";
import { Arbitrary, ConfigProvider, Effect, Schema } from "effect";
import { expect } from "vitest";

import { AlarmSettings } from "../../../stacks/nest/alarm-config.ts";
import type { AlarmSettingsValue } from "../../../stacks/nest/alarm-config.ts";
import { readerCrashSources } from "../../../stacks/nest/turn-crashes.ts";
import { resolveTurnRecords } from "../src/config.ts";
import type { PiConfigValue } from "../src/config.ts";

const Case = Schema.Struct({
  configured: Schema.optionalKey(Schema.Boolean),
  override: Schema.optionalKey(Schema.Literals(["0", "1"])),
});

interface FlagEnv {
  readonly RATKING_TURN_RECORDS?: string;
}

it.effect.prop(
  "automatic turns default off, config opts in and explicit 1 or 0 overrides config",
  [Arbitrary.schema(Case)],
  ([sample]) =>
    Effect.gen(function* proof() {
      const config: Pick<PiConfigValue, "turnRecords"> = {};
      const env: FlagEnv = {};

      if (sample.configured !== undefined) {
        Object.assign(config, { turnRecords: sample.configured });
      }

      if (sample.override !== undefined) {
        Object.assign(env, { RATKING_TURN_RECORDS: sample.override });
      }

      const actual = yield* resolveTurnRecords(config).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
      );

      const expected =
        sample.override === undefined
          ? (sample.configured ?? false)
          : sample.override === "1";

      expect(actual).toBe(expected);
    })
);

it.effect.prop(
  "malformed turn-record overrides fail closed rather than enabling writes",
  [Arbitrary.schema(Schema.Literals(["true", "false", "yes", "2"]))],
  ([override]) =>
    Effect.gen(function* proof() {
      const failure = yield* resolveTurnRecords({ turnRecords: true }).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ RATKING_TURN_RECORDS: override })
          )
        ),
        Effect.flip
      );

      expect(failure._tag).toBe("NotConfigured");
    })
);

it.prop(
  "operator crashes do not even select heartbeat sources unless explicitly enabled",
  [Arbitrary.schema(AlarmSettings)],
  ([sample]) => {
    const alarm: AlarmSettingsValue = {
      ...sample,
      readerHeartbeats: [{ dir: "/sample/readers", host: "host-invalid" }],
    };

    expect(readerCrashSources({})).toBeUndefined();
    expect(readerCrashSources({ alarm })).toEqual(
      sample.turnRecords === true ? alarm.readerHeartbeats : undefined
    );
  }
);
