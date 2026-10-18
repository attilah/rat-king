import { it } from "@effect/vitest";
import { ActorWatch, watchActor } from "@rat-king/capability/actor-watch";
import { Effect, Ref, Schema } from "effect";
import { expect } from "vitest";

it.effect.prop(
  "shared actor watcher is a no-op by default and delegates the exact machine and actor when supplied",
  [Schema.String],
  ([machine]) =>
    Effect.gen(function* actorWatchProof() {
      const actor = {
        getSnapshot: () => ({ status: "active" }),
        inspect: () => ({ unsubscribe: () => {} }),
      };

      yield* watchActor(machine, actor);
      const seen = yield* Ref.make<readonly string[]>([]);
      yield* watchActor(machine, actor).pipe(
        Effect.provideService(ActorWatch, {
          watch: (name, actual) =>
            Effect.gen(function* watch() {
              expect(actual).toBe(actor);
              yield* Ref.update(seen, (names) => [...names, name]);
            }),
        })
      );
      expect(yield* Ref.get(seen)).toEqual([machine]);
    })
);
