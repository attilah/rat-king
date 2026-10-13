import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { inboundLines } from "../src/message-view.ts";
import { callView, resultView } from "../src/tool-view.ts";
import { Party } from "../src/ui/party.ts";
import { mail, themes } from "./inline-fixtures.ts";
import { plainTheme } from "./view-arbitraries.ts";

const Sample = Schema.Struct({
  action: Schema.Literals(["send", "reply", "record"]),
  cc: Schema.Boolean,
  known: Schema.Boolean,
  role: Schema.Literals(["desk", "scout", "judge"]),
  senderOnly: Schema.Boolean,
  summary: Schema.String.check(Schema.isPattern(/^[a-z]{10,80}$/u)),
});

const plain = (lines: readonly string[]) => lines.map(stripTerminalSequences);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z]+/u)
    .filter((word) => word !== "");

const unique = (text: string) =>
  new Set(words(text)).size === words(text).length;

it.effect.prop(
  "collapsed call and receipt show each party and summary once, the id once, CC wake facts, and a resolved reply header with its sender-only exception",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const name = `sample/sample-${sample.role}`;
      const label = `💬 ${sample.role}`;

      const lookup = (recipient: string) => {
        const known = recipient === name ? label : "🦉 observer";

        return sample.known ? known : undefined;
      };

      const party = Party({ label, name, theme: plainTheme });

      expect(unique(party)).toBe(true);
      expect(unique(`${party} ${name}`)).toBe(false);
      expect(
        Party({ label, name, theme: plainTheme, variant: "expanded" })
      ).toBe(`${label} (${name})`);
      expect(Party({ name, theme: plainTheme })).toBe(name);

      for (const { theme } of themes) {
        for (const width of [40, 60, 80, 120]) {
          const state = {};
          const copies = sample.cc && sample.action !== "record";

          const args = {
            action: sample.action,
            cc: copies ? ["sample/observer"] : [],
            replyAll: !sample.senderOnly,
            replyTo: sample.action === "reply" ? "3rootabcdef" : undefined,
            summary: sample.summary,
            to: sample.action === "reply" ? undefined : name,
          };

          const call = callView("ratking", args, theme, lookup, { state });
          const before = plain(call.render(width)).join("\n");

          if (sample.action === "reply") {
            expect(before).not.toContain(name);
          }

          const input = Object.freeze({
            action: sample.action,
            details: copies
              ? {
                  id: "3abcdefghijk",
                  recipients: [
                    { level: "wake", name },
                    { level: "quiet", name: "sample/observer" },
                  ],
                }
              : { id: "3abcdefghijk", to: name },
            expanded: false,
            isError: false,
            isPartial: false,
            text: `Delivered to ${name} over Rat King (id 3abcdefghijk, seq 9).`,
          });

          const receipt = plain(
            resultView(input, theme, lookup, { state }).render(width)
          );

          const header = plain(call.render(width)).join("\n");
          const combined = [header, ...receipt].join("\n");
          const anchor = sample.known ? label : name;

          expect(combined.split(anchor)).toHaveLength(2);
          expect(combined.split(sample.summary.slice(0, 10))).toHaveLength(2);
          expect(combined.split("3abcdefg")).toHaveLength(2);
          expect(receipt).toHaveLength(copies ? 2 : 1);
          expect(receipt[0]).toBe(copies ? "✓ woken · 3abcdefg" : "✓ 3abcdefg");

          if (copies) {
            const observer = sample.known ? "🦉 observer" : "sample/observer";
            expect(header).toContain("+1 cc");
            expect(header).not.toContain(observer);
            expect(combined.split(observer)).toHaveLength(2);
            expect(receipt[1]).toBe(`✓ ${observer} · quiet`);
          }

          if (sample.action === "reply" && width >= 80) {
            expect(header).toContain(`reply → ${anchor}`);
            expect(header).toContain("↩ 3rootabc");
            expect(header.includes("sender only")).toBe(sample.senderOnly);
          }

          expect(
            plain(
              callView("ratking", args, theme, lookup, { state }).render(width)
            ).join("\n")
          ).toBe(header);

          for (const line of [...call.render(width), ...receipt]) {
            expect(visibleWidth(line)).toBeLessThanOrEqual(width);
          }

          const expanded = plain(
            resultView({ ...input, expanded: true }, theme, lookup, {
              state,
            }).render(120)
          ).join("\n");

          expect(expanded).toContain(name);
          expect(input.text).toBe(
            `Delivered to ${name} over Rat King (id 3abcdefghijk, seq 9).`
          );
        }
      }
    })
);

it.effect.prop(
  "inbound headers spend compact space on summaries, repeated body prefixes render once, and reply ids stay only in the header/footer pair",
  [
    Arbitrary.schema(
      Schema.Struct({ expanded: Schema.Boolean, remainder: Schema.Boolean })
    ),
  ],
  ([sample]) =>
    Effect.sync(() => {
      const body = sample.remainder ? "pong\nThe gate is clear." : "pong";

      const value = Object.freeze({
        ...mail,
        body,
        from: "sample/sample-desk",
        kind: "reply" as const,
        label: "💬 desk",
        replyTo: "3replyabcdef",
        summary: "pong",
      });

      for (const { theme } of themes) {
        for (const width of [40, 60, 80, 120]) {
          const lines = plain(
            inboundLines({
              expanded: sample.expanded,
              theme,
              tool: "ratking",
              value,
              width,
            })
          );

          const rendered = lines.join("\n");

          expect(rendered.split("pong")).toHaveLength(2);
          expect(lines[0]).toContain(
            sample.expanded
              ? "💬 desk (sample/sample-desk)".slice(0, 12)
              : "💬 desk"
          );
          expect(lines.at(-1)).not.toContain("↩");
          expect(rendered).not.toContain("✓");
          expect(value.body).toBe(body);
        }
      }
    })
);

it.effect.prop(
  "pending omits empty sections and has no delivery tick, including the no-open-asks result",
  [
    Arbitrary.schema(
      Schema.Struct({ inbound: Schema.Boolean, outbound: Schema.Boolean })
    ),
  ],
  ([sample]) =>
    Effect.sync(() => {
      const text = `**Inbound unanswered asks:**\n${sample.inbound ? "- peer · inbound1 · ping\n" : ""}**Outbound open asks:**\n${sample.outbound ? "- to peer · outbound1 · pong" : ""}`;

      for (const expanded of [false, true]) {
        const rendered = plain(
          resultView(
            {
              action: "pending",
              details: {},
              expanded,
              isError: false,
              isPartial: false,
              text,
            },
            plainTheme
          ).render(120)
        ).join("\n");

        expect(rendered.includes("Inbound unanswered asks:")).toBe(
          sample.inbound
        );
        expect(rendered.includes("Outbound open asks:")).toBe(sample.outbound);
        expect(rendered.includes("No open asks")).toBe(
          !sample.inbound && !sample.outbound
        );
        expect(rendered).not.toContain("✓");
      }
    })
);
