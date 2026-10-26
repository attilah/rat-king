import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";

import { COMMAND_OUTPUT_BYTES, runCommand } from "../src/process.ts";

it.effect.prop(
  "child stdout rejects excess bytes before collecting the rest",
  [Schema.Boolean],
  ([excess]) =>
    Effect.gen(function* proof() {
      const count = COMMAND_OUTPUT_BYTES + (excess ? 1 : 0);

      const result = yield* runCommand([
        process.execPath,
        "-e",
        `process.stdout.write('x'.repeat(${count}))`,
      ]).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(excess);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("Command output too large");
      } else {
        expect(result.success.stdout.length).toBe(COMMAND_OUTPUT_BYTES);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 2 } }
);
