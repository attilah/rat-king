import { Effect } from "effect";

import { refuse } from "../../packages/alchemy-nest/src/files.ts";
import { fleetLegacyRandomCredentials } from "./credentials.ts";

const switchDeletes: ReadonlySet<string> = new Set([
  "store/access-key",
  "store/secret-key",
]);

export const qualifyPlanActions = Effect.fn("Nest.qualifyPlanActions")(
  function* qualifyPlanActions(
    rows: readonly {
      readonly action: string;
      readonly fqn: string;
      readonly resourceType: string;
    }[],
    legacyRandomCredentials: boolean = fleetLegacyRandomCredentials
  ) {
    const refused = rows.some(
      (row) =>
        row.action === "replace" ||
        (row.action === "delete" &&
          !(
            !legacyRandomCredentials &&
            row.resourceType === "Alchemy.Random" &&
            switchDeletes.has(row.fqn)
          ))
    );

    if (refused) {
      return yield* refuse("POC plan refuses delete or replace");
    }

    return yield* Effect.void;
  }
);
