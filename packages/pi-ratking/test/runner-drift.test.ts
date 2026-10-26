import { it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { expect } from "vitest";

import { shippedDrift } from "../../../stacks/nest/runner-drift.ts";

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u));

it.effect.prop(
  "a runner restarts only when the shipped sha changes, not when the checkout moves",
  [
    Arbitrary.schema(Sha),
    Arbitrary.schema(Schema.Array(Sha)),
    Arbitrary.schema(Sha),
  ],
  ([shipped, localCommits, later]) =>
    Effect.gen(function* proof() {
      let sha = shipped;
      let head = shipped;
      const drifted = yield* shippedDrift(Effect.sync(() => Option.some(sha)));

      for (const commit of localCommits) {
        head = commit;
        expect(yield* drifted).toBe(false);
      }

      expect(head).toBe(localCommits.at(-1) ?? shipped);
      sha = later;
      expect(yield* drifted).toBe(later !== shipped);
    })
);

it.effect("an unreadable shipped sha never restarts the runner", () =>
  Effect.gen(function* proof() {
    let sha = Option.some("a".repeat(40));
    const drifted = yield* shippedDrift(Effect.sync(() => sha));

    sha = Option.none();
    expect(yield* drifted).toBe(false);
  })
);
