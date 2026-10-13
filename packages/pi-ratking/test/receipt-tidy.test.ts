import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { recipientLines } from "../src/delivery.ts";
import { callView, resultView } from "../src/tool-view.ts";
import type { ResultInput } from "../src/tool-view.ts";
import { receiptText } from "../src/tool.ts";
import { noLabels, party } from "../src/tui.ts";
import { ansiTheme, plainTheme } from "./view-arbitraries.ts";

const Sample = Schema.Struct({
  action: Schema.Literals(["send", "reply", "ask", "record"]),
  cc: Schema.Boolean,
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]{12}$/u)),
  known: Schema.Boolean,
  trimmed: Schema.Boolean,
});

const leads = new Map([
  ["reply", "Reply delivered to"],
  ["record", "Record delivered to"],
]);

const labels = (name: string) =>
  name === "peer" ? "Merlin · Desk" : "Scout · Watch";

const plain = (lines: readonly string[]) =>
  lines.map(stripTerminalSequences).join("\n");

it.effect.prop(
  "collapsed receipts omit the duplicated rat/action header, show every party and id8 or wake level, expand the model receipt, and never change model content",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const recipients =
        sample.cc && sample.action !== "record"
          ? [
              { level: "wake" as const, name: "peer" },
              {
                level:
                  sample.action === "ask"
                    ? ("wake" as const)
                    : ("quiet" as const),
                name: "observer",
              },
            ]
          : [{ level: "wake" as const, name: "peer" }];

      const delivered = {
        did: "did:web:peer.example.invalid",
        id: sample.id,
        recipients,
        seq: 9,
        to: "peer",
      };

      const reply =
        "**Reply from peer** (id 3replyabcdef):\nThe gate is clear.";

      const text =
        sample.action === "ask"
          ? `${sample.cc ? `${receiptText("Delivered to", delivered)}\n\n` : ""}${reply}`
          : receiptText(leads.get(sample.action) ?? "Delivered to", delivered);

      const model = `${text}${sample.trimmed ? "\nsummary trimmed to 279 characters; the full text leads the message." : ""}`;

      const input: ResultInput = Object.freeze({
        action: sample.action,
        details: Object.freeze(
          sample.action === "record"
            ? { id: sample.id, seq: 9, to: "peer" }
            : { id: sample.id, recipients, replyId: "3replyabcdef", seq: 9 }
        ),
        expanded: false,
        isError: false,
        isPartial: false,
        text: model,
      });

      const lookup = sample.known ? labels : noLabels;

      const collapsed = plain(
        resultView(input, ansiTheme, lookup).render(1000)
      );

      expect(collapsed).not.toContain("🐀");
      expect(collapsed).not.toMatch(/✓ (?:send|reply|ask)(?: ·| )/u);
      expect(collapsed).not.toContain("delivered");
      expect(collapsed).not.toContain("over Rat King");

      for (const recipient of recipients) {
        const level = recipient.level === "wake" ? "woken" : "quiet";
        const suffix = recipients.length === 1 ? sample.id.slice(0, 8) : level;
        expect(collapsed).toContain(
          `${party(plainTheme, recipient.name, lookup(recipient.name))} · ${suffix}`
        );
      }

      expect(collapsed.includes(" · summary trimmed")).toBe(sample.trimmed);

      if (sample.action === "ask") {
        expect(collapsed).toContain("↩");
        expect(collapsed).toContain("The gate is clear.");

        if (!sample.cc) {
          expect(collapsed).toMatch(/^✓ asked /u);
        }
      }

      if (sample.action === "record") {
        expect(collapsed).toMatch(/^✓ record → /u);
      }

      const expanded = plain(
        resultView({ ...input, expanded: true }, plainTheme, lookup).render(
          1000
        )
      );

      const expected = model.replaceAll("**", "");

      for (const line of expected.split("\n").filter((value) => value !== "")) {
        const styled =
          line.startsWith("peer:") || line.startsWith("observer:")
            ? line.replace(/^[^:]+/u, (name) =>
                party(plainTheme, name, lookup(name))
              )
            : line.replace(
                /(?<=[Dd]elivered to |Reply from )peer/u,
                party(plainTheme, "peer", lookup("peer"))
              );

        expect(expanded).toContain(styled);
      }

      expect(input.text).toBe(model);
      expect(receiptText("Delivered to", delivered)).toBe(
        recipients.length > 1
          ? [
              `Delivered over Rat King (id ${sample.id}, seq 9).`,
              ...recipientLines(recipients),
            ].join("\n")
          : `Delivered to peer over Rat King (id ${sample.id}, seq 9).`
      );
    })
);

it.effect.prop(
  "faults retain the loud reason and expanded Tag, Fix and Debug diagnostics for both error signals",
  [
    Arbitrary.schema(
      Schema.Struct({
        details: Schema.Boolean,
        expanded: Schema.Boolean,
        reason: Schema.String.check(Schema.isPattern(/^[a-z ]{1,80}$/u)),
      })
    ),
  ],
  ([sample]) =>
    Effect.sync(() => {
      const text = `${sample.reason}\nTag: NotConfigured\nFix: configure the identity\nDebug: no reader`;

      const rendered = plain(
        resultView(
          {
            action: "send",
            details: { error: sample.details },
            expanded: sample.expanded,
            isError: !sample.details,
            isPartial: false,
            text,
          },
          plainTheme
        ).render(1000)
      );

      expect(rendered).toMatch(/^✗ /u);
      expect(rendered).toContain(sample.reason.trim());
      expect(rendered).not.toContain("✓");
      expect(rendered).not.toContain("🐀");

      if (sample.expanded) {
        for (const diagnostic of text.split("\n").slice(1)) {
          expect(rendered).toContain(diagnostic);
        }
      }
    })
);

it.effect.prop(
  "Call Capsule reuses only its call shell, repaints it on result, and survives a missing shell without another header",
  [Arbitrary.schema(Schema.Boolean)],
  ([partial]) =>
    Effect.sync(() => {
      const state = {};

      const first = callView(
        "ratking",
        { action: "reply", replyTo: "3abcdefghi" },
        ansiTheme,
        labels,
        { state }
      );

      const again = callView(
        "ratking",
        { action: "reply", replyTo: "3abcdefghi" },
        plainTheme,
        labels,
        { state }
      );

      expect(first).toBe(again);
      expect(first).not.toBe(
        callView("ratking", { action: "send" }, plainTheme, labels, {
          state: {},
        })
      );

      const input: ResultInput = {
        action: "reply",
        details: {
          id: "3abcdefghijk",
          recipients: [{ level: "wake", name: "peer" }],
        },
        expanded: false,
        isError: false,
        isPartial: partial,
        text: "Reply delivered to peer over Rat King (id 3abcdefghijk, seq 9).",
      };

      const result = resultView(input, ansiTheme, labels, { state });
      expect(first.render(120).join("\n")).toContain("\u001B[");
      expect(plain(result.render(120))).not.toContain("🐀");
      expect(
        plain(resultView(input, plainTheme, labels, { state: {} }).render(120))
      ).not.toContain("🐀");
    })
);

it.effect.prop(
  "status and list results keep facts without repeating the rat header",
  [Arbitrary.schema(Schema.Boolean)],
  ([expanded]) =>
    Effect.sync(() => {
      for (const [action, text] of [
        [
          "status",
          "🐀 status: peer · reader live · mailbox https://mail.example.invalid",
        ],
        ["list", "Rat King directory:\npeer: live"],
      ]) {
        const result = plain(
          resultView(
            {
              action: action ?? "",
              details: {},
              expanded,
              isError: false,
              isPartial: false,
              text: text ?? "",
            },
            plainTheme
          ).render(1000)
        );

        expect(result).not.toContain("🐀");
        expect(result).toContain("peer");
      }
    })
);
