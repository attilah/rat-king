import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";
import { initialTransition } from "xstate";

import { execute } from "../../../stacks/nest/ship-command.ts";
import type { ShipReceipt } from "../../../stacks/nest/ship-config.ts";
import { sanitizeCandidateStderr } from "../../../stacks/nest/ship-diagnostics.ts";
import { shipMachine } from "../../../stacks/nest/ship-machine.ts";
import { shipCycle } from "../../../stacks/nest/ship.ts";

it.effect.prop(
  "failed candidate stderr keeps the public cause and drops values outside it",
  [Schema.String],
  ([noise]) =>
    Effect.gen(function* diagnostics() {
      const secret = "invented-private-value.invalid";
      const raw = `${noise}\nHostError: Only a matching file may be adopted. secret=${secret}\n at RemoteFile.provider.read (file:///private/instance.invalid/file.ts:4)\n`;

      const result = yield* execute(
        process.execPath,
        [
          "-e",
          `process.stderr.write(${JSON.stringify(raw)});process.exitCode=1`,
        ],
        process.cwd()
      ).pipe(Effect.provide(NodeServices.layer));

      expect(result.code).toBe(1);
      expect(result.stderrTail).toContain(
        "Only a matching file may be adopted"
      );
      expect(result.stderrTail).toContain("RemoteFile.provider.read");
      expect(result.stderrTail).not.toContain(secret);
      expect(result.stderrTail).not.toContain("file:///");
      expect(result.stderrTail?.length).toBeLessThanOrEqual(2048);
      const receipts: (typeof ShipReceipt.Type)[] = [];

      const [initial] = initialTransition(shipMachine, {
        failed: "",
        successful: "",
      });

      yield* shipCycle(initial, {
        checkpoint: () => Effect.void,
        ci: () => Effect.succeed(true),
        deploy: () =>
          Effect.succeed({
            celldRestarted: false,
            restartSeconds: 0,
            result: "failed" as const,
            stderrTail: result.stderrTail ?? "",
          }),
        fetch: Effect.succeed("a".repeat(40)),
        notify: () => Effect.void,
        record: (receipt) =>
          Effect.sync(() => {
            receipts.push(receipt);
          }),
        recover: Effect.succeed("running"),
      });
      expect(receipts[0]?.stderrTail).toBe(result.stderrTail);
    })
);

const Octet = Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }));

const Leak = Schema.Struct({
  host: Schema.Literals(["alpha", "node-7", "box"]),
  noise: Schema.Array(Schema.String),
  octets: Schema.Tuple([Octet, Octet, Octet]),
  token: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9]{40}$/u)),
  user: Schema.Literals(["example", "operator", "jdoe"]),
});

it.prop(
  "an unrecognized failure shows its last 15 lines with addresses, home paths and tokens stripped, within 1,500 characters",
  { leak: Arbitrary.schema(Leak) },
  ({ leak }) => {
    const tailnet = `100.${64 + (leak.octets[0] % 64)}.${leak.octets[1]}.${leak.octets[2]}`;
    const domain = [leak.host, "example-net", "ts", "net"].join(".");
    const home = `/Users/${leak.user}`;
    const linuxHome = `/home/${leak.user}`;
    const token = `9${leak.token}`;

    const raw = [
      ...leak.noise,
      `connect ECONN to ${tailnet}:18333 failed`,
      `ssh ${domain} refused`,
      `at ${home}/Code/rat-king/stacks/nest/cli.ts:12`,
      `reading ${linuxHome}/.config/rat-king/s3.json`,
      `Authorization: Bearer ${token}`,
      `api_key=${token}`,
      `ghp_${leak.token}`,
      "Error: celld readiness failed at bucket write",
    ].join("\n");

    const excerpt = sanitizeCandidateStderr(raw);

    for (const leaked of [
      tailnet,
      domain,
      home,
      linuxHome,
      token,
      leak.token,
    ]) {
      expect(excerpt).not.toContain(leaked);
    }

    expect(excerpt.length).toBeLessThanOrEqual(1500);
    expect(excerpt.split("\n").length).toBeLessThanOrEqual(15);
    expect(
      excerpt.endsWith("Error: celld readiness failed at bucket write")
    ).toBe(true);
  }
);
