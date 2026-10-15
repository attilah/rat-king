import { it } from "@effect/vitest";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import { Option, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";
import type { Hold } from "../src/pending.ts";
import { receiveWake } from "../src/wake-record.ts";

const Input = Schema.Struct({
  route: Schema.Literals(["wake", "quiet", "digest", "hide"]),
  status: Schema.Literals([
    "matched",
    "timedOut",
    "targetGone",
    "failed",
    "cancelled",
  ]),
});

it.prop(
  "wake filters cannot promote today's wake route, suppress quiet/digest wakes, and preserve cancellation control effects even when hidden",
  [Input],
  ([input]) => {
    const acks: string[] = [];
    const holds: Hold[] = [];

    const base = {
      id: "wake",
      match: { type: "sh.mschf.agentgraph.wake" },
      route: input.route,
    };

    const rule = Schema.decodeUnknownSync(Prefs.Rule)(
      input.route === "digest" ? { ...base, minutes: 11 } : base
    );

    receiveWake(
      {
        consume: (id) => {
          acks.push(id);
        },
        take: (_mail, hold) => {
          holds.push(hold);
        },
        withdraw: () => ["previous"],
      },
      {
        did: "did:web:worker.example.invalid",
        from: "fleet/worker",
        id: "wake",
        levers: {
          enabled: true,
          prefs: { ...defaultPreferences(), rules: [rule] },
        },
        record: {
          $type: "sh.mschf.agentgraph.wake",
          finishedAt: "2026-01-01T00:01:00Z",
          kind: "pane_output",
          label: "Worker",
          result: "result",
          source: "herdr_watch",
          startedAt: "2026-01-01T00:00:00Z",
          status: input.status,
          text: "Text",
          watch: "watch-a",
        },
        replyTo: Option.none(),
        verified: true,
      },
      false,
      0
    );

    if (input.status === "cancelled") {
      expect(acks).toEqual(["previous", "wake"]);
      expect(holds).toEqual([]);

      return;
    }

    if (input.route === "hide") {
      expect(acks).toEqual(["wake"]);
      expect(holds).toEqual([]);

      return;
    }

    expect(acks).toEqual([]);

    const immediate =
      input.route === "wake" &&
      (input.status === "targetGone" || input.status === "failed");

    expect(holds).toEqual([immediate ? "steer" : "nextTurn"]);
  }
);
