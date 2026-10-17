/* oxlint-disable effect-tests/no-manual-effect-runtime-in-tests, typescript/promise-function-async -- Async model commands run with the captured test context through Promise thunks. */
// @effect-diagnostics asyncFunction:off -- fast-check async commands drive the Effect alarm cycle with fixture ports.
import { it } from "@effect/vitest";
import { Effect, Match, Schema } from "effect";
import * as fc from "fast-check";
import { expect } from "vitest";

import { AlarmSettings } from "../../../stacks/nest/alarm-config.ts";
import type { AlarmFacts } from "../../../stacks/nest/alarm-sources.ts";
import {
  AlarmJournal,
  alarmCycle,
  emptyJournal,
} from "../../../stacks/nest/alarm.ts";
import type {
  AlarmJournalValue,
  AlarmPorts,
} from "../../../stacks/nest/alarm.ts";

const Step = Schema.Literals(["wake", "ack", "missing", "expired", "absent"]);

const Inputs = Schema.Struct({
  ackExpired: Schema.Boolean,
  steps: Schema.Array(Step).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(30)
  ),
  switchboard: Schema.Boolean,
});

const settings = Schema.decodeUnknownSync(AlarmSettings)({
  broadcast: "observer-invalid",
  enabled: false,
  launchd: {
    errorLog: "/fixture.invalid/err",
    label: "alarm.invalid",
    node: "node",
    outputLog: "/fixture.invalid/out",
    path: "/fixture.invalid/bin",
    source: "/fixture.invalid",
  },
  musterDesk: "desk-invalid",
  notify: {
    directory: "/fixture.invalid/directory.json",
    secret: "operator.invalid",
  },
  owners: {},
  page: { node: "node", script: "/fixture.invalid/page.mjs" },
});

interface Model {
  firing: boolean;
  paged: boolean;
}

interface Real {
  readonly step: (step: typeof Step.Type) => Promise<void>;
  readonly state: () => AlarmJournalValue;
  readonly pages: string[];
  readonly notices: {
    readonly recipients: readonly string[];
    readonly text: string;
  }[];
}

const command = (
  step: typeof Step.Type,
  switchboard: boolean
): fc.AsyncCommand<Model, Real> => ({
  check: () => true,
  run: async (model, real) => {
    const before = real.notices.length;

    await real.step(step);

    if (step === "wake") {
      model.firing = true;
      model.paged ||= switchboard;
    }

    if (step === "ack") {
      model.firing = false;
    }

    expect(real.state().alarms["wake.unacked"]?.value === "firing").toBe(
      model.firing
    );
    expect(real.pages).toHaveLength(model.paged ? 1 : 0);

    for (const notice of real.notices.slice(before)) {
      expect(notice.recipients).toContain("owner-invalid");
      expect(notice.text).toContain("wake.unacked");
    }
  },
  toString: () => step,
});

it.effect.prop(
  "wake alarm routes warn and clear to the owner, pages only switchboard via the existing page port, and never clears on missing or expired-lease evidence",
  [Inputs],
  ([input]) =>
    Effect.gen(function* model() {
      const run = Effect.runPromiseWith(yield* Effect.context());
      let journal = emptyJournal;
      let now = 1_000_000;
      const notices: Real["notices"] = [];
      const pages: string[] = [];

      const ports: AlarmPorts<never> = {
        page: (text) =>
          Effect.sync(() => {
            pages.push(text);
          }),
        prepare: (key, recipients, text) =>
          Effect.sync(() => {
            if (key === "wake.unacked") {
              notices.push({ recipients, text });
            }

            return [];
          }),
        save: () => Effect.void,
        send: () => Effect.void,
        unavailable: Effect.void,
      };

      const real: Real = {
        notices,
        pages,
        state: () => journal,
        step: async (step) => {
          now += 1000;

          const health = {
            complete: true,
            lastAck: null,
            lease: {
              expiresAt:
                step === "expired" || (step === "ack" && input.ackExpired)
                  ? now
                  : now + 60_000,
              generation: 1,
              holder: "fixture",
              pane: null,
            },
            oldestWake:
              step === "ack"
                ? null
                : {
                    at: now - 181_000,
                    id: "3m7x2ka4xv22a",
                    sender: "sender-invalid",
                  },
            quietUnacked: 0,
          };

          const facts: typeof AlarmFacts.Type = {
            cacheBreaches: [],
            deploy: null,
            deployKnown: true,
            digest: "ok",
            doctor: true,
            entered: null,
            health: 200,
            measurementFailed: false,
            quarantinedHour: 0,
            readers: null,
            receipts: [],
            receiptsKnown: true,
            slots: { free: 100, max: 100 },
            wakes: Match.value(step).pipe(
              Match.when("missing", () => null),
              Match.when("absent", () => []),
              Match.orElse(() => [
                {
                  health,
                  name: input.switchboard ? "switchboard" : "sample/worker",
                  owner: "owner-invalid",
                },
              ])
            ),
          };

          journal = await run(
            alarmCycle(journal, facts, now, settings, ports).pipe(
              Effect.flatMap(
                Schema.encodeEffect(Schema.fromJsonString(AlarmJournal))
              ),
              Effect.flatMap(
                Schema.decodeEffect(Schema.fromJsonString(AlarmJournal))
              )
            )
          );
        },
      };

      yield* Effect.promise(() =>
        fc.asyncModelRun(
          () => ({ model: { firing: false, paged: false }, real }),
          input.steps.map((step) => command(step, input.switchboard))
        )
      );
    })
);
