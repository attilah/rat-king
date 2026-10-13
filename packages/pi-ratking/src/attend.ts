import { Data, Option } from "effect";

import type { KindValue } from "../../mailbox-client/src/payload.ts";

export interface Arrival {
  readonly copy?: boolean;
  readonly digestMinutes?: number;
  readonly kind: KindValue;
  readonly relay?: unknown;
}

export type Levers = Readonly<Record<string, never>>;

export type TurnFold = Readonly<Record<string, never>>;

export type Fact = "to" | "cc" | "ask" | "reply" | "relay" | "digest";

export type Reason = Data.TaggedEnum<{
  intent: { readonly facts: readonly Fact[] };
  judge: { readonly facts: readonly Fact[] };
  joel: { readonly facts: readonly Fact[] };
  lever: { readonly facts: readonly Fact[] };
}>;

export const Reasons = Data.taggedEnum<Reason>();

export type Verdict = Data.TaggedEnum<{
  Later: { readonly reason: Reason; readonly window: number };
  Never: { readonly reason: Reason };
  Next: { readonly reason: Reason };
  Now: { readonly reason: Reason };
}>;

export const Verdicts = Data.taggedEnum<Verdict>();

const joelVerdict = (_arrival: Arrival): Verdict | undefined => undefined;

const leverVerdict = (
  _arrival: Arrival,
  _levers: Levers,
  _now: number
): Verdict | undefined => undefined;

const intent = (arrival: Arrival): Verdict => {
  const facts: Fact[] = [arrival.copy === true ? "cc" : "to"];

  if (arrival.kind === "ask" || arrival.kind === "reply") {
    facts.push(arrival.kind);
  }

  if (arrival.relay !== undefined) {
    facts.push("relay");
  }

  const quiet =
    arrival.copy === true &&
    arrival.kind !== "ask" &&
    arrival.relay === undefined;

  if (quiet && arrival.digestMinutes !== undefined) {
    facts.push("digest");

    return Verdicts.Later({
      reason: Reasons.intent({ facts }),
      window: arrival.digestMinutes * 60_000,
    });
  }

  const reason = Reasons.intent({ facts });

  return quiet ? Verdicts.Next({ reason }) : Verdicts.Now({ reason });
};

export const attend = (
  arrival: Arrival,
  levers: Levers,
  now: number,
  _turnFold: TurnFold | undefined,
  suggestion: Option.Option<Verdict>
): Verdict =>
  joelVerdict(arrival) ??
  leverVerdict(arrival, levers, now) ??
  Option.getOrUndefined(suggestion) ??
  intent(arrival);

export const reasonTone = (reason: Reason): "held" | "quiet" | "woken" => {
  if (reason.facts.includes("digest")) {
    return "held";
  }

  return reason.facts.includes("cc") &&
    !reason.facts.includes("ask") &&
    !reason.facts.includes("relay")
    ? "quiet"
    : "woken";
};

export const formatReason = (reason: Reason): string => {
  const tone = reasonTone(reason);

  if (tone === "held") {
    return "held: cc digest";
  }

  if (tone === "quiet") {
    return "quiet: cc";
  }

  if (reason.facts.includes("ask")) {
    return "woken: ask";
  }

  return reason.facts.includes("reply") ? "woken: reply" : "woken: to";
};
