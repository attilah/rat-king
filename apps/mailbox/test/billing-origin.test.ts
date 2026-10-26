import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Arbitrary, ConfigProvider, Effect, FileSystem, Schema } from "effect";
import { expect } from "vitest";

import { billingCommand } from "../../../stacks/nest/billing-command.ts";

const origins = [
  "http://billing.example.invalid",
  "https://user@[2001:db8::1]",
  "https://:password@[2001:db8::1]",
  "https://billing.example.invalid/path",
  "https://billing.example.invalid?query=yes",
  "https://billing.example.invalid#fragment",
];

it.effect.prop(
  "billing refuses non-HTTPS or non-origin URLs before touching journal storage or pulling alerts",
  [Arbitrary.schema(Schema.Literals(origins))],
  ([origin]) =>
    Effect.gen(function* originBoundary() {
      const originalExitCode = process.exitCode;
      const touches: string[] = [];

      const fs = FileSystem.layerNoop({
        makeDirectory: (path) =>
          Effect.sync(() => {
            touches.push(path);
          }),
        realPath: () => Effect.succeed("/example/root"),
      });

      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          process.exitCode = originalExitCode;
        })
      );
      yield* billingCommand([]).pipe(
        Effect.provide([
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              BILLING_PULL_CREDENTIAL: "invented-test-credential",
              RAT_KING_BILLING_JOURNAL_DIR: "/example/journal",
              RAT_KING_BILLING_URL: origin,
            })
          ),
          fs,
        ]),
        Effect.provide(NodeServices.layer)
      );
      expect(process.exitCode).toBe(2);
      expect(touches).toEqual([]);
    }).pipe(Effect.scoped)
);
