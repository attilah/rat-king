import * as Wake from "@rat-king/lexicon/agentgraph.wake";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as Status from "@rat-king/lexicon/attention.status";
import { Option, Predicate, Schema } from "effect";

import { attend } from "../../ratking-client/src/attend.ts";
import type { Verdict } from "../../ratking-client/src/attend.ts";
import type { InboundRecord } from "../../ratking-client/src/payload.ts";
import { Dispositions, verdictToHold } from "./pending.ts";
import type { Hold, PendingMail } from "./pending.ts";

const WakeLevers = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  owner: Schema.optionalKey(Schema.String),
  prefs: Schema.optionalKey(Prefs.Main),
  status: Schema.optionalKey(Status.Main),
});

export const WAKE_RECORD = "sh.mschf.agentgraph.wake";

export const WakeRecord = Wake.Main.check(
  Schema.makeFilter(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 16_384,
    { expected: "encoded wake record at most 16 KB" }
  )
);

export interface FollowUp {
  readonly content: string;
  readonly customType: string;
  readonly details: unknown;
}

export interface FollowUpRequest extends FollowUp {
  readonly accept: () => void;
  readonly id: string;
  readonly source: "ratking";
  readonly version: 1;
}

export interface FollowUpHost {
  readonly events: {
    readonly emit: (event: string, payload: FollowUpRequest) => void;
  };
  readonly sendMessage: (
    message: FollowUp & { readonly display: true },
    options: { readonly deliverAs: "followUp"; readonly triggerTurn: true }
  ) => void;
}

const offerWake = (host: FollowUpHost, message: FollowUp, id: string) => {
  let accepted = false;

  try {
    host.events.emit("pi-until:follow-up", {
      accept: () => {
        accepted = true;
      },
      ...message,
      id,
      source: "ratking",
      version: 1,
    });
  } catch {
    return accepted;
  }

  return accepted;
};

export const flushWake = (
  host: FollowUpHost,
  message: FollowUp,
  id: string
) => {
  const accepted = offerWake(host, message, id);

  if (!accepted) {
    host.sendMessage(
      { ...message, display: true },
      { deliverAs: "followUp", triggerTurn: true }
    );
  }

  return accepted;
};

export interface WakeHost {
  readonly consume: (id: string) => void;
  readonly take: (mail: PendingMail, hold: Hold) => void;
  readonly withdraw: (watch: string) => readonly string[];
}

const pendingWake = (
  inbound: InboundRecord,
  record: Wake.MainValue,
  verdict: Verdict,
  now: number
): PendingMail => {
  const pending: PendingMail = {
    coalesce: true,
    content: record.text,
    details: {
      body: record.text,
      from: inbound.from,
      id: inbound.id,
      kind: "data",
      summary: `${record.label} · ${record.status}`,
      wake: record,
    },
    id: inbound.id,
    wake: true,
    watch: record.watch,
  };

  return Predicate.isTagged(verdict, "Later")
    ? { ...pending, notBefore: now + verdict.window }
    : pending;
};

export const receiveWake = (
  host: WakeHost,
  inbound: InboundRecord,
  settled: boolean,
  now: number
) => {
  const decoded = Schema.decodeUnknownOption(WakeRecord)(inbound.record);

  if (settled || Option.isNone(decoded)) {
    host.consume(inbound.id);

    return;
  }

  const record = decoded.value;

  if (record.status === "cancelled") {
    for (const id of host.withdraw(record.watch)) {
      host.consume(id);
    }

    host.consume(inbound.id);

    return;
  }

  const verdict = attend(
    {
      from: inbound.from,
      kind: "data",
      verified: inbound.verified,
      wakeStatus: record.status,
    },
    Option.getOrElse(
      Schema.decodeUnknownOption(WakeLevers)(inbound.levers),
      () => ({})
    ),
    now,
    undefined,
    Option.none()
  );

  const decision = verdictToHold(verdict);

  Dispositions.$match(decision, {
    Inject: ({ hold }) => {
      host.take(pendingWake(inbound, record, verdict, now), hold);
    },
    Settle: () => {
      host.consume(inbound.id);
    },
  });
};
