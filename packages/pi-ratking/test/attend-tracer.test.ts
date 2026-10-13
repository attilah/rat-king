import { it } from "@effect/vitest";
import {
  attend,
  formatReason,
  Reasons,
  Verdicts,
} from "@rat-king/ratking-client/attend";
import type { Arrival } from "@rat-king/ratking-client/attend";
import { Kind } from "@rat-king/ratking-client/payload";
import { Option, Schema } from "effect";
import { expect } from "vitest";

import { messageView } from "../src/message-view.ts";
import type { InboundView } from "../src/message-view.ts";
import { applyDelivery, Dispositions, verdictToHold } from "../src/pending.ts";
import type { Hold } from "../src/pending.ts";
import { plainTheme } from "./view-arbitraries.ts";

const Arrivals = Schema.Struct({
  copy: Schema.optionalKey(Schema.Boolean),
  digestMinutes: Schema.optionalKey(Schema.Number),
  kind: Kind,
  relay: Schema.optionalKey(Schema.Literal("relay")),
  replyTo: Schema.Option(Schema.String),
});

const deliveryMode = (arrival: Arrival): Hold => {
  if (
    arrival.copy !== true ||
    arrival.kind === "ask" ||
    arrival.relay !== undefined
  ) {
    return "steer";
  }

  return arrival.digestMinutes === undefined ? "nextTurn" : "digest";
};

const oldReason = (arrival: Arrival): string => {
  if (
    arrival.copy === true &&
    arrival.kind !== "ask" &&
    arrival.relay === undefined
  ) {
    return arrival.digestMinutes === undefined
      ? "quiet: cc"
      : "held: cc digest";
  }

  if (arrival.kind === "ask") {
    return "woken: ask";
  }

  return arrival.kind === "reply" ? "woken: reply" : "woken: to";
};

it.prop(
  "intent verdicts preserve the old delivery mode and exact reason for every arrival",
  [Arrivals, Schema.Number],
  ([arrival, now]) => {
    const verdict = attend(arrival, {}, now, undefined, Option.none());

    expect(verdictToHold(verdict)).toEqual(
      Dispositions.Inject({ hold: deliveryMode(arrival) })
    );
    expect(formatReason(verdict.reason)).toBe(oldReason(arrival));
  },
  { arbitrary: { runs: 1000 } }
);

it.prop(
  "every verdict has an explicit delivery path and Never settles custody without injection",
  [Schema.Literals(["Now", "Next", "Later", "Never"])],
  ([kind]) => {
    const reason = Reasons.judge({ facts: ["to"] });

    const verdicts = {
      Later: Verdicts.Later({ reason, window: 60_000 }),
      Never: Verdicts.Never({ reason }),
      Next: Verdicts.Next({ reason }),
      Now: Verdicts.Now({ reason }),
    };

    const events: string[] = [];
    const pending = new Set(["message"]);

    applyDelivery(verdictToHold(verdicts[kind]), {
      inject: (hold) => {
        events.push(hold, "shown");
        pending.delete("message");
        events.push("ack");
      },
      settle: () => {
        pending.delete("message");
        events.push("ack");
      },
    });

    expect(pending.size).toBe(0);
    expect(events).toEqual(
      {
        Later: ["digest", "shown", "ack"],
        Never: ["ack"],
        Next: ["nextTurn", "shown", "ack"],
        Now: ["steer", "shown", "ack"],
      }[kind]
    );
  }
);

it.prop(
  "tagged reasons render byte-identically to legacy session reasons",
  [
    Arrivals,
    Schema.Boolean,
    Schema.Int.check(Schema.isBetween({ maximum: 200, minimum: 1 })),
  ],
  ([arrival, expanded, width]) => {
    const { reason } = attend(arrival, {}, 0, undefined, Option.none());

    const details = {
      body: "progress",
      cc: arrival.copy === true,
      did: "did:web:peer.example.invalid",
      from: "peer",
      id: "message",
      kind: arrival.kind,
      verified: true,
    };

    const render = (value: InboundView) =>
      messageView({
        details: value,
        expanded,
        theme: plainTheme,
        tool: "ratking",
      })?.render(width);

    expect(render({ ...details, reason })).toEqual(
      render({ ...details, reason: oldReason(arrival) })
    );
  }
);
