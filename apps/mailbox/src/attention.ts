import { verify } from "@rat-king/envelope/es256";
import type * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as PutPreferences from "@rat-king/lexicon/attention.putPreferences";
import * as PutStatus from "@rat-king/lexicon/attention.putStatus";
import * as Receipt from "@rat-king/lexicon/attention.receipt";
import type * as Status from "@rat-king/lexicon/attention.status";
import type { HandlerInterface } from "@rat-king/lexicon/mailbox-handlers";
import { Effect, Schema } from "effect";

import {
  attentionBytes,
  defaultPreferences,
  defaultStatus,
} from "../../../packages/mailbox-client/src/attention.ts";
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

      return yield* store.transaction((tx) => {
        recipient(tx.recipient(), input.did);
        tx.setAttentionStatus(input.status);
        recordChange(tx, "putStatus");

        return { status: input.status };
      });
    }),
  } satisfies AttentionInterface;
});
