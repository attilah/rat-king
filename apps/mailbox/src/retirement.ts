import type * as Defs from "@rat-king/lexicon/defs";
import { DateTime } from "effect";

import { failure } from "./failure.ts";
import type { LeaseValue, RetirementValue, Transaction } from "./store.ts";

export const isoTime = (millis: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(millis));

export const retiredMessage = (retirement: RetirementValue) =>
  `${retirement.name} was retired at ${isoTime(retirement.retiredAt)}; ${
    retirement.successor === undefined
      ? "no successor"
      : `current row is ${retirement.successor}`
  }`;

export const refuseRetired = (tx: Transaction) => {
  const retirement = tx.retirement();

  if (retirement !== undefined) {
    throw failure("Retired", 410, retiredMessage(retirement));
  }
};

export const standingOf = (
  tx: Transaction,
  staticDocuments: readonly Defs.DidDocumentValue[]
) => {
  const recipient = tx.recipient();

  return {
    exists:
      tx.document() !== undefined ||
      staticDocuments.some((document) => document.id === recipient),
    retirement: tx.retirement(),
  };
};

export const markRetired = (
  tx: Transaction,
  staticDocuments: readonly Defs.DidDocumentValue[],
  retirement: RetirementValue
) => {
  if (!standingOf(tx, staticDocuments).exists) {
    throw failure("NameNotFound", 404);
  }

  tx.setRetirement(retirement);

  return retirement;
};

export interface Presence {
  readonly renders?: readonly string[];
  readonly held: boolean;
  readonly lastHeldAt?: number;
}

export const presenceOf = (
  lease: LeaseValue | undefined,
  now: number
): Presence => {
  if (lease === undefined) {
    return { held: false };
  }

  if (lease.expiresAt <= now) {
    return { held: false, lastHeldAt: lease.expiresAt };
  }

  return { held: true, lastHeldAt: now, renders: lease.renders ?? [] };
};
