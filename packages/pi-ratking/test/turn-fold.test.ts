import { it } from "@effect/vitest";
import { foldTurns, signedTurn, Turn } from "@rat-king/lexicon/turns";
import type { TurnValue } from "@rat-king/lexicon/turns";
import { Arbitrary, DateTime, Option, Schema } from "effect";
import { expect } from "vitest";

const Case = Schema.Struct({
  crash: Schema.Boolean,
  recover: Schema.Boolean,
  turns: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 })),
  weights: Schema.Array(Schema.Int).check(Schema.isMinLength(50)),
});

const record = (
  session: string,
  n: number,
  state: TurnValue["state"],
  at: number,
  generation?: number
): TurnValue => {
  const value = {
    $type: "sh.mschf.agentgraph.turn",
    agent: "worker",
    at: DateTime.formatIso(DateTime.makeUnsafe(at)),
    session,
    state,
    turnId: `${session}:${n}`,
    version: "0.1",
  };

  if (generation !== undefined) {
    Object.assign(value, { generation });
  }

  return Schema.decodeUnknownSync(Turn)(value);
};

it.prop(
  "fold ignores generated shuffles and duplicates, orders session counters, and keeps newer crashes until a later reader starts",
  [Arbitrary.schema(Case)],
  ([sample]) => {
    const ordered: TurnValue[] = [];

    for (let n = 1; n <= sample.turns; n += 1) {
      ordered.push(
        record("old", n, "working", n * 1000),
        record("old", n, "done", n * 1000 + 1)
      );
    }

    ordered.push(record("old", sample.turns + 1, "working", 90_000));
    const newest = record("new", 1, "done", 100_002);

    ordered.push(
      record("new", 0, "idle", 100_000),
      record("new", 1, "working", 100_001),
      newest,
      record("old", sample.turns + 1, "done", 150_000)
    );

    if (sample.crash) {
      ordered.push(
        record("old", 0, "crashed", 200_000, 2),
        record("old", 0, "crashed", 200_001, 1)
      );
    }

    if (sample.recover) {
      ordered.push(
        record("restart", 0, "idle", 300_000),
        record("restart", 1, "working", 300_001),
        record("restart", 1, "done", 300_002)
      );
    }

    let expected = sample.recover ? ordered.at(-1) : newest;

    if (sample.crash && !sample.recover) {
      expected = ordered.find((value) => value.generation === 2);
    }

    expect(foldTurns(ordered).get("worker")).toEqual(expected);

    const shuffled = [...ordered, ...ordered]
      .map((value, index) => ({
        value,
        weight: sample.weights[index % sample.weights.length] ?? 0,
      }))
      .toSorted((left, right) => left.weight - right.weight)
      .map(({ value }) => value);

    expect(foldTurns(shuffled)).toEqual(foldTurns(ordered));
    expect(
      foldTurns([...ordered, ordered[0]].filter((value) => value !== undefined))
    ).toEqual(foldTurns(ordered));
  }
);

const Mutation = Schema.Literals([
  "version",
  "unknown",
  "stopReason",
  "reason",
  "generation",
  "turnId",
  "agent",
  "at",
]);

it.prop(
  "strict turn decoding refuses invalid versions, keys, variants, names, timestamps and mismatched turn sessions",
  [Arbitrary.schema(Mutation)],
  ([field]) => {
    const value = record("session", 1, "working", 0);

    const changes = {
      agent: "Not a name",
      at: "not-a-date",
      generation: 1,
      reason: "not blocked",
      stopReason: "stop",
      turnId: "wrong:1",
      unknown: true,
      version: "9.9",
    };

    expect(
      Option.isNone(
        Schema.decodeUnknownOption(Turn)({ ...value, [field]: changes[field] })
      )
    ).toBe(true);
  }
);

it.prop(
  "signed turn accepts only the named agent or operator",
  [Arbitrary.schema(Schema.Boolean)],
  ([verified]) => {
    const value = record("session", 1, "working", 0);
    expect(Option.isSome(signedTurn(value, "worker", verified))).toBe(verified);
    expect(Option.isSome(signedTurn(value, "operator", verified))).toBe(
      verified
    );
    expect(Option.isNone(signedTurn(value, "stranger", verified))).toBe(true);
  }
);
