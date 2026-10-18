import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { TestProbe, testLayer } from "../adapters/testing.ts";
import { Store } from "../src/contract.ts";
import type { MemoryRecordValue } from "../src/contract.ts";
import { dedupe, observeSlice } from "../src/pipeline.ts";
import { cli, logUse, search } from "../src/recall.ts";
import { fixture, slice } from "./fixtures.ts";
import { storeModel } from "./store-model.ts";

const Actions = Schema.Array(
  Schema.Literals([
    "write",
    "replay",
    "advance",
    "use",
    "invalidate",
    "run",
    "key",
    "visit",
  ])
).check(Schema.isMaxLength(20));

it.effect.prop(
  "SQLite delivery replay and causal advance follow the store/use model after every command",
  [Arbitrary.schema(Actions)],
  ([actions]) => {
    const data = fixture(42);

    return Effect.gen(function* modelProof() {
      const result = yield* observeSlice(slice("one").key);
      const [record] = yield* dedupe([result], data.at);

      if (!record) {
        return yield* Effect.die("Fixture must observe a policy");
      }

      return yield* storeModel(actions, record);
    }).pipe(Effect.provide(testLayer(data)));
  }
);

it.effect.prop(
  "recall ranks standing rules first, skips invalid claims, supports concept and fleet fallback, and logs only acted-on results idempotently",
  [Schema.Boolean],
  ([unavailableQuotes]) => {
    const data = { ...fixture(7), unavailableQuotes };

    return Effect.gen(function* recallProof() {
      const result = yield* observeSlice(slice("one").key);
      const [policy] = yield* dedupe([result], data.at);

      if (!policy) {
        return yield* Effect.die("Fixture must observe a policy");
      }

      const fact = {
        ...policy,
        claim: {
          ...policy.claim,
          project: "fern",
          sentence: "Orchid fact survives elsewhere.",
          type: "fact",
        },
        id: "fact",
      } satisfies MemoryRecordValue;

      const invalid = { ...policy, id: "invalid", invalid_at: data.at };
      const store = yield* Store;
      yield* store.commit(
        { epoch: 0, key: "recall", runId: "recall", visit: 0 },
        [fact, invalid, policy]
      );
      const hits = yield* search({ project: "missing", text: "Orchid" });
      expect(hits.map((hit) => hit.record.id)).toEqual([policy.id, fact.id]);
      expect(hits[0]?.quotes[0]?.status).toBe(
        unavailableQuotes ? "unavailable" : "verified"
      );
      expect(
        (yield* search({ project: "orchid", text: "orchid-policy" })).length
      ).toBe(1);
      expect((yield* store.search("Orchid", "orchid"))[0]?.uses).toHaveLength(
        0
      );
      yield* logUse("orchid", policy.id, "acted");
      yield* logUse("orchid", policy.id, "acted");
      expect((yield* store.search("Orchid", "orchid"))[0]?.uses).toHaveLength(
        1
      );
      expect(yield* cli(["search", "Orchid", "--project", "orchid"])).toContain(
        policy.id
      );
      expect(yield* cli(["help"])).toContain("SliceSource");
      const probe = yield* TestProbe;
      expect(yield* probe.notices()).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.provide(testLayer(data)));
  }
);
