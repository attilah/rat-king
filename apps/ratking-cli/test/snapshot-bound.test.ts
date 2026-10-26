import { it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";

import { collectSnapshot, SNAPSHOT_MAX_PAGES } from "../src/snapshot.ts";

it.effect.prop(
  "changing cursors cannot grow a snapshot forever or return partial success",
  [Schema.Boolean],
  ([retired]) =>
    Effect.gen(function* proof() {
      let calls = 0;

      const endless = () => {
        calls += 1;

        return String(calls);
      };

      const result = yield* collectSnapshot([
        {
          label: "synthetic",
          names: () =>
            Effect.succeed(
              retired ? { names: [] } : { cursor: endless(), names: [] }
            ),
          retired: () => Effect.succeed({ cursor: endless(), retired: [] }),
        },
      ]).pipe(Effect.result);

      expect(calls).toBe(SNAPSHOT_MAX_PAGES);
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("SnapshotTooLarge");
      }
    })
);
