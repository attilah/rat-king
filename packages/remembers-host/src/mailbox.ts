import * as Defs from "@rat-king/lexicon/defs";
import {
  Document,
  Identity,
  base64url,
  importSigning,
  ownIdentity,
  prepare,
  serviceToken,
} from "@rat-king/mailbox-client";
import { Failure } from "@rat-king/remembers";
import { Clock, Effect, FileSystem, Layer, Predicate, Schema } from "effect";

import { readPrivate } from "./config.ts";
import { NoticeTransport } from "./notices.ts";

const MailboxConfig = Schema.Struct({
  endpoint: Schema.NonEmptyString,
  identity: Identity,
  names: Schema.Struct({
    from: Schema.NonEmptyString,
    peers: Schema.Record(Schema.String, Schema.NonEmptyString),
  }),
  peers: Schema.NonEmptyArray(Document),
  serviceDid: Schema.NonEmptyString,
});

const failed = () => new Failure({ code: "mailbox", operation: "speaks" });

export const mailboxPorts = Effect.fn("RemembersHost.mailbox")(
  function* mailboxPorts(path: string, workerDid: string) {
    const fs = yield* FileSystem.FileSystem;
    const stat = yield* fs.stat(path).pipe(Effect.mapError(failed));

    if (stat.type !== "File" || stat.mode % 0o1000 !== 0o600) {
      return yield* failed();
    }

    const config = yield* readPrivate(path).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(MailboxConfig))
      ),
      Effect.mapError(failed)
    );

    const own = yield* ownIdentity(config.identity).pipe(
      Effect.mapError(failed)
    );

    const client = yield* prepare({ ...config, own }).pipe(
      Effect.mapError(failed)
    );

    const key = yield* importSigning(config.identity).pipe(
      Effect.mapError(failed)
    );

    const authorize = Effect.fn("RemembersHost.authorize")(function* authorize(
      capability: string
    ) {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

      const nonce = yield* Effect.sync(() =>
        base64url(crypto.getRandomValues(new Uint8Array(16)))
      );

      return yield* serviceToken(
        {
          aud: `${workerDid}#mischief`,
          exp: now + 60,
          iat: now,
          iss: config.identity.did,
          jti: nonce,
          lxm: `sh.mschf.mischief.${capability}`,
        },
        key
      ).pipe(Effect.mapError(failed));
    });

    const notices = Layer.succeed(
      NoticeTransport,
      NoticeTransport.of({
        prepare: Effect.fn("RemembersHost.sealNotice")(
          function* sealNotice(notice) {
            const did = Object.entries(config.names.peers).find(
              ([_did, name]) => name === notice.to
            )?.[0];

            if (did === undefined) {
              return yield* failed();
            }

            const sealed = yield* client
              .sealPayload(did, notice.payload, {
                encrypt: true,
                summary: `Remembers ${notice.kind}: ${notice.id}`,
              })
              .pipe(Effect.mapError(failed));

            return yield* Schema.encodeEffect(
              Schema.fromJsonString(Defs.EncryptedEnvelope)
            )(sealed.envelope).pipe(Effect.mapError(failed));
          }
        ),
        send: Effect.fn("RemembersHost.sendNotice")(function* sendNotice(wire) {
          const envelope = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Defs.EncryptedEnvelope)
          )(wire).pipe(Effect.mapError(failed));

          const result = yield* client.sendSealed(envelope);

          if (!Predicate.isTagged(result, "Accepted")) {
            return yield* failed();
          }

          return yield* Effect.void;
        }),
      })
    );

    return { authorize, notices };
  }
);
