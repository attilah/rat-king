import { verify } from "@rat-king/envelope/es256";
import type * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as PutPreferences from "@rat-king/lexicon/attention.putPreferences";
import * as PutStatus from "@rat-king/lexicon/attention.putStatus";
import * as Receipt from "@rat-king/lexicon/attention.receipt";
import type * as Status from "@rat-king/lexicon/attention.status";
import type { HandlerInterface } from "@rat-king/lexicon/mailbox-handlers";
import { Clock, Effect, Option, Schema } from "effect";

import {
  attentionBytes,
  defaultPreferences,
  defaultStatus,
} from "../../../packages/mailbox-client/src/attention.ts";
import { AttentionDirectory, delegates } from "./attention-directory.ts";
import { DidResolver } from "./auth.ts";
import { Caller } from "./caller.ts";
import { failure } from "./failure.ts";
import { MailboxStore } from "./store.ts";
import type { Transaction } from "./store.ts";

const recordChange = (
  tx: Transaction,
  operation: Receipt.MainValue["operation"]
) => {
  tx.append(
    Schema.decodeUnknownSync(Receipt.Main)({
      $type: "sh.mschf.ratking.attention.receipt",
      operation,
      seq: tx.watermark() + 1,
    })
  );
};

const recipient = (actual: string, requested: string) => {
  if (actual !== requested) {
    throw failure("Forbidden", 403);
  }
};

export type AttentionInterface = Pick<
  HandlerInterface,
  "getPreferences" | "getStatus" | "putPreferences" | "putStatus"
>;

export const attentionHandlers = Effect.gen(function* attentionHandlers() {
  const caller = yield* Caller;
  const store = yield* MailboxStore;
  const resolver = yield* DidResolver;
  const directory = yield* Effect.serviceOption(AttentionDirectory);

  const own = (did: string) =>
    caller.did === did ? Effect.void : Effect.fail(failure("Forbidden", 403));

  const signed = Effect.fn("Attention.signed")(function* signed(
    input: Pick<PutPreferences.InputValue, "did" | "keyId" | "signature">,
    nsid: string,
    value: Prefs.MainValue | Status.MainValue
  ) {
    yield* own(input.did);

    const key = yield* resolver.resolve(
      input.did,
      input.keyId,
      "authentication"
    );

    const valid = yield* verify(
      key,
      attentionBytes(input.did, nsid, value),
      input.signature
    ).pipe(Effect.mapError(() => failure("Forbidden", 403)));

    return yield* valid ? Effect.void : Effect.fail(failure("Forbidden", 403));
  });

  return {
    getPreferences: Effect.fn("Attention.getPreferences")(
      function* getPreferences(params) {
        yield* own(params.did);

        return yield* store.transaction((tx) => {
          recipient(tx.recipient(), params.did);

          return { prefs: tx.attentionPreferences() ?? defaultPreferences() };
        });
      }
    ),
    getStatus: Effect.fn("Attention.getStatus")(function* getStatus(params) {
      return yield* store.transaction((tx) => {
        recipient(tx.recipient(), params.did);

        return { status: tx.attentionStatus() ?? defaultStatus() };
      });
    }),
    putPreferences: Effect.fn("Attention.putPreferences")(
      function* putPreferences(input) {
        yield* signed(input, PutPreferences.Method.nsid, input.prefs);

        return yield* store.transaction((tx) => {
          recipient(tx.recipient(), input.did);
          tx.setAttentionPreferences(input.prefs);
          recordChange(tx, "putPreferences");

          return { prefs: input.prefs };
        });
      }
    ),
    putStatus: Effect.fn("Attention.putStatus")(function* putStatus(input) {
      yield* signed(input, PutStatus.Method.nsid, input.status);

      if (input.status.delegate !== undefined) {
        if (Option.isNone(directory)) {
          return yield* Effect.fail(failure("MailboxUnavailable", 503));
        }

        const peer = yield* directory.value.resolve(input.status.delegate);

        if (Option.isNone(peer)) {
          return yield* Effect.fail(failure("DelegateNotFound"));
        }

        if (peer.value === input.did) {
          return yield* Effect.fail(failure("DelegateSelf"));
        }

        const status = yield* directory.value.status(peer.value);
        const now = yield* Clock.currentTimeMillis;

        if (delegates(status, now) && status.delegate !== undefined) {
          const back = yield* directory.value.resolve(status.delegate);

          if (Option.isSome(back) && back.value === input.did) {
            return yield* Effect.fail(failure("DelegateCycle"));
          }
        }
      }

      return yield* store.transaction((tx) => {
        recipient(tx.recipient(), input.did);
        tx.setAttentionStatus(input.status);
        recordChange(tx, "putStatus");

        return { status: input.status };
      });
    }),
  } satisfies AttentionInterface;
});
