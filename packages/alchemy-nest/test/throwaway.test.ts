import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { expect } from "vitest";

import {
  guardedInstances,
  guardedPorts,
  ThrowawayName,
  ThrowawayPorts,
  throwawayTarget,
} from "../../../stacks/nest/throwaway-target.ts";
import { HostShell } from "../src/host-shell.ts";
import { layer as shellLayer } from "../src/ssh.ts";

const Suffix = Schema.String.check(Schema.isPattern(/^[a-z0-9]{0,6}$/u));

it.effect.prop(
  "guarded instance names and their prefixes are refused; other valid names pass",
  [Schema.Literals(guardedInstances), Suffix, Suffix],
  ([guarded, suffix, other]) =>
    Effect.sync(() => {
      const accepts = Schema.is(ThrowawayName);
      const plain = `t${other}`;

      expect(accepts(`${guarded}${suffix}`)).toBe(false);
      expect(accepts(plain)).toBe(
        !guardedInstances.some((name) => plain.startsWith(name))
      );
    })
);

it.effect.prop(
  "a port range passes only as ten ports clear of every guarded mailbox and Mischief port",
  [
    Schema.Int.check(Schema.isBetween({ maximum: 65_526, minimum: 20_000 })),
    Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 7 })),
  ],
  ([first, width]) =>
    Effect.sync(() => {
      const last = first + width - 1;
      const clear = guardedPorts.every((port) => port < first || port > last);

      expect(Schema.is(ThrowawayPorts)(`${first}-${last}`)).toBe(
        width === 10 && clear
      );
    })
);

it.effect.prop(
  "throwaway state inside the repository is refused",
  [Schema.Literals([".", "stacks", "packages/alchemy-nest/.state"])],
  ([inside]) =>
    Effect.gen(function* insideRepo() {
      const error = yield* throwawayTarget(new Map([["--state", inside]])).pipe(
        Effect.flip
      );

      expect(error._tag).toBe("FleetError");
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "the local transport refuses an inventory node that is not this host",
  [Schema.String.check(Schema.isPattern(/^zz[a-z]{4,10}$/u))],
  ([elsewhere]) =>
    Effect.gen(function* localTransport() {
      const error = yield* Effect.gen(function* shell() {
        return yield* HostShell;
      }).pipe(
        Effect.provide(
          shellLayer(
            {
              dataRoot: "/srv/example-data",
              home: "/home/example",
              ssh: `example@${elsewhere}`,
              tailnetIPv4: "203.0.113.10",
            },
            {},
            { transport: "local" }
          ).pipe(Layer.provide(NodeServices.layer))
        ),
        Effect.flip
      );

      expect(error).toMatchObject({ operation: "connect" });
    })
);
