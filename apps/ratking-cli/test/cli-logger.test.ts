import { it } from "@effect/vitest";
import { Console, Effect } from "effect";
import { expect } from "vitest";

import { RENDERS } from "../../../packages/ratking-client/src/record-visibility.ts";
import { cliLogger } from "../src/main.ts";
import { captured } from "./fixture.ts";

it.effect(
  "log lines go to stderr so --json stdout stays one JSON document",
  () =>
    Effect.gen(function* logsToStderr() {
      const output = captured();

      yield* Effect.logInfo("lease acquire name=alpha/store").pipe(
        Effect.provide(cliLogger),
        Effect.provideService(Console.Console, output.console)
      );

      expect(output.stdout).toEqual([]);
      expect(output.stderr.join("\n")).toContain("lease acquire");
    })
);

it.effect("a holding reader renders rule garden records", () =>
  Effect.sync(() => {
    expect(RENDERS).toContain("sh.mschf.rulegarden.*");
  })
);
