import { it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Layer, Schema } from "effect";
import { expect } from "vitest";

import { HostShell } from "../../../packages/alchemy-nest/src/host-shell.ts";
import { DeployMarker } from "../../../stacks/nest/alarm-sources.ts";
import { deploymentMarker } from "../../../stacks/nest/runtime.ts";

it.effect.prop(
  "deployment observations preserve the remote marker and distinguish absence from malformed evidence",
  [
    Arbitrary.schema(DeployMarker),
    Arbitrary.schema(Schema.Literals(["present", "absent", "corrupt"])),
  ],
  ([marker, kind]) =>
    Effect.gen(function* observation() {
      const reads: string[] = [];
      const encoded = JSON.stringify(marker);

      const bytes =
        kind === "absent"
          ? undefined
          : new TextEncoder().encode(kind === "corrupt" ? "!" : encoded);

      const shell = Layer.mock(HostShell, {
        purgeRoots: [],
        read: (path) =>
          Effect.sync(() => {
            reads.push(path);

            return bytes;
          }),
      });

      const result = yield* deploymentMarker("/state/example/deploy.json").pipe(
        Effect.provide(shell),
        Effect.exit
      );

      expect(reads).toEqual(["/state/example/deploy.json"]);

      if (kind === "corrupt") {
        expect(Exit.isFailure(result)).toBe(true);
      } else {
        expect(result).toEqual(
          Exit.succeed(kind === "absent" ? null : JSON.parse(encoded))
        );
      }
    })
);
