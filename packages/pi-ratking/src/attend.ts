import type * as Prefs from "@rat-king/lexicon/attention.prefs";
import type * as Status from "@rat-king/lexicon/attention.status";
import { Data, Option } from "effect";

import type { KindValue } from "../../mailbox-client/src/payload.ts";

export interface Arrival {
  readonly copy?: boolean;
  readonly digestMinutes?: number;
  readonly from?: string;
  readonly group?: string;
  readonly kind: KindValue;
  readonly sender?: string;
  readonly sentBy?: string;
  readonly thread?: string;
  readonly verified?: boolean;
  readonly relay?: unknown;
}

export interface Levers {
  readonly enabled?: boolean;
  readonly prefs?: Prefs.MainValue;
  readonly status?: Status.MainValue;
}

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

const senderOf = (arrival: Arrival) =>
  arrival.sender ?? (arrival.verified === true ? arrival.from : undefined);

const isJoel = (arrival: Arrival) =>
  senderOf(arrival) === "joel" || senderOf(arrival) === "operator";

const joelVerdict = (arrival: Arrival, levers: Levers): Verdict | undefined =>
  levers.enabled === true && isJoel(arrival)
    ? Verdicts.Now({ reason: Reasons.joel({ facts: ["to"] }) })
    : undefined;

const leverVerdict = (
  arrival: Arrival,
  levers: Levers,
  now: number
): Verdict | undefined => {
  if (levers.enabled !== true || levers.prefs === undefined) {
    return undefined;
  }

  const { prefs, status } = levers;
  const sender = senderOf(arrival);
  const reason = Reasons.lever({ facts: ["digest"] });

  if (sender !== undefined && prefs.refuse.includes(sender)) {
    return Verdicts.Never({ reason: Reasons.lever({ facts: [] }) });
  }

  if (sender !== undefined && prefs.allow.includes(sender)) {
    return undefined;
  }

  const until =
    status?.until === undefined ? undefined : Date.parse(status.until);

  const dnd = status?.state === "dnd" && (until === undefined || until > now);

  const muted = prefs.mute.some((mute) =>
    mute.$type === "sh.mschf.ratking.attention.prefs#thread"
      ? mute.thread === arrival.thread
      : mute.group === arrival.group
  );

  return dnd || muted
    ? Verdicts.Later({
        reason,
        window: dnd && until !== undefined ? until - now : 60_000,
      })
    : undefined;
};

export const forwardNames = (
  arrival: Arrival,
  levers: Levers
): readonly string[] =>
  levers.enabled === true &&
  arrival.copy !== true &&
  arrival.sentBy === undefined
    ? [...new Set(levers.prefs?.forward)]
    : [];

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
  joelVerdict(arrival, levers) ??
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
