/* oxlint-disable promise/prefer-await-to-callbacks -- Effect error mapping is not a Promise callback. */
import { ownIdentity, prepare } from "@rat-king/mailbox-client";
import type {
  MailboxClientError,
  PeerDocument,
} from "@rat-king/mailbox-client";
import { Settings, settingsLayer } from "@rat-king/ratking-client/config";
import { Directory, directoryLayer } from "@rat-king/ratking-client/directory";
import { resolveName } from "@rat-king/ratking-client/resolve";
import type { UnresolvedReason } from "@rat-king/ratking-client/resolve";
import { Console, Effect, Layer, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import { secretStoreLayer } from "../../mailbox/cli/secrets.ts";
import { operatorConfig } from "./operator-config.ts";
import { ResolveError, writeResolutions } from "./resolve.ts";

export const refreshDocument = (
  refresh: (did: string) => Effect.Effect<PeerDocument, MailboxClientError>,
  did: string
) =>
  refresh(did).pipe(
    Effect.mapError((error): UnresolvedReason => {
      if (error.status === 404) {
        return "unknown-name";
      }

      if (
        error.reason === "Peer directory conflict; retained trusted document"
      ) {
        return "did-mismatch";
      }

      if (error.reason === "Mailbox operation failed") {
        return "invalid-document";
      }

      return "refresh-failed";
    })
  );

export const configuredResolve = Effect.fn("Resolve.configured")(
  function* configuredResolve(names: string, out: string) {
    const operator = yield* operatorConfig;
    const settings = yield* Settings;
    const directory = yield* Directory;

    const client = yield* prepare({
      endpoint: operator.endpoint,
      own: yield* ownIdentity(operator.identity),
      peers: [],
      serviceDid: operator.serviceDid,
    });

    return yield* writeResolutions(names, out, (name) =>
      resolveName(name, {
        didTemplate: settings.didTemplate,
        refresh: (did) => refreshDocument(client.refresh, did),
        reserved: settings.reserved,
        resolveLocal: directory.resolve,
      })
    );
  },
  Effect.scoped,
  Effect.mapError((error) =>
    Schema.is(ResolveError)(error)
      ? error
      : new ResolveError({
          code: "ResolveConfiguration",
          reason:
            "Could not configure resolution; verify RATKING_CONFIG, RAT_KING_ISSUER_LABEL, RAT_KING_ENDPOINT, RAT_KING_SERVICE_DID, RAT_KING_OPERATOR_IDENTITY and operator key access",
        })
  )
);

export const resolveCommand = Command.make(
  "resolve",
  {
    names: Flag.String("names"),
    out: Flag.String("out"),
  },
  (args) =>
    configuredResolve(args.names, args.out).pipe(
      Effect.provide(
        Layer.mergeAll(
          directoryLayer.pipe(Layer.provideMerge(settingsLayer)),
          secretStoreLayer(),
          FetchHttpClient.layer
        )
      ),
      Effect.tap((receipt) => Console.log(JSON.stringify(receipt))),
      Effect.mapError((error) =>
        Schema.is(ResolveError)(error)
          ? error
          : new ResolveError({
              code: "ResolveConfiguration",
              reason:
                "Rat King config is missing or invalid; fix RATKING_CONFIG or ~/.config/rat-king/pi.json before retrying",
            })
      ),
      Effect.tapError((error) =>
        Console.error(
          JSON.stringify({
            error: error.code,
            failed: "resolve",
            next: "Fix the input, configuration or output parent named in why, then run ratking resolve --names <file> --out <new-file>",
            why: error.reason,
          })
        )
      )
    )
).pipe(
  Command.withDescription(
    "Operator: resolve selected names into a new private JSON file without sending or minting."
  )
);
