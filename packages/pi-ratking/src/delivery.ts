import { Schema } from "effect";

import type { KindValue } from "../../mailbox-client/src/payload.ts";

export const WakeLevel = Schema.Literals(["wake", "quiet"]);

export type WakeLevelValue = typeof WakeLevel.Type;

export const RecipientLevel = Schema.Struct({
  level: WakeLevel,
  name: Schema.String,
});

export type RecipientLevelValue = typeof RecipientLevel.Type;

export const Recipients = Schema.Array(RecipientLevel);

export const DeliveryReason = Schema.Literals([
  "woken: to",
  "woken: ask",
  "woken: reply",
  "quiet: cc",
  "held: cc digest",
]);

export type DeliveryReasonValue = typeof DeliveryReason.Type;

export const DIGEST_REASON: DeliveryReasonValue = "held: cc digest";

export interface Arrival {
  readonly copy?: boolean;
  readonly digestMinutes?: number;
  readonly kind: KindValue;
  readonly relay?: unknown;
}

export const quietCopy = (arrival: Arrival) =>
  arrival.copy === true &&
  arrival.kind !== "ask" &&
  arrival.relay === undefined;

export const deliveryReason = (arrival: Arrival): DeliveryReasonValue => {
  if (quietCopy(arrival)) {
    return arrival.digestMinutes === undefined ? "quiet: cc" : DIGEST_REASON;
  }

  if (arrival.kind === "ask") {
    return "woken: ask";
  }

  return arrival.kind === "reply" ? "woken: reply" : "woken: to";
};

export const recipientLevels = (
  to: string,
  cc: readonly string[],
  kind: KindValue
): readonly RecipientLevelValue[] => [
  { level: "wake", name: to },
  ...cc.map((name): RecipientLevelValue => ({
    level: kind === "ask" ? "wake" : "quiet",
    name,
  })),
];

const levelText = (recipient: RecipientLevelValue, index: number) => {
  if (index === 0) {
    return "woken (to)";
  }

  return recipient.level === "wake"
    ? "woken (cc of an ask)"
    : "quiet copy, no wake (cc: shows next turn or at its digest)";
};

export const recipientLines = (recipients: readonly RecipientLevelValue[]) =>
  recipients.map(
    (recipient, index) => `${recipient.name}: ${levelText(recipient, index)}.`
  );
