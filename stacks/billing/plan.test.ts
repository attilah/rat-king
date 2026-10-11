// @effect-diagnostics nodeBuiltinImport:off -- Offline CLI proof executes a child Node process, never a provider API.
import { spawnSync } from "node:child_process";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

const Rendered = Schema.Struct({
  mode: Schema.Literal(
    "offline-empty-state-assumption-NOT-live-reconciliation"
  ),
  plan: Schema.Struct({
    actions: Schema.Array(Schema.Unknown),
    resources: Schema.Array(
      Schema.Struct({
        action: Schema.Literal("create"),
        bindings: Schema.Array(
          Schema.Struct({
            action: Schema.Literal("create"),
            sid: Schema.String,
          })
        ),
        resourceType: Schema.Literal("Cloudflare.Worker"),
      })
    ),
  }),
  surface: Schema.Struct({
    hostname: Schema.String,
    secrets: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        type: Schema.Literal("secret_text"),
        value: Schema.Literal("[REDACTED]"),
      })
    ),
  }),
});

it.effect.prop(
  "stock Alchemy offline plan has one new Worker and exactly four bindings",
  { seed: Schema.Int },
  ({ seed }) =>
    Effect.gen(function* planTest() {
      const fs = yield* FileSystem.FileSystem;

      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "billing-offline-proof-",
      });

      const hostname = `billing${Math.abs(seed)}.example.invalid`;

      const result = spawnSync(
        process.execPath,
        [new URL("cli.ts", import.meta.url).pathname, "plan"],
        {
          encoding: "utf-8",
          env: {
            ALCHEMY_TELEMETRY_DISABLED: "1",
            HOME: directory,
            PATH: process.env.PATH,
            RAT_KING_BILLING_HOSTNAME: hostname,
            RAT_KING_STATE_DIR: directory,
          },
          timeout: 15_000,
        }
      );

      expect(result.status).toBe(0);
      const start = result.stdout.indexOf('{\n  "mode"');
      expect(start).toBeGreaterThanOrEqual(0);

      const plan = yield* Schema.decodeEffect(Schema.fromJsonString(Rendered))(
        result.stdout.slice(start)
      );

      expect(plan.plan.resources).toHaveLength(1);
      expect(plan.plan.actions).toHaveLength(0);
      expect(
        plan.plan.resources[0]?.bindings.map(({ sid }) => sid).toSorted()
      ).toEqual([
        "ALERTS",
        "BILLING_PULL_CREDENTIAL",
        "BILLING_WEBHOOK_CREDENTIAL",
        "RATE_LIMIT",
      ]);
      expect(plan.surface.hostname).toBe(hostname);
      expect(plan.surface.secrets).toHaveLength(2);

      const denied = spawnSync(
        process.execPath,
        [new URL("cli.ts", import.meta.url).pathname, "deploy"],
        {
          encoding: "utf-8",
          env: { ALCHEMY_TELEMETRY_DISABLED: "1" },
          timeout: 5000,
        }
      );

      expect(denied.status).not.toBe(0);
      expect(denied.stdout + denied.stderr).toContain(
        "Explicit billing deploy approval required"
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 3 }, timeout: 20_000 }
);
