import { canonical, plaintext } from "@rat-king/envelope/canonical";
import * as Defs from "@rat-king/lexicon/defs";
import type { XrpcFailure } from "@rat-king/lexicon/xrpc-failure";
import {
  Clock,
  Context,
  DateTime,
  Effect,
  Option,
  Predicate,
  Schema,
} from "effect";

import { PayloadJson } from "../../../packages/mailbox-client/src/payload.ts";
import type { PayloadValue } from "../../../packages/mailbox-client/src/payload.ts";
import { randomTid } from "../../../packages/mailbox-client/src/tid.ts";
import { delegation } from "../../../packages/ratking-client/src/delegation.ts";
import { AttentionDirectory, delegates } from "./attention-directory.ts";
import { base64url } from "./auth.ts";
import { failure } from "./failure.ts";
import { refuseRetired } from "./retirement.ts";
import { MailboxStore } from "./store.ts";
import type { Message } from "./store.ts";

export const DelegatedCopy = Schema.Struct({
  copyId: Schema.String,
  delegateDid: Schema.String,
  delegatedFor: Schema.String,
  envelope: Defs.EncryptedEnvelope,
  originalId: Schema.String,
});

export type DelegatedCopyValue = typeof DelegatedCopy.Type;

export class DelegationTransport extends Context.Service<
  DelegationTransport,
  {
    readonly append: (
      did: string,
      copy: DelegatedCopyValue
    ) => Effect.Effect<void, XrpcFailure>;
  }
>()("mailbox/DelegationTransport") {}

const verifiedArrival = Effect.fn("Delegation.verifiedArrival")(
  function* verifiedArrival(
    envelope: Defs.EncryptedEnvelopeValue,
    payload: Option.Option<PayloadValue>,
    critical: boolean | undefined,
    operators: readonly string[]
  ) {
    const directory = yield* AttentionDirectory;

    const sender = Option.isNone(payload)
      ? Option.none()
      : yield* directory.resolve(payload.value.from);

    const name =
      Option.isSome(payload) &&
      Option.isSome(sender) &&
      sender.value === envelope.aad.senderDid
        ? payload.value.from
        : envelope.aad.senderDid;

    const addressed =
      Option.isNone(payload) || payload.value.to === undefined
        ? Option.none<string>()
        : yield* directory.resolve(payload.value.to);

    const arrival = {
      copy:
        Option.isNone(addressed) ||
        addressed.value !== envelope.aad.recipientDid,
      critical: critical === true,
      encrypted: !plaintext(envelope),
      kind: Option.isSome(payload)
        ? (payload.value.kind ?? "message")
        : "message",
      operator: operators.includes(envelope.aad.senderDid),
      sender: name,
    } as const;

    return { arrival, payload };
  }
);

export const prepareDelegation = Effect.fn("Delegation.prepare")(
  function* prepareDelegation(
    envelope: Defs.EncryptedEnvelopeValue,
    signed: Defs.SigningPayloadValue | undefined,
    critical: boolean | undefined,
    operators: readonly string[]
  ) {
    const store = yield* MailboxStore;
    const directory = yield* AttentionDirectory;
    const status = yield* store.transaction((tx) => tx.attentionStatus());

    const now = yield* Clock.currentTimeMillis;

    const payload =
      signed === undefined
        ? Option.none<PayloadValue>()
        : yield* Schema.decodeUnknownEffect(PayloadJson)(
            new TextDecoder().decode(signed.body)
          ).pipe(Effect.option);

    const early = delegation(
      {
        critical: critical === true,
        encrypted: !plaintext(envelope),
        kind: Option.isSome(payload)
          ? (payload.value.kind ?? "message")
          : "message",
        operator: operators.includes(envelope.aad.senderDid),
      },
      status,
      now
    );

    if (Predicate.isTagged(early, "Direct")) {
      return Option.none<NonNullable<Message["delegationPending"]>>();
    }

    const { arrival } = yield* verifiedArrival(
      envelope,
      payload,
      critical,
      operators
    );

    const verdict = delegation(arrival, status, now);

    if (
      Predicate.isTagged(verdict, "Direct") ||
      Option.isNone(payload) ||
      payload.value.to === undefined
    ) {
      return Option.none<NonNullable<Message["delegationPending"]>>();
    }

    const target = yield* directory.resolve(verdict.name);

    if (Option.isNone(target) || target.value === envelope.aad.recipientDid) {
      return Option.none<NonNullable<Message["delegationPending"]>>();
    }

    const targetStatus = yield* directory.status(target.value);

    if (delegates(targetStatus, now) && targetStatus.delegate !== undefined) {
      const back = yield* directory.resolve(targetStatus.delegate);

      if (Option.isSome(back) && back.value === envelope.aad.recipientDid) {
        return Option.none<NonNullable<Message["delegationPending"]>>();
      }
    }

    const candidate = randomTid(now);

    const copyId =
      candidate === envelope.aad.messageId ? randomTid(now + 1) : candidate;

    return Option.some({
      copyId,
      delegateDid: target.value,
      delegateName: verdict.name,
      desk: payload.value.to,
    });
  }
);

export const acceptDelegated = Effect.fn("Delegation.accept")(
  function* acceptDelegated(copy: DelegatedCopyValue) {
    const store = yield* MailboxStore;
    const now = yield* Clock.currentTimeMillis;
    const bytes = base64url(canonical(copy.envelope));

    if (
      !plaintext(copy.envelope) ||
      copy.originalId !== copy.envelope.aad.messageId ||
      copy.copyId === copy.originalId
    ) {
      return yield* failure("InvalidRequest");
    }

    return yield* store.transaction((tx) => {
      if (tx.recipient() !== copy.delegateDid) {
        throw failure("Forbidden", 403);
      }

      const existing = tx.get(copy.envelope.aad.senderDid, copy.copyId);

      if (existing !== undefined) {
        if (
          existing.canonicalBytes !== bytes ||
          existing.admission.delegatedFor !== copy.delegatedFor
        ) {
          throw failure("Conflict", 409);
        }

        return;
      }

      refuseRetired(tx);
      const seq = tx.watermark() + 1;

      if (!Number.isSafeInteger(seq)) {
        throw failure("MailboxUnavailable", 503);
      }

      const receipt = Schema.decodeUnknownSync(Defs.Receipt)({
        delegatedFor: copy.delegatedFor,
        message: {
          messageId: copy.copyId,
          senderDid: copy.envelope.aad.senderDid,
        },
        originalId: copy.originalId,
        recipientDid: copy.delegateDid,
        recordedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
        seq,
        state: "accepted",
        wakeReason: "to",
        woke: true,
      });

      tx.append({
        $type: "sh.mschf.ratking.defs#messageEvent",
        envelope: copy.envelope,
        receipt,
        seq,
      });
      tx.put({
        admission: receipt,
        canonicalBytes: bytes,
        current: receipt,
        envelope: copy.envelope,
      });
    });
  }
);

export const flushDelegations = Effect.gen(function* flushDelegations() {
  const store = yield* MailboxStore;
  const transport = yield* DelegationTransport;
  const pending = yield* store.transaction((tx) => tx.pendingDelegations());

  yield* Effect.forEach(
    pending,
    (message) =>
      Effect.gen(function* flushCopy() {
        const route = message.delegationPending;

        if (route === undefined) {
          return;
        }

        yield* transport.append(route.delegateDid, {
          copyId: route.copyId,
          delegateDid: route.delegateDid,
          delegatedFor: route.desk,
          envelope: message.envelope,
          originalId: message.envelope.aad.messageId,
        });
        yield* store.transaction((tx) => {
          const current = tx.get(
            message.admission.message.senderDid,
            message.admission.message.messageId
          );

          if (current?.delegationPending?.copyId === route.copyId) {
            const { delegationPending: _pending, ...settled } = current;
            tx.put(settled);
          }
        });
      }),
    { discard: true }
  );
});
