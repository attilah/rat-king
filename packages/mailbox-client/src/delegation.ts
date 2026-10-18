import { EnvelopeFailure } from "@rat-king/envelope";
import { openPlaintext } from "@rat-king/envelope/signed";
import type { ResolveSigningKey } from "@rat-king/envelope/signed";
import type * as Defs from "@rat-king/lexicon/defs";
import { Effect, Schema } from "effect";

import { PayloadJson } from "./payload.ts";

export const openDelegated = Effect.fn("Mailbox.openDelegated")(
  function* openDelegated(
    envelope: Defs.EncryptedEnvelopeValue,
    receipt: Defs.ReceiptValue,
    recipientDid: string,
    resolveSigningKey: ResolveSigningKey
  ) {
    if (
      receipt.recipientDid !== recipientDid ||
      receipt.originalId !== envelope.aad.messageId ||
      receipt.message.messageId === receipt.originalId ||
      receipt.message.senderDid !== envelope.aad.senderDid
    ) {
      return yield* new EnvelopeFailure({
        reason: "Invalid delegated custody",
      });
    }

    const signed = yield* openPlaintext(envelope, resolveSigningKey);

    const payload = yield* Schema.decodeUnknownEffect(PayloadJson)(
      new TextDecoder().decode(signed.body)
    );

    if (
      receipt.delegatedFor === undefined ||
      payload.to !== receipt.delegatedFor
    ) {
      return yield* new EnvelopeFailure({
        reason: "Invalid delegated recipient",
      });
    }

    return signed;
  }
);
