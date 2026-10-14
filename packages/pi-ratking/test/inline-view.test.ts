import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { describe, expect } from "vitest";

import { inboundLines } from "../src/message-view.ts";
import { digestView, recordView } from "../src/notice-view.ts";
import { callView, resultView } from "../src/tool-view.ts";
import { Party } from "../src/ui/party.ts";
import {
  digest,
  labels,
  mail,
  messages,
  record,
  results,
  themes,
} from "./inline-fixtures.ts";

const colours: readonly ThemeColor[] = [
  "accent",
  "borderMuted",
  "customMessageText",
  "dim",
  "error",
  "mdHeading",
  "mdLink",
  "muted",
  "success",
  "syntaxFunction",
  "syntaxKeyword",
  "syntaxNumber",
  "syntaxString",
  "syntaxType",
  "text",
  "toolTitle",
  "warning",
];

const assertTheme = (lines: readonly string[], theme: Theme, width: number) => {
  const allowed = [
    "\u001B[0m",
    "\u001B[1m",
    "\u001B[22m",
    "\u001B[39m",
    ...colours.map((colour) => theme.getFgAnsi(colour)),
  ];

  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    let cleared = line;

    for (const escape of allowed.filter((value) => value !== "")) {
      cleared = cleared.replaceAll(escape, "");
    }

    expect(cleared).toBe(stripTerminalSequences(line));
    let bold = false;
    let colour = false;

    for (const part of line.split("\u001B[").slice(1)) {
      const code = part.slice(0, part.indexOf("m"));

      if (code === "0") {
        bold = false;
        colour = false;
      }

      if (code === "1") {
        bold = true;
      }

      if (code === "22") {
        bold = false;
      }

      if (code === "39") {
        colour = false;
      }

      if (code.startsWith("38;")) {
        colour = true;
      }
    }

    expect(bold).toBe(false);
    expect(colour, JSON.stringify(line)).toBe(false);
  }
};

const renders = (theme: Theme, width: number, expanded: boolean) => ({
  ...Object.fromEntries(
    Object.entries(messages).map(([name, value]) => [
      name,
      inboundLines({ expanded, labels, theme, tool: "ratking", value, width }),
    ])
  ),
  ...Object.fromEntries(
    Object.entries(results).map(([name, input]) => {
      const state = {};

      const call = callView(
        "ratking",
        {
          action: input.action,
          cc: name === "send with cc" ? ["observer"] : [],
          replyAll: false,
          replyTo: "3replyabcdef",
          summary: "Gate ready",
          to: input.action === "reply" ? undefined : "peer",
        },
        theme,
        labels,
        { state }
      );

      const result = resultView({ ...input, expanded }, theme, labels, {
        state,
      });

      return [name, [...call.render(width), ...result.render(width)]];
    })
  ),
  "cc digest": digestView({ ...digest, expanded, labels, theme }).render(width),
  "record notice": recordView({ ...record, expanded, labels, theme }).render(
    width
  ),
});

const Sample = Schema.Struct({
  expanded: Schema.Boolean,
  kind: Schema.Literals(["message", "ask", "reply", "data"]),
  level: Schema.Literals(["woken: ask", "quiet: cc", "held: cc digest"]),
  verified: Schema.Boolean,
});

it.effect.prop(
  "every inbound block fits widths 20–200 with a gutter and no frames, in dark and light themes",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      for (const { theme } of themes) {
        for (let width = 20; width <= 200; width += 1) {
          const lines = inboundLines({
            expanded: sample.expanded,
            labels,
            theme,
            tool: "ratking",
            value: {
              ...mail,
              body: "漢字 🐀 gate\nA long unbreakable token: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
              cc: true,
              kind: sample.kind,
              reason: sample.level,
              replyTo: "3replyabcdef",
              sentBy: sample.kind === "message" ? "observer" : undefined,
              to: "peer",
              verified: sample.verified,
            },
            width,
          });

          for (const line of lines) {
            expect(visibleWidth(line)).toBeLessThanOrEqual(width);
          }

          expect(stripTerminalSequences(lines[0] ?? "")).toMatch(/^🐀/u);
          expect(lines.map(stripTerminalSequences).join("\n")).not.toMatch(
            /[╭╮╰╯│]/u
          );

          for (const line of lines.slice(1)) {
            expect(stripTerminalSequences(line)).toMatch(/^ {4}/u);
          }
        }
      }
    })
);

it.effect.prop(
  "headers share rat + verb + party + short facts, inbound never claims delivery, tags only show nondefault wake levels, and expanded ids stay full",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      for (const { theme } of themes) {
        const header = stripTerminalSequences(
          inboundLines({
            expanded: sample.expanded,
            labels,
            theme,
            tool: "ratking",
            value: { ...mail, kind: sample.kind, verified: sample.verified },
            width: 200,
          })[0] ?? ""
        );

        expect(header).toMatch(/^🐀[✓↩⚠] from /u);
        expect(header.includes("⚠")).toBe(!sample.verified);

        for (const [name, value] of Object.entries(messages)) {
          const lines = inboundLines({
            expanded: sample.expanded,
            labels,
            theme,
            tool: "ratking",
            value,
            width: 200,
          });

          const top = stripTerminalSequences(lines[0] ?? "");
          expect(top).toMatch(/^🐀[✓⋯↩] (?:from|sent to) /u);
          expect(top).toContain(
            Party({
              label: labels("peer")?.split(" · ")[0],
              name: "peer",
              theme: { bold: (text) => text, fg: (_colour, text) => text },
              variant: "collapsed",
            })
          );
          expect(top).toMatch(/^🐀[✓⋯↩]/u);
          expect(top).not.toContain("message");
          expect(top).not.toContain("📤");

          if (name === "inbound cc") {
            expect(top).toMatch(/^🐀⋯/u);
          } else {
            expect(top).not.toMatch(/^🐀⋯/u);
          }

          if (value.replyTo !== undefined) {
            expect(lines.map(stripTerminalSequences).join("\n")).toContain(
              value.replyTo
            );
          }
        }

        const recordHeader = stripTerminalSequences(
          recordView({
            ...record,
            expanded: sample.expanded,
            labels,
            theme,
          }).render(200)[0] ?? ""
        );

        expect(recordHeader).toContain(
          "🐀  record example.notice from 🔮 Merlin"
        );
        expect(recordHeader).not.toContain("✓");

        const digestHeader = stripTerminalSequences(
          digestView({
            ...digest,
            expanded: sample.expanded,
            labels,
            theme,
          }).render(200)[0] ?? ""
        );

        expect(digestHeader).toBe("🐀⋯ cc digest · 1");

        const cc = stripTerminalSequences(
          inboundLines({
            expanded: false,
            theme,
            tool: "ratking",
            value: { ...mail, cc: true, reason: sample.level },
            width: 200,
          })[0] ?? ""
        );

        expect(cc).toMatch(/^🐀⋯ from /u);
      }
    })
);

it.effect.prop(
  "the four-width dark/light matrix fits, closes theme styles, bounds collapsed height and repaints without cached colours",
  [Arbitrary.schema(Schema.Boolean)],
  ([expanded]) =>
    Effect.sync(() => {
      for (const { theme } of themes) {
        for (const width of [40, 60, 80, 120]) {
          for (const [name, lines] of Object.entries(
            renders(theme, width, expanded)
          )) {
            assertTheme(lines, theme, width);

            if (!expanded) {
              expect(lines.length, name).toBeLessThanOrEqual(16);
            }
          }
        }
      }

      const source = themes[0]?.theme;
      const target = themes[1]?.theme;
      expect(source).toBeDefined();
      expect(target).toBeDefined();

      if (source !== undefined && target !== undefined) {
        const state = {};

        const shell = callView(
          "ratking",
          { action: "reply", to: "peer" },
          source,
          labels,
          { state }
        );

        const dark = shell.render(80);
        const input = results.reply;

        if (input !== undefined) {
          resultView(input, target, labels, { state });
        }

        expect(shell.render(80)).not.toEqual(dark);
        assertTheme(shell.render(80), target, 80);
      }
    })
);

describe("inline views at the pattern matrix", () => {
  it.each(
    themes.flatMap(({ name, theme }) =>
      [40, 60, 80, 120].flatMap((width) =>
        [false, true].map((expanded) => ({ expanded, name, theme, width }))
      )
    )
  )(
    "$name at $width columns, expanded $expanded",
    ({ expanded, theme, width }) => {
      const views = renders(theme, width, expanded);

      for (const lines of Object.values(views)) {
        assertTheme(lines, theme, width);
      }

      expect(views).toMatchSnapshot();
    }
  );
});
