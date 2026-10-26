import { it } from "@effect/vitest";
import type { ReaderHeartbeatValue } from "@rat-king/ratking-client/reader-health";
import {
  Arbitrary,
  Clock,
  DateTime,
  Duration,
  Effect,
  Logger,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  AlarmRefused,
  terminalRefusal,
} from "../../../stacks/nest/alarm-mail.ts";
import { crashedReader } from "../../../stacks/nest/turn-crash-record.ts";
import {
  CrashJournal,
  crashBackoffMs,
  crashCycle,
} from "../../../stacks/nest/turn-crashes.ts";
import type {
  CrashJournalValue,
  CrashNotice,
  CrashPorts,
} from "../../../stacks/nest/turn-crashes.ts";

interface Sealed {
  readonly to: string;
}

const heartbeat: ReaderHeartbeatValue = {
  acquisitionSince: DateTime.makeUnsafe(0),
  generation: 1,
  lastConsumeOk: null,
  lastError: null,
  leaseHeldSince: null,
  leaseTtlMs: 300_000,
  leaseUntil: DateTime.makeUnsafe(300_000),
  name: "worker",
  owner: "drovr/old",
  pid: 1,
  session: "session",
  startedAt: DateTime.makeUnsafe(0),
  state: "Live",
  updatedAt: DateTime.makeUnsafe(0),
};

const crash = (): CrashNotice => {
  const record = crashedReader(heartbeat, 300_000);

  if (record === undefined) {
    throw new Error("Fixture reader did not crash");
  }

  return { owner: "drovr/old", record };
};

const empty: CrashJournalValue<Sealed> = {
  pending: [],
  sent: [],
  version: "0.1",
};

const tenMinutes = 600_000;

const Names = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9/-]{0,11}$/u));

const harness = (
  refuse: (to: string) => AlarmRefused | "accept" | "transient"
) => {
  const attempts: { readonly at: number; readonly to: string }[] = [];
  const readdressed: string[] = [];
  const lines: string[] = [];
  let journal = empty;

  const ports: CrashPorts<Sealed, string, never> = {
    prepare: (notice) => Effect.succeed({ to: notice.owner }),
    readdress: (_notice, successor) =>
      Effect.sync(() => {
        readdressed.push(successor);

        return { to: successor };
      }),
    save: (next) =>
      Effect.sync(() => {
        journal = next;
      }),
    send: (delivery) =>
      Effect.gen(function* send() {
        attempts.push({
          at: yield* Clock.currentTimeMillis,
          to: delivery.to,
        });
        const outcome = refuse(delivery.to);

        if (outcome === "transient") {
          return yield* Effect.fail("connection reset");
        }

        if (outcome !== "accept") {
          return yield* outcome;
        }

        return yield* Effect.void;
      }),
  };

  const capture = Logger.layer([
    Logger.make(({ message }) => {
      lines.push((Array.isArray(message) ? message : [message]).join(" "));
    }),
  ]);

  return {
    attempts,
    capture,
    journal: () => journal,
    lines,
    ports,
    readdressed,
  };
};

it.effect.prop(
  "a retired recipient with a successor is re-addressed once and then delivered",
  [Arbitrary.schema(Names)],
  ([successor]) =>
    Effect.gen(function* proof() {
      const h = harness((to) =>
        to === "drovr/old"
          ? new AlarmRefused({ code: "Retired", successor })
          : "accept"
      );

      for (let pass = 0; pass < 3; pass += 1) {
        yield* crashCycle([crash()], h.journal(), h.ports);
      }

      expect(h.readdressed).toEqual([successor]);
      expect(h.attempts.map((attempt) => attempt.to)).toEqual([
        "drovr/old",
        successor,
      ]);
      expect(h.journal().pending).toEqual([]);
      expect(h.journal().sent).toHaveLength(1);
      expect(h.journal().dropped ?? []).toEqual([]);
    }).pipe(Effect.provide(Logger.layer([])))
);

it.effect.prop(
  "a refusal with no successor, or a successor that refuses too, drops the notice with a reason after at most one re-address",
  [
    Arbitrary.schema(Names),
    Arbitrary.schema(Schema.Literals(["Retired", "UnknownName"])),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([successor, code, offered]) =>
    Effect.gen(function* proof() {
      const h = harness(() =>
        offered
          ? new AlarmRefused({ code, successor })
          : new AlarmRefused({ code })
      );

      for (let pass = 0; pass < 4; pass += 1) {
        yield* crashCycle([crash()], h.journal(), h.ports).pipe(
          Effect.provide(h.capture)
        );
      }

      expect(h.readdressed).toEqual(offered ? [successor] : []);
      expect(h.attempts).toHaveLength(offered ? 2 : 1);
      expect(h.journal().pending).toEqual([]);
      expect(h.journal().sent).toHaveLength(1);
      expect(h.journal().dropped).toHaveLength(1);
      expect(h.journal().dropped?.[0]?.reason).toContain(code);
      expect(h.lines.filter((line) => line.includes("dropped"))).toHaveLength(
        1
      );
    }).pipe(Effect.provide(Logger.layer([])))
);

it.effect.prop(
  "a transient failure retries on the jittered exponential schedule capped at ten minutes and logs one line",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 14, minimum: 3 }))
    ),
  ],
  ([failures]) =>
    Effect.gen(function* proof() {
      let failing = failures;

      const h = harness(() => {
        failing -= 1;

        return failing >= 0 ? "transient" : "accept";
      });

      for (
        let at = 0;
        (at < 86_400_000 && h.journal().pending.length > 0) || at === 0;
        at += 2000
      ) {
        yield* crashCycle([crash()], h.journal(), h.ports).pipe(
          Effect.provide(h.capture)
        );
        yield* TestClock.adjust(Duration.millis(2000));
      }

      expect(h.attempts).toHaveLength(failures + 1);
      expect(h.journal().pending).toEqual([]);

      for (const [index, attempt] of h.attempts
        .slice(1, failures + 1)
        .entries()) {
        const gap = attempt.at - (h.attempts[index]?.at ?? 0);
        const top = Math.min(tenMinutes, 2000 * 2 ** index);

        expect(gap).toBeGreaterThanOrEqual(top / 2);
        expect(gap).toBeLessThanOrEqual(top + 2000);
      }

      expect(
        h.lines.filter((line) => line.includes("send failed"))
      ).toHaveLength(1);
      expect(h.lines.filter((line) => line.includes("delivered"))).toHaveLength(
        1
      );
    }),
  { timeout: 60_000 }
);

it.effect.prop(
  "the backoff never exceeds ten minutes and never drops below half the exponential step",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 500, minimum: 1 }))
    ),
    Arbitrary.schema(
      Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
    ),
  ],
  ([attempts, jitter]) =>
    Effect.sync(() => {
      const delay = crashBackoffMs(attempts, jitter);

      expect(delay).toBeLessThanOrEqual(tenMinutes);
      expect(delay).toBeGreaterThanOrEqual(
        Math.min(tenMinutes, 2000 * 2 ** (attempts - 1)) / 2
      );
    })
);

it.effect(
  "a journal written before backoff existed decodes and is due now",
  () =>
    Effect.gen(function* proof() {
      const old = JSON.stringify({
        pending: [],
        sent: ["worker:1"],
        version: "0.1",
      });

      const decoded = yield* Schema.decodeEffect(CrashJournal)(old);

      expect(decoded.sent).toEqual(["worker:1"]);

      const h = harness(() => "accept");

      yield* crashCycle(
        [],
        { ...empty, pending: [{ delivery: { to: "x" }, key: "k" }] },
        h.ports
      ).pipe(Effect.provide(Logger.layer([])));
      expect(h.attempts).toHaveLength(1);
    })
);

it.effect.prop(
  "only a retired or unknown-name refusal is terminal, and the successor is read from the refusal text",
  [
    Arbitrary.schema(Names),
    Arbitrary.schema(
      Schema.Literals(["Retired", "UnknownName", "Other", "none"])
    ),
    Arbitrary.schema(Schema.Boolean),
  ],
  ([name, code, byStatus]) =>
    Effect.sync(() => {
      const base = {
        reason: `${name} was retired at 2026-01-01T00:00:00.000Z; current row is drovr/${name}`,
        status: code === "Retired" && byStatus ? 410 : 400,
      };

      const refusal = terminalRefusal(
        code === "none" || (code === "Retired" && byStatus)
          ? base
          : { ...base, error: code }
      );

      if (code === "Retired") {
        expect(refusal).toEqual(
          new AlarmRefused({ code: "Retired", successor: `drovr/${name}` })
        );
      } else if (code === "UnknownName") {
        expect(refusal?.code).toBe("UnknownName");
      } else {
        expect(refusal).toBeUndefined();
      }
    })
);
