import { it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";
import { inbox } from "../src/pending.ts";
import { receiveWake } from "../src/wake-record.ts";

it.prop(
  "wake digest neither shows nor acknowledges before its deadline",
  [Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 }))],
  ([minutes]) => {
    const shown: string[] = [];
    const acked: string[] = [];

    const box = inbox({
      digest: (mails, variant) => {
        expect(variant).toBe("wake");
        shown.push(...mails.map((mail) => mail.id));
      },
      show: (mail) => {
        shown.push(mail.id);
      },
    });

    receiveWake(
      {
        consume: (id) => {
          acked.push(id);
        },
        take: box.take,
        withdraw: box.withdraw,
      },
      {
        did: "did:key:invented",
        from: "worker",
        id: "wake",
        levers: {
          enabled: true,
          prefs: {
            ...defaultPreferences(),
            digest: [{ minutes, name: "worker" }],
          },
        },
        record: {
          $type: "sh.mschf.agentgraph.wake",
          finishedAt: "2026-01-01T00:01:00Z",
          kind: "ping",
          label: "Watch",
          source: "herdr_ping_wait",
          startedAt: "2026-01-01T00:00:00Z",
          status: "failed",
          text: "Wake",
          watch: "watch",
        },
        replyTo: Option.none(),
        verified: true,
      },
      false,
      0
    );
    box.tick(0);
    box.flushNext();
    box.tick(minutes * 60_000 - 1);
    expect(shown).toEqual([]);
    expect(acked).toEqual([]);
    box.tick(minutes * 60_000);
    expect(shown).toEqual(["wake"]);
    expect(acked).toEqual([]);
  }
);
