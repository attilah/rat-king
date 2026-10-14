import { it } from "@effect/vitest";
import {
  attend,
  formatReason,
  reasonTone,
  Reasons,
  Verdicts,
} from "@rat-king/ratking-client/attend";
import {
  recipientLevels,
  recipientLines,
  storedReason,
} from "@rat-king/ratking-client/delivery";
import { Effect, Option, Predicate, Schema } from "effect";
import { expect } from "vitest";

import { defaultPreferences } from "../../mailbox-client/src/attention.ts";
import {
  AgentName,
  Kind,
  Payload,
  ReplyRef,
  SUMMARY_HARD_MAX,
} from "../../mailbox-client/src/payload.ts";

const ArrivalSample = Schema.Struct({
  digestMinutes: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 }))
  ),
  kind: Schema.Literals(["message", "reply"]),
  wakeStatus: Schema.optionalKey(
    Schema.Literals(["matched", "timedOut", "targetGone", "failed"])
  ),
});

it.prop(
  "Quiet sender intent never wakes without a receiver override",
  [ArrivalSample],
  ([sample]) => {
    const verdict = attend(
      { ...sample, quiet: true },
      {},
      0,
      undefined,
      Option.none()
    );

    expect(verdict._tag).toBe(
      sample.digestMinutes === undefined ? "Next" : "Later"
    );
    expect(verdict.reason.facts).toContain("quiet");
    expect(verdict.reason.facts).not.toContain("cc");
    expect(reasonTone(verdict.reason)).toBe(
      sample.digestMinutes === undefined ? "quiet" : "held"
    );
    expect(formatReason(verdict.reason)).toBe(
      sample.digestMinutes === undefined
        ? "quiet: sender"
        : "held: quiet digest"
    );
    expect(storedReason(formatReason(verdict.reason))?.facts).toContain(
      "quiet"
    );

    if (Predicate.isTagged(verdict, "Later")) {
      expect(verdict.window).toBe((sample.digestMinutes ?? 0) * 60_000);
    }
  }
);

it.prop(
  "Joel and verified owners keep their exemption ahead of quiet and receiver levers",
  [ArrivalSample, Schema.Literals(["joel", "operator", "owner"])],
  ([sample, sender]) => {
    const verdict = attend(
      { ...sample, quiet: true, sender, verified: true },
      {
        enabled: true,
        owner: "owner",
        prefs: { ...defaultPreferences(), refuse: [sender] },
      },
      0,
      undefined,
      Option.some(Verdicts.Never({ reason: Reasons.judge({ facts: [] }) }))
    );

    expect(verdict._tag).toBe("Now");
    expect(verdict.reason._tag).toBe(sender === "owner" ? "intent" : "joel");
  }
);

it.prop(
  "Quiet cannot suppress an ask, even on a copy",
  [Schema.Boolean],
  ([copy]) => {
    expect(
      attend(
        { copy, digestMinutes: 10, kind: "ask", quiet: true },
        {},
        0,
        undefined,
        Option.none()
      )._tag
    ).toBe("Now");
    expect(
      recipientLevels("owner", ["other"], "ask", true).map(
        (recipient) => recipient.level
      )
    ).toEqual(["wake", "wake"]);
  }
);

it.prop(
  "Quiet primary receipts say no wake for messages and replies",
  [Schema.Literals(["message", "reply"])],
  ([kind]) => {
    const recipients = recipientLevels("owner", [], kind, true);
    expect(recipients).toEqual([{ level: "quiet", name: "owner" }]);
    expect(recipientLines(recipients).join("\n")).toContain(
      "quiet copy, no wake"
    );
    expect(recipientLines(recipients).join("\n")).not.toContain("woken");
  }
);

it.prop(
  "Receiver levers and model advice remain ahead of quiet intent",
  [ArrivalSample, Schema.Boolean],
  ([sample, refuse]) => {
    const suggestion = Verdicts.Now({
      reason: Reasons.judge({ facts: ["to"] }),
    });

    const verdict = attend(
      { ...sample, quiet: true, sender: "peer", verified: true },
      {
        enabled: true,
        prefs: { ...defaultPreferences(), refuse: refuse ? ["peer"] : [] },
      },
      0,
      undefined,
      Option.some(suggestion)
    );

    expect(verdict._tag).toBe(refuse ? "Never" : "Now");
    expect(verdict.reason._tag).toBe(refuse ? "lever" : "judge");
  }
);

const OldPayload = Schema.Struct({
  body: Schema.String,
  cc: Schema.optionalKey(Schema.Array(AgentName)),
  from: AgentName,
  kind: Schema.optionalKey(Kind),
  label: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
  reply: Schema.optionalKey(ReplyRef),
  replyTo: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(SUMMARY_HARD_MAX))
  ),
  thread: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(AgentName),
});

it.effect.prop(
  "The old schema ignores quiet and retains waking intent",
  [Payload],
  ([payload]) =>
    Effect.gen(function* oldReader() {
      const decoded = yield* Schema.decodeUnknownEffect(OldPayload)({
        ...payload,
        quiet: true,
      });

      expect(decoded).not.toHaveProperty("quiet");
      expect(decoded).toEqual(yield* Schema.decodeEffect(OldPayload)(payload));
      expect(
        attend(
          { kind: decoded.kind ?? "message" },
          {},
          0,
          undefined,
          Option.none()
        )._tag
      ).toBe("Now");
    })
);
