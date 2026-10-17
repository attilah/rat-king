import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  Arbitrary,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Schema,
} from "effect";
import { expect } from "vitest";

import { fleetStoreCredentials } from "../../../stacks/nest/credentials.ts";
import { layer } from "../src/host.ts";
import { credentialNames } from "./secret-fixtures.ts";

it.effect.prop(
  "reference mode requires private inventory names and never falls back to Random",
  {
    present: Arbitrary.schema(Schema.Boolean),
  },
  ({ present }) =>
    Effect.gen(function* privateNames() {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const location = `${directory}/instance.json`;

      const base = {
        domains: ["example.invalid"],
        hosts: ["example"],
        ips: ["203.0.113.10"],
        secretNames: ["example-name"],
        sites: ["example-site"],
      };

      const inventory = present
        ? { ...base, s3Credentials: credentialNames }
        : base;

      yield* fs.writeFileString(location, JSON.stringify(inventory));
      yield* fs.chmod(location, 0o600);

      const inventoryLayer = layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ RATS_NEST_INSTANCE: location })
          )
        )
      );

      if (present) {
        expect(
          yield* fleetStoreCredentials(false).pipe(
            Effect.provide(inventoryLayer)
          )
        ).toEqual({ credentials: credentialNames });
      } else {
        expect(
          yield* fleetStoreCredentials(false).pipe(
            Effect.provide(inventoryLayer),
            Effect.isFailure
          )
        ).toBe(true);
      }

      expect(
        yield* fleetStoreCredentials(true).pipe(Effect.provide(inventoryLayer))
      ).toEqual({ legacyRandomCredentials: true });
    }).pipe(Effect.provide(NodeServices.layer))
);
