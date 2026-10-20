import type * as Status from "@rat-king/lexicon/attention.status";
import { Data } from "effect";

import { isOperator } from "./attend.ts";
import type { Arrival } from "./attend.ts";

export interface DelegationArrival extends Arrival {
  readonly critical?: boolean;
  readonly delegated?: boolean;
  readonly encrypted?: boolean;
  readonly openAsk?: boolean;
  readonly operator?: boolean;
}

/* oxlint-disable typescript/no-generated-empty-object-type -- Effect TaggedEnum requires an intentionally empty payload for tag-only variants. */
export type DelegationReason = Data.TaggedEnum<{
  ask: Readonly<Record<never, never>>;
  cc: Readonly<Record<never, never>>;
  critical: Readonly<Record<never, never>>;
  delegated: Readonly<Record<never, never>>;
  encrypted: Readonly<Record<never, never>>;
  exempt: Readonly<Record<never, never>>;
  expired: Readonly<Record<never, never>>;
  inactive: Readonly<Record<never, never>>;
  noDelegate: Readonly<Record<never, never>>;
  openAsk: Readonly<Record<never, never>>;
  operator: Readonly<Record<never, never>>;
  quietDesk: Readonly<Record<never, never>>;
  reply: Readonly<Record<never, never>>;
}>;
/* oxlint-enable typescript/no-generated-empty-object-type */

export const DelegationReasons = Data.taggedEnum<DelegationReason>();

export type Delegation = Data.TaggedEnum<{
  Delegate: { readonly name: string; readonly reason: DelegationReason };
  Direct: { readonly reason: DelegationReason };
}>;

const Verdicts = Data.taggedEnum<Delegation>();

const protectedReason = (
  arrival: DelegationArrival,
  status: Status.MainValue | undefined
): DelegationReason | undefined => {
  if (arrival.encrypted === true) {
    return DelegationReasons.encrypted();
  }

  if (arrival.copy === true) {
    return DelegationReasons.cc();
  }

  if (arrival.delegated === true) {
    return DelegationReasons.delegated();
  }

  if (arrival.operator === true || isOperator(arrival)) {
    return DelegationReasons.operator();
  }

  if (arrival.kind === "ask") {
    return DelegationReasons.ask();
  }

  if (arrival.kind === "reply" && arrival.openAsk === true) {
    return DelegationReasons.openAsk();
  }

  if (arrival.kind === "reply") {
    return DelegationReasons.reply();
  }

  if (arrival.critical === true) {
    return DelegationReasons.critical();
  }

  const sender =
    arrival.sender ?? (arrival.verified === true ? arrival.from : undefined);

  return sender !== undefined && status?.exempt?.includes(sender) === true
    ? DelegationReasons.exempt()
    : undefined;
};

export const delegation = (
  arrival: DelegationArrival,
  status: Status.MainValue | undefined,
  now: number
): Delegation => {
  const reason = protectedReason(arrival, status);

  if (reason !== undefined) {
    return Verdicts.Direct({ reason });
  }

  if (status?.state !== "busy" && status?.state !== "dnd") {
    return Verdicts.Direct({ reason: DelegationReasons.inactive() });
  }

  if (status.until !== undefined && Date.parse(status.until) <= now) {
    return Verdicts.Direct({ reason: DelegationReasons.expired() });
  }

  return status.delegate === undefined
    ? Verdicts.Direct({ reason: DelegationReasons.noDelegate() })
    : Verdicts.Delegate({
        name: status.delegate,
        reason: DelegationReasons.quietDesk(),
      });
};
