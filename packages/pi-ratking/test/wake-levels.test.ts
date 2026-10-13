import { it } from "@effect/vitest";
import * as Wake from "@rat-king/lexicon/agentgraph.wake";
import * as Prefs from "@rat-king/lexicon/attention.prefs";
import { Option, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";
import { attend, Reasons, Verdicts } from "../../ratking-client/src/attend.ts";
import {
  ToolPreferences,
  wirePreferences,
} from "../../ratking-client/src/attention.ts";
import { flushWake, WakeRecord } from "../src/wake-record.ts";

const Minutes = Schema.Int.check(
  Schema.isBetween({ maximum: 1440, minimum: 1 })
);

it.prop(
  "digest sender gets exact Later window and decimal tools preserve integer minutes",
  [Minutes],
  ([minutes]) => {
    const prefs = {
      ...defaultPreferences(),
      digest: [{ minutes, name: "worker" }],
    };

    const verdict = attend(
      { from: "worker", kind: "message", verified: true },
      { enabled: true, prefs },
      0,
      undefined,
      Option.none()
    );

    expect(verdict).toEqual(
      Verdicts.Later({
        reason: Reasons.lever({ facts: ["digest"] }),
        window: minutes * 60_000,
      })
    );
    expect(
      wirePreferences(Schema.decodeUnknownSync(ToolPreferences)(prefs)).digest
    ).toEqual(prefs.digest);
    const { digest: _digest, ...old } = prefs;

    expect(Option.isSome(Schema.decodeUnknownOption(Prefs.Main)(old))).toBe(
      true
    );
  }
);

it.prop(
  "unlisted sender keeps intent",
  [Minutes, Schema.Boolean],
  ([minutes, copy]) => {
    const arrival = {
      copy,
      from: "other",
      kind: "message" as const,
      verified: true,
    };

    expect(
      attend(
        arrival,
        {
          enabled: true,
          prefs: {
            ...defaultPreferences(),
            digest: [{ minutes, name: "worker" }],
          },
        },
        0,
        undefined,
        Option.none()
      )
    ).toEqual(attend(arrival, {}, 0, undefined, Option.none()));
  }
);

it.prop(
  "Joel and verified direct owner outrank digest and refusal",
  [Minutes, Schema.Literals(["joel", "project/desk"])],
  ([minutes, sender]) => {
    expect(
      attend(
        {
          from: sender,
          kind: "data",
          sender,
          verified: true,
          wakeStatus: "matched",
        },
        {
          enabled: true,
          owner: "project/desk",
          prefs: {
            ...defaultPreferences(),
            digest: [{ minutes, name: sender }],
            refuse: [sender],
          },
        },
        0,
        undefined,
        Option.none()
      )._tag
    ).toBe("Now");
  }
);

it.prop("refusal outranks digest", [Minutes], ([minutes]) => {
  expect(
    attend(
      { from: "worker", kind: "message", verified: true },
      {
        enabled: true,
        prefs: {
          ...defaultPreferences(),
          digest: [{ minutes, name: "worker" }],
          refuse: ["worker"],
        },
      },
      0,
      undefined,
      Option.none()
    )._tag
  ).toBe("Never");
});

export const wake = (status: Wake.MainValue["status"]): Wake.MainValue =>
  Schema.decodeUnknownSync(Wake.Main)({
    $type: "sh.mschf.agentgraph.wake",
    code: "agent_not_found",
    finishedAt: "2026-01-01T00:01:00Z",
    kind: "pane_output",
    label: "Worker finished",
    source: "herdr_watch",
    startedAt: "2026-01-01T00:00:00Z",
    status,
    text: "Full wake text",
    watch: "watch-a",
  });

it.prop(
  "result rejects more than twelve lines or 2 KB, including UTF-8 bytes",
  [Schema.Literals(["lines", "bytes", "unicode"])],
  ([kind]) => {
    const result =
      kind === "lines"
        ? Array.from({ length: 13 }, () => "x").join("\n")
        : (kind === "bytes" ? "x" : "é").repeat(2049);

    expect(
      Option.isNone(
        Schema.decodeUnknownOption(WakeRecord)({ ...wake("matched"), result })
      )
    ).toBe(true);
  }
);

it.prop(
  "strict wake has no socketPath and encoded record is bounded at 16 KB",
  [Schema.Boolean],
  ([socket]) => {
    const record = socket
      ? { ...wake("matched"), socketPath: "/invented" }
      : {
          ...wake("matched"),
          result: "x".repeat(2048),
          text: "\u0000".repeat(8192),
        };

    expect(Option.isNone(Schema.decodeUnknownOption(WakeRecord)(record))).toBe(
      true
    );
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(WakeRecord)({
          ...wake("matched"),
          result: Array.from({ length: 12 }, () => "x").join("\n"),
        })
      )
    ).toBe(true);
  }
);

it.prop(
  "arbiter synchronous acceptance suppresses direct send, absent acceptance falls back",
  [Schema.Boolean, Schema.Boolean],
  ([accept, throws]) => {
    const direct: string[] = [];
    const events: string[] = [];

    flushWake(
      {
        events: {
          emit: (event, request) => {
            events.push(event);
            expect(request).toMatchObject({
              id: "batch",
              source: "ratking",
              version: 1,
            });

            if (accept) {
              request.accept();
            }

            if (throws) {
              throw new Error("Listener failed");
            }
          },
        },
        sendMessage: (message, options) => {
          expect(options).toEqual({ deliverAs: "followUp", triggerTurn: true });
          direct.push(message.content);
        },
      },
      { content: "batch", customType: "ratking_cc_digest", details: {} },
      "batch"
    );
    expect(events).toEqual(["pi-until:follow-up"]);
    expect(direct).toEqual(accept ? [] : ["batch"]);
  }
);
