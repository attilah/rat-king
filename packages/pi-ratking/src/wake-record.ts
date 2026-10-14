import * as Wake from "@rat-king/lexicon/agentgraph.wake";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import * as Status from "@rat-king/lexicon/attention.status";
import { signedTurn } from "@rat-king/lexicon/turns";
import type { TurnValue } from "@rat-king/lexicon/turns";
import { Option, Predicate, Schema } from "effect";

import { attend } from "../../ratking-client/src/attend.ts";
import type { Verdict } from "../../ratking-client/src/attend.ts";
import type { InboundRecord } from "../../ratking-client/src/payload.ts";
import { Dispositions, verdictToHold } from "./pending.ts";
import type { Hold, PendingMail } from "./pending.ts";

export const TURN_SHOWN_ENTRY = "ratking.turn.shown";

const TurnShown = Schema.Struct({ key: Schema.String });

export interface TurnSessionEntry {
  readonly customType?: string;
  readonly data?: unknown;
  readonly type: string;
}

export const shownTurnKeys = (
  entries: readonly TurnSessionEntry[]
): readonly string[] =>
  entries.flatMap((entry) =>
    entry.type === "custom" && entry.customType === TURN_SHOWN_ENTRY
      ? Option.match(Schema.decodeUnknownOption(TurnShown)(entry.data), {
          onNone: () => [],
          onSome: ({ key }) => [key],
        })
      : []
  );

export const turnKey = (turn: Pick<TurnValue, "state" | "turnId">): string =>
  JSON.stringify([turn.turnId, turn.state]);

export const turnWake = (
  inbound: InboundRecord,
  settled: boolean,
  seen: ReadonlySet<string>
): Option.Option<TurnValue> =>
  signedTurn(inbound.record, inbound.from, inbound.verified).pipe(
    Option.filter(
      (turn) =>
        !settled &&
        (turn.state === "done" ||
          turn.state === "blocked" ||
          turn.state === "crashed") &&
        !seen.has(turnKey(turn))
    )
  );

export interface TurnWakeHost {
  readonly consume: (id: string) => void;
  readonly take: (mail: PendingMail, hold: Hold) => void;
}

export const turnInbox = (host: TurnWakeHost) => {
  const displayed = new Set<string>();
  const pending = new Map<string, Set<string>>();
  let remember: ((key: string) => void) | undefined;

  return {
    receive: (inbound: InboundRecord, settled: boolean) => {
      const turn = turnWake(
        inbound,
        settled,
        new Set([...displayed, ...pending.keys()])
      );

      if (Option.isNone(turn)) {
        const duplicate = signedTurn(
          inbound.record,
          inbound.from,
          inbound.verified
        ).pipe(
          Option.flatMap((value) =>
            Option.fromUndefinedOr(pending.get(turnKey(value)))
          )
        );

        if (!settled && Option.isSome(duplicate)) {
          duplicate.value.add(inbound.id);
        } else {
          host.consume(inbound.id);
        }

        return;
      }

      const key = turnKey(turn.value);
      pending.set(key, new Set([inbound.id]));
      host.take(
        {
          content: `turn · ${turn.value.agent} · ${turn.value.state} · ${turn.value.stopReason ?? turn.value.reason ?? ""}`,
          details: {
            body: JSON.stringify(inbound.record),
            cc: false,
            did: inbound.did,
            from: inbound.from,
            id: inbound.id,
            kind: "data",
            verified: inbound.verified,
          },
          id: inbound.id,
        },
        "steer"
      );
    },
    restore: (
      keys: readonly string[],
      note: ((key: string) => void) | undefined
    ) => {
      displayed.clear();
      pending.clear();
      remember = note;

      for (const key of keys) {
        displayed.add(key);
      }
    },
    shown: (id: string) => {
      for (const [key, ids] of pending) {
        if (ids.has(id)) {
          displayed.add(key);
          pending.delete(key);
          remember?.(key);

          for (const duplicate of ids) {
            host.consume(duplicate);
          }
        }
      }
    },
  };
};

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
