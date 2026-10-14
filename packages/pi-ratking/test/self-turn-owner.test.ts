import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { resolveTurnOwner } from "@rat-king/ratking-client/config";
import { RatKing, ReaderState } from "@rat-king/ratking-client/ratking";
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schema,
} from "effect";
import { HttpClient } from "effect/http";
import { expect } from "vitest";

import { turnReporter } from "../src/turn-record.ts";
import { harness } from "./harness.ts";

const Name = Schema.String.check(Schema.isPattern(/^[a-z]{1,12}\/desk$/u));

it.effect.prop(
  "turn owner discards self from either owner variable and either own-name variable without falling back",
  [
    Name,
    Schema.Literals(["RATKING_TURN_OWNER", "MUSTER_OWNER_NAME"]),
    Schema.Literals(["RATKING_NAME", "RATKING_PRINT_NAME"]),
  ],
  ([name, ownerKey, ownKey]) =>
    Effect.gen(function* selfOwner() {
      const env = {
        MUSTER_OWNER_NAME: "other/desk",
        [ownerKey]: name,
        [ownKey]: name,
      };

      const owner = yield* resolveTurnOwner().pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))
      );

      expect(Option.isNone(owner)).toBe(true);

      const other = yield* resolveTurnOwner().pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ ...env, [ownKey]: "different/worker" })
          )
        )
      );

      expect(Option.getOrUndefined(other)).toBe(name);
    })
);

it.effect.prop(
  "turn reporter refuses self ownership after actual identity resolution",
  [Name],
  ([name]) =>
    Effect.gen(function* resolvedSelf() {
      const fs = yield* FileSystem.FileSystem;
      const sent: string[] = [];

      const layer = Layer.merge(
        harness(
          yield* fs.makeTempDirectoryScoped(),
          HttpClient.make(() => Effect.die("Unexpected HTTP")),
          [],
          { turnRecords: true }
        ),
        Layer.mock(RatKing, {
          send: (to) =>
            Effect.sync(() => {
              sent.push(to);
            }).pipe(
              Effect.andThen(Effect.die("Self-owned turn must never send"))
            ),
          status: Effect.succeed({
            endpoint: "https://mailbox.invalid",
            quarantine: { count: 0, latest: Option.none() },
            reader: ReaderState.Starting({ reason: "test" }),
            self: Option.some({ did: "did:web:worker.invalid", name }),
          }),
        })
      );

      const reporter = turnReporter(
        {
          alive: () => true,
          env: Option.none(),
          owner: Option.some(name),
          pane: Option.none(),
          pid: 1,
          session: "self-owned",
        },
        0
      );

      yield* reporter.idle().pipe(Effect.provide(layer));
      yield* reporter.working().pipe(Effect.provide(layer));
      yield* reporter.done("stop").pipe(Effect.provide(layer));
      expect(sent).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
