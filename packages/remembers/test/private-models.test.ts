import { it } from "@effect/vitest";
import {
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Schema,
} from "effect";
import { expect } from "vitest";

import { Models, privateModels } from "../adapters/private-models.ts";
import { testLayer } from "../adapters/testing.ts";
import { Judge } from "../src/contract.ts";
import { observeSlice } from "../src/pipeline.ts";
import { draft, fixture, slice } from "./fixtures.ts";

it.effect.prop(
  "model adapters load nonempty private files at runtime and novelty ignores a Brain file not in the always-loaded manifest",
  [
    Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 0 })),
    Schema.Boolean,
  ],
  ([seed, emptyPrefix]) => {
    const data = fixture(seed);
    const prefix = `fixture-prefix-${seed}`;
    const rubric = `fixture-rubric-${seed}`;
    const loadedSentence = "Orchid uses signed rules.";
    const brainSentence = "Orchid accepts violet approval.";

    const files = new Map([
      ["/fixture/prefix", emptyPrefix ? "" : prefix],
      ["/fixture/rubric", rubric],
      ["/fixture/canon", loadedSentence],
      ["/fixture/brain", brainSentence],
    ]);

    const config = ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        REMEMBERS_CANON_PATHS: JSON.stringify(["/fixture/canon"]),
        REMEMBERS_JUDGE_RUBRIC_PATH: "/fixture/rubric",
        REMEMBERS_OBSERVER_PREFIX_PATH: "/fixture/prefix",
      })
    );

    const models = Layer.succeed(
      Models,
      Models.of({
        judge: (actual) =>
          Effect.sync(() => {
            expect(actual).toBe(rubric);

            return { stale: false, truthful: true };
          }),
        observe: (actual) =>
          Effect.sync(() => {
            expect(actual).toBe(prefix);
            const candidate = draft("one", seed);

            return [
              {
                ...candidate,
                claim: { ...candidate.claim, sentence: loadedSentence },
              },
              {
                ...candidate,
                claim: { ...candidate.claim, sentence: brainSentence },
              },
            ];
          }),
      })
    );

    const fileLayer = Layer.succeed(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        readFileString: (path) => Effect.succeed(files.get(path) ?? ""),
      })
    );

    const layer = privateModels.pipe(
      Layer.provide([config, fileLayer, models])
    );

    return Effect.gen(function* privateFileProof() {
      const program = Effect.gen(function* privateCall() {
        const result = yield* observeSlice(slice("one").key);
        expect(result.books.novelty_dropped).toBe(1);
        expect(
          result.candidates.map((candidate) => candidate.claim.sentence)
        ).toEqual([brainSentence]);
        const judge = yield* Judge;
        const [candidate] = result.candidates;

        if (candidate === undefined) {
          return yield* Effect.die("Missing fixture candidate");
        }

        return yield* judge.judge(candidate);
      });

      const exit = yield* program.pipe(Effect.provide(layer), Effect.exit);
      expect(Exit.isSuccess(exit)).toBe(!emptyPrefix);
    }).pipe(Effect.provide(testLayer(data)));
  }
);
