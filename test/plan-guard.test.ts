import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { expect } from "vitest";

import { qualifyPlanActions } from "../../../stacks/nest/plan-guard.ts";

const row = (fqn: string, resourceType: string, action: string) => ({
  action,
  fqn,
  resourceType,
});

const switchRows = [
  row("store/access-key", "Alchemy.Random", "delete"),
  row("store/secret-key", "Alchemy.Random", "delete"),
  row("store/identity", "RatsNest.RemoteFile", "update"),
  row("celld/environment", "RatsNest.RemoteFile", "update"),
  row("store/server", "RatsNest.SystemdUnit", "noop"),
];

const refused = (exit: Exit.Exit<unknown, unknown>): boolean =>
  Exit.isFailure(exit);

it.effect("reference mode admits the two Random credential deletes", () =>
  Effect.gen(function* referenceSwitch() {
    const exit = yield* Effect.exit(qualifyPlanActions(switchRows, false));

    expect(Exit.isSuccess(exit)).toBe(true);
  })
);

it.effect("legacy mode refuses the same two deletes", () =>
  Effect.gen(function* legacySwitch() {
    const exit = yield* Effect.exit(qualifyPlanActions(switchRows, true));

    expect(refused(exit)).toBe(true);
  })
);

it.effect("reference mode refuses any third delete", () =>
  Effect.gen(function* thirdDelete() {
    const exit = yield* Effect.exit(
      qualifyPlanActions(
        [...switchRows, row("store/data", "RatsNest.HostDirectory", "delete")],
        false
      )
    );

    expect(refused(exit)).toBe(true);
  })
);

it.effect("reference mode refuses a Random delete under another name", () =>
  Effect.gen(function* otherRandom() {
    const exit = yield* Effect.exit(
      qualifyPlanActions(
        [row("store/other-key", "Alchemy.Random", "delete")],
        false
      )
    );

    expect(refused(exit)).toBe(true);
  })
);

it.effect("reference mode refuses an allowed name with another type", () =>
  Effect.gen(function* otherType() {
    const exit = yield* Effect.exit(
      qualifyPlanActions(
        [row("store/access-key", "RatsNest.RemoteFile", "delete")],
        false
      )
    );

    expect(refused(exit)).toBe(true);
  })
);

it.effect("any replace refuses, even on an allowed credential row", () =>
  Effect.gen(function* replaceRow() {
    const exits = yield* Effect.all([
      Effect.exit(
        qualifyPlanActions(
          [row("store/access-key", "Alchemy.Random", "replace")],
          false
        )
      ),
      Effect.exit(
        qualifyPlanActions([row("celld/node", "Celld.Node", "replace")], false)
      ),
    ]);

    expect(exits.every(refused)).toBe(true);
  })
);
