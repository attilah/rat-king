import { Effect } from "effect";

import { Host } from "../../packages/alchemy-nest/src/host.ts";
import { InventoryError } from "../../packages/alchemy-nest/src/inventory-error.ts";

export const fleetLegacyRandomCredentials = true;

export const fleetStoreCredentials = Effect.fn("Nest.fleetStoreCredentials")(
  function* fleetStoreCredentials(
    legacy: boolean = fleetLegacyRandomCredentials
  ) {
    if (legacy) {
      return { legacyRandomCredentials: true };
    }

    const host = yield* Host;

    if (host.s3Credentials === undefined) {
      return yield* new InventoryError({
        reason: "Reference mode requires an inventory credential source.",
      });
    }

    return { credentials: yield* host.s3Credentials() };
  }
);
