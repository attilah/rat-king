import { Effect, Path, Schema } from "effect";

import { InstanceNameSchema } from "../../packages/alchemy-nest/src/instance.ts";
import { FleetError as ThrowawayError } from "./stage-config.ts";

export const guardedInstances = [
  "rat-king",
  "ratking",
  "mischief",
  "mischiefrb",
] as const;

export const ThrowawayName = InstanceNameSchema.check(
  Schema.makeFilter(
    (name) =>
      !guardedInstances.some(
        (guarded) => name === guarded || name.startsWith(guarded)
      )
  )
);

export const portCount = 10;

export const guardedPorts = [
  18_081,
  18_333,
  18_787,
  18_788,
  18_888,
  19_333,
  28_081,
  28_333,
  28_888,
  29_333,
  ...Array.from({ length: 20 }, (_, offset) => 28_000 + offset),
] as const;

export const ThrowawayPorts = Schema.String.check(
  Schema.isPattern(/^\d{5}-\d{5}$/u),
  Schema.makeFilter((range) => {
    const [first = 0, last = 0] = range.split("-").map(Number);

    return (
      first >= 20_000 &&
      last <= 65_535 &&
      last - first === portCount - 1 &&
      guardedPorts.every((port) => port < first || port > last)
    );
  })
);

export const throwawayDefaults = {
  name: "rka31013",
  ports: "28020-28029",
} as const;

export interface ThrowawayTarget {
  readonly dataRoot: string;
  readonly name: string;
  readonly portBase: number;
  readonly state: string;
}

export const throwawayUsage =
  "Usage: throwaway <plan|up|health|drive|traffic|destroy-plan|down|verify-gone> --state <dir> [--name rka31013] [--ports 28020-28029] [--data-root <dir>] [--plant <flag>] [--count N] [--interval-ms M] [--out <file>]";

export const throwawayTarget = Effect.fn("Throwaway.target")(
  function* throwawayTarget(flags: ReadonlyMap<string, string>) {
    const state = flags.get("--state");

    if (state === undefined) {
      return yield* new ThrowawayError({ reason: throwawayUsage });
    }

    const name = yield* Schema.decodeUnknownEffect(ThrowawayName)(
      flags.get("--name") ?? throwawayDefaults.name
    ).pipe(
      Effect.mapError(
        () => new ThrowawayError({ reason: "Refused throwaway instance name" })
      )
    );

    const ports = yield* Schema.decodeUnknownEffect(ThrowawayPorts)(
      flags.get("--ports") ?? throwawayDefaults.ports
    ).pipe(
      Effect.mapError(
        () => new ThrowawayError({ reason: "Refused throwaway port range" })
      )
    );

    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../..");
    const resolved = path.resolve(state);

    if (resolved === root || resolved.startsWith(`${root}/`)) {
      return yield* new ThrowawayError({
        reason: "Throwaway state must stay outside the repository",
      });
    }

    return {
      dataRoot: path.resolve(flags.get("--data-root") ?? `${resolved}/data`),
      name,
      portBase: Number(ports.split("-")[0]),
      state: resolved,
    } satisfies ThrowawayTarget;
  }
);
