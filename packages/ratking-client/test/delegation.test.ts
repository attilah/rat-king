import { it } from "@effect/vitest";
import * as Status from "@rat-king/lexicon/attention.status";
import { Arbitrary, Clock, DateTime, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { delegation, DelegationReasons } from "../src/delegation.ts";

const State = Schema.Literals(["available", "busy", "dnd"]);

const Facts = Schema.Struct({
  critical: Schema.Boolean,
  delegated: Schema.Boolean,
  openAsk: Schema.Boolean,
  operator: Schema.Boolean,
});

const status = (state: typeof State.Type, until?: string) => {
  const value = {
    $type: "sh.mschf.ratking.attention.status",
    delegate: "alpha/ea",
    exempt: ["alpha/alarm"],
    state,
    version: "0.1",
  };

  if (until !== undefined) {
    Object.assign(value, { until });
  }

  return Schema.decodeUnknownSync(Status.Main)(value);
};

it.prop(
  "every critical rule protects the desk in every state",
  [Arbitrary.schema(State), Arbitrary.schema(Schema.Int)],
  ([state, now]) => {
    const arrivals = [
      { kind: "message" as const, operator: true },
      { kind: "message" as const, sender: "joel" },
      { kind: "message" as const, sender: "operator" },
      { kind: "ask" as const },
      { kind: "reply" as const, openAsk: true },
      { critical: true, kind: "message" as const },
      { kind: "message" as const, sender: "alpha/alarm" },
    ];

    const { delegate: _delegate, ...withoutDelegate } = status(state);

    const statuses = [
      status(state),
      status(state, "1970-01-01T00:00:00.000Z"),
      status(state, "2099-01-01T00:00:00.000Z"),
      withoutDelegate,
    ];

    for (const value of statuses) {
      for (const arrival of arrivals) {
        expect(delegation(arrival, value, now)._tag).toBe("Direct");
      }
    }
  }
);

it.prop(
  "copies and cc never delegate regardless of facts",
  [Arbitrary.schema(State), Arbitrary.schema(Facts)],
  ([state, facts]) => {
    for (const arrival of [
      { ...facts, copy: true },
      { ...facts, delegated: true },
    ]) {
      expect(
        delegation({ ...arrival, kind: "message" }, status(state), 0)._tag
      ).toBe("Direct");
    }
  }
);

it.effect.prop(
  "expiry is exact on the clock boundary",
  [
    Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2_000_000_000, minimum: 1 }))
    ),
  ],
  ([milliseconds]) =>
    Effect.gen(function* boundary() {
      yield* TestClock.setTime(milliseconds - 1);

      const value = status(
        "busy",
        DateTime.formatIso(DateTime.makeUnsafe(milliseconds))
      );

      const arrival = { kind: "message" as const, sender: "alpha/sender" };
      expect(
        delegation(arrival, value, yield* Clock.currentTimeMillis)
      ).toHaveProperty("name", "alpha/ea");
      yield* TestClock.adjust(1);
      expect(
        delegation(arrival, value, yield* Clock.currentTimeMillis).reason
      ).toEqual(DelegationReasons.expired());
    })
);
