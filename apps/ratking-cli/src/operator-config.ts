import { Identity } from "@rat-king/mailbox-client";
import { PiConfig } from "@rat-king/ratking-client/config";
import { Config, Effect, Schema } from "effect";

import { SecretStore } from "../../mailbox/cli/secrets.ts";
import { SnapshotError } from "./snapshot.ts";

export const operatorConfig = Effect.gen(function* operatorConfig() {
  const label = yield* Config.NonEmptyString("RAT_KING_ISSUER_LABEL");

  const endpoint = yield* Config.schema(
    PiConfig.fields.endpoint,
    "RAT_KING_ENDPOINT"
  );

  const serviceDid = yield* Config.schema(
    PiConfig.fields.serviceDid,
    "RAT_KING_SERVICE_DID"
  );

  const secret = yield* Config.NonEmptyString("RAT_KING_OPERATOR_IDENTITY");
  const store = yield* SecretStore;

  const identity = yield* store.lease(secret).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Identity))),
    Effect.mapError(
      () =>
        new SnapshotError({
          code: "IdentityUnavailable",
          reason:
            "Could not lease or decode the operator identity; verify RAT_KING_OPERATOR_IDENTITY and access to agent-secrets",
        })
    )
  );

  return { endpoint, identity, label, serviceDid };
});
