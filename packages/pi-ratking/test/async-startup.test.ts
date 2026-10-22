import { createEventBus } from "@earendil-works/pi-coding-agent";
// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary under test.
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  Arbitrary,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schedule,
  Schema,
} from "effect";
import { expect } from "vitest";

import { ratkingExtension } from "../src/extension.ts";
import type { PiHost, SessionStart } from "../src/extension.ts";
import { IDENTITY_FOOTER, STARTING_FOOTER } from "../src/tool.ts";
import { fakeMailbox, quietSocket } from "./fake-mailbox.ts";
import { harness } from "./harness.ts";

const until = (ready: () => boolean) =>
  Effect.sync(ready).pipe(
    Effect.repeat({
      schedule: Schedule.spaced("5 millis"),
      until: (done) => done,
    })
  );

const Starts = Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 }));

interface Recorded {
  readonly statuses: (string | undefined)[];
  readonly warnings: string[];
}

it.live.prop(
  "session_start returns at once while the runtime builds, the footer walks its states in order, and only the newest of rapid starts runs a reader",
  [Arbitrary.schema(Starts)],
  ([starts]) =>
    Effect.gen(function* asyncStartup() {
      const fs = yield* FileSystem.FileSystem;
      const state = yield* fs.makeTempDirectoryScoped();
      const mailbox = fakeMailbox("accept");
      const gate = yield* Deferred.make<boolean>();

      const layer = Layer.effectDiscard(Deferred.await(gate)).pipe(
        Layer.provideMerge(harness(state, mailbox.http)),
        Layer.provideMerge(quietSocket)
      );

      const host = {
        end: Option.none<() => Promise<void>>(),
        start: Option.none<(start: SessionStart) => Promise<void>>(),
      };

      const pi: PiHost = {
        events: createEventBus(),
        onSessionEnd: (handler) => {
          host.end = Option.some(handler);
        },
        onSessionStart: (handler) => {
          host.start = Option.some(handler);
        },
        registerMessageRenderer: () => {},
        registerTool: () => {},
        sendMessage: () => {},
      };

      yield* Effect.promise(async () => {
        await ratkingExtension({
          facts: (session) =>
            Effect.succeed({
              alive: () => false,
              env: Option.some("tester"),
              pane: Option.none(),
              pid: 1,
              session,
            }),
          layer,
          tool: Effect.succeed("ratking"),
        })(pi);
      });

      const start = yield* Effect.fromOption(host.start);

      yield* Effect.addFinalizer(() =>
        Option.match(host.end, {
          onNone: () => Effect.void,
          onSome: (end) => Effect.promise(end),
        })
      );

      const runs: Recorded[] = [];

      for (let index = 0; index < starts; index += 1) {
        const recorded: Recorded = { statuses: [], warnings: [] };

        runs.push(recorded);

        const returned = yield* Effect.promise(async () => {
          await start({
            session: `startup-${index}`,
            status: (text) => {
              recorded.statuses.push(text);
            },
            warn: (message) => {
              recorded.warnings.push(message);
            },
          });
        }).pipe(Effect.timeoutOption("100 millis"));

        expect(Option.isSome(returned)).toBe(true);
      }

      const [newest] = runs.slice(-1);

      if (newest === undefined) {
        return;
      }

      yield* until(() => newest.statuses.includes(IDENTITY_FOOTER));
      yield* Effect.sleep("30 millis");

      expect(newest.statuses).toStrictEqual([STARTING_FOOTER, IDENTITY_FOOTER]);
      expect(mailbox.calls).toHaveLength(0);

      const superseded = runs.slice(0, -1).map((run) => [...run.statuses]);

      yield* Deferred.succeed(gate, true);
      yield* until(() => newest.statuses.at(-1) === undefined);
      yield* Effect.sleep("50 millis");

      expect(newest.statuses.slice(0, 2)).toStrictEqual([
        STARTING_FOOTER,
        IDENTITY_FOOTER,
      ]);
      expect(newest.statuses).toContain("🐀 acquiring tester");
      expect(newest.statuses.indexOf("🐀 acquiring tester")).toBeLessThan(
        newest.statuses.length - 1
      );
      expect(
        mailbox.calls.filter((nsid) => nsid.endsWith(".acquireLease"))
      ).toHaveLength(1);
      expect(runs.slice(0, -1).map((run) => run.statuses)).toStrictEqual(
        superseded
      );

      for (const statuses of superseded) {
        expect(
          [STARTING_FOOTER, IDENTITY_FOOTER].slice(0, statuses.length)
        ).toStrictEqual(statuses);
      }

      expect(runs.flatMap((run) => run.warnings)).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 8 }, timeout: 120_000 }
);
