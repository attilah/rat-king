import { it } from "@effect/vitest";
import { resolveTurnOwner } from "@rat-king/ratking-client/config";
import { ConfigProvider, Effect, Option } from "effect";
import { expect } from "vitest";

const ownerFor = (env: Readonly<Record<string, string>>) =>
  resolveTurnOwner().pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
  );

it.effect("turn owner prefers RATKING_TURN_OWNER over the Muster owner", () =>
  Effect.gen(function* prefersTurnOwner() {
    expect(
      yield* ownerFor({
        MUSTER_OWNER_NAME: "project/desk",
        RATKING_TURN_OWNER: "project/observer",
      })
    ).toStrictEqual(Option.some("project/observer"));
  })
);

it.effect("turn owner falls back to the Muster owner", () =>
  Effect.gen(function* fallsBackToMuster() {
    expect(
      yield* ownerFor({ MUSTER_OWNER_NAME: "project/desk" })
    ).toStrictEqual(Option.some("project/desk"));
  })
);

it.effect("turn owner is none without either variable", () =>
  Effect.gen(function* noOwner() {
    expect(yield* ownerFor({})).toStrictEqual(Option.none());
  })
);
