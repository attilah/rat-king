import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import type { RestartSettings } from "../../../stacks/nest/ship-config.ts";
import { restartScript } from "../../../stacks/nest/ship-restart.ts";
import { localExec } from "../src/local-exec.ts";

const fixture = String.raw`#!/usr/bin/env python3
import json, os, pathlib, sys
path = pathlib.Path(os.environ['FIXTURE_STATE'])
value = json.loads(path.read_text())
if 'show' in sys.argv:
    if '--value' in sys.argv:
        backup = 'backup.invalid.service' in sys.argv
        print('active' if value.get('backup' if backup else 'busy') else 'inactive')
    else:
        print('ActiveState=active\nInvocationID='+value['id']+'\nRequires=store.invalid.service\nActiveEnterTimestampMonotonic='+str(value['enter'])+'\nActiveExitTimestampMonotonic='+str(value['exit']))
elif 'restart' in sys.argv:
    value.update(id='after',exit=1000000,enter=1000000+value['duration']*1000000)
    path.write_text(json.dumps(value))
`;

const run = Effect.fn("Test.shipGuard")(function* run(
  input: {
    age: number;
    hour: number;
    start?: number;
    end?: number;
    busy: boolean;
    backup?: boolean;
    override?: string;
    unrelated?: boolean;
    duration: number;
    cascade?: boolean;
    noop?: boolean;
  },
  mode: "probe" | "restart"
) {
  const fs = yield* FileSystem.FileSystem;

  const root = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "guard.invalid-" })
  );

  yield* fs.makeDirectory(`${root}/bin`);
  yield* fs.writeFileString(`${root}/bin/systemctl`, fixture);
  yield* fs.chmod(`${root}/bin/systemctl`, 0o700);
  yield* fs.writeFileString(
    `${root}/state.json`,
    JSON.stringify({
      backup: input.backup === true,
      busy: input.busy,
      duration: input.duration,
      enter: 1000,
      exit: 0,
      id: "before",
    })
  );
  const now = 1_577_836_800 + input.hour * 3600;
  const marker = `${root}/marker.json`;

  const seeded = JSON.stringify({
    phase: "done",
    sha: "b".repeat(40),
    started: now - input.age * 3600,
  });

  yield* fs.writeFileString(marker, seeded);

  let restart: typeof RestartSettings.Type = {
    backupUnit: "backup.invalid.service",
    lock: `${root}/backup.lock`,
    marker,
    unit: "cell.invalid.service",
    units: ["maintenance.invalid.service"],
  };

  if (input.start !== undefined && input.end !== undefined) {
    restart = {
      ...restart,
      window: { endHourUTC: input.end, startHourUTC: input.start },
    };
  }

  const base = {
    events: `${root}/events.jsonl`,
    restart,
    sha: "a".repeat(40),
  };

  const attempt =
    input.override === undefined ? base : { ...base, override: input.override };

  let unit =
    input.cascade === true ? "store.invalid.service" : "cell.invalid.service";

  if (input.unrelated === true) {
    unit = "other.invalid.service";
  }

  const prefix = `import time; time.time=lambda:${now}\n`;
  const exec = yield* localExec;

  const result = yield* exec.exec([
    "env",
    `PATH=${root}/bin:/usr/bin:/bin`,
    `FIXTURE_STATE=${root}/state.json`,
    "python3",
    "-c",
    prefix + restartScript,
    JSON.stringify(attempt),
    mode,
    "systemctl",
    "--user",
    input.noop === true ? "start" : "restart",
    unit,
  ]);

  return { ...result, marker: yield* fs.readFileString(marker), seeded };
});

const hour = Schema.Int.check(Schema.isBetween({ maximum: 23, minimum: 0 }));

it.live.prop(
  "restart policy defers, rather than fails, only outside its window, while maintenance is active or while a backup runs; a recent marker never defers",
  [
    Schema.Struct({
      age: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 0 })),
      backup: Schema.Boolean,
      busy: Schema.Boolean,
      end: hour,
      hour,
      start: hour,
    }),
  ],
  ([input]) =>
    Effect.scoped(
      Effect.gen(function* policy() {
        const result = yield* run({ ...input, duration: 0 }, "probe");

        const inWindow =
          input.start === input.end ||
          (input.start < input.end
            ? input.hour >= input.start && input.hour < input.end
            : input.hour >= input.start || input.hour < input.end);

        expect(result.code).toBe(
          inWindow && !input.busy && !input.backup ? 0 : 75
        );

        expect(result.marker).toBe(result.seeded);

        if (result.code === 75) {
          const next = yield* Schema.decodeEffect(
            Schema.fromJsonString(Schema.Struct({ retryAt: Schema.Number }))
          )(result.stdout);

          expect(next.retryAt).toBeGreaterThan(
            1_577_836_800 + input.hour * 3600
          );
        }
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 } }
);

it.live.prop(
  "restart receipts observe the entire target stopping-to-active interval, including dependency cascades; idempotent starts are not restarts",
  [
    Schema.Struct({
      cascade: Schema.Boolean,
      duration: Schema.Int.check(
        Schema.isBetween({ maximum: 120, minimum: 1 })
      ),
      noop: Schema.Boolean,
    }),
  ],
  ([input]) =>
    Effect.scoped(
      Effect.gen(function* observation() {
        const result = yield* run(
          { ...input, age: 12, busy: false, hour: 12 },
          "restart"
        );

        expect(result.code).toBe(0);

        const observed = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              code: Schema.Number,
              durationSeconds: Schema.Number,
              restarted: Schema.Boolean,
            })
          )
        )(result.stdout);

        expect(observed.restarted).toBe(!input.noop);
        expect(observed.durationSeconds).toBe(input.noop ? 0 : input.duration);
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 20 } }
);

it.live.prop(
  "a running backup refuses a restart with what failed, why and the next call; an override restarts and is recorded with its reason",
  [
    Schema.Struct({
      override: Schema.NonEmptyString,
      reason: Schema.Literals(["probe", "restart"]),
    }),
  ],
  ([input]) =>
    Effect.scoped(
      Effect.gen(function* backupRunning() {
        const base = {
          age: 12,
          backup: true,
          busy: false,
          duration: 1,
          hour: 12,
        };

        const refused = yield* run(base, input.reason);
        expect(refused.code).toBe(75);

        const deferral = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              reason: Schema.String,
              retryAt: Schema.Number,
            })
          )
        )(refused.stdout);

        expect(deferral.reason).toContain("backup is running");
        expect(deferral.reason).toContain("loses mail");
        expect(deferral.reason).toContain("RAT_KING_SHIP_RESTART_OVERRIDE");
        expect(deferral.retryAt).toBe(1_577_836_800 + 12 * 3600 + 60);
        expect(refused.marker).toBe(refused.seeded);

        const forced = yield* run(
          { ...base, override: input.override },
          input.reason
        );

        expect(forced.code).toBe(0);

        if (input.reason === "restart") {
          expect(JSON.parse(forced.stdout)).toMatchObject({
            override: input.override,
          });
        }
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 } }
);

it.live.prop(
  "only a ship restart of the target moves the marker: probes and unrelated commands leave it untouched",
  [Schema.Struct({ unrelated: Schema.Boolean })],
  ([input]) =>
    Effect.scoped(
      Effect.gen(function* markerOwnership() {
        const base = {
          age: 1,
          busy: false,
          duration: 1,
          hour: 12,
          unrelated: input.unrelated,
        };

        const probe = yield* run(base, "probe");
        expect(probe.marker).toBe(probe.seeded);

        const restart = yield* run(base, "restart");
        expect(restart.code).toBe(0);
        expect(restart.marker === restart.seeded).toBe(input.unrelated);
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 10 } }
);
