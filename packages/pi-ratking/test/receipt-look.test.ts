import {
  Box,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { inboundLines } from "../src/message-view.ts";
import { digestView, recordView } from "../src/notice-view.ts";
import { resultView } from "../src/tool-view.ts";
import { terminalStyles } from "../src/tui.ts";
import { digest, labels, mail, record, themes } from "./inline-fixtures.ts";
import {
  receiptBox,
  receiptFixtures,
  receiptTheme,
} from "./receipt-look-fixtures.ts";

const Sample = Schema.Struct({
  expanded: Schema.Boolean,
  width: Schema.Literals([80, 100]),
});

const assertBackground = (lines: readonly string[], width: number) => {
  for (const line of lines) {
    expect(visibleWidth(line)).toBe(width);
    let painted = false;
    const [prefix = "", ...segments] = line.split("\u001B[");
    expect(prefix).toBe("");

    for (const segment of segments) {
      const end = segment.indexOf("m");
      const code = segment.slice(0, end);

      if (code === "0" || code === "49") {
        painted = false;
      }

      if (code.startsWith("48;")) {
        painted = true;
      }

      if (segment.slice(end + 1) !== "") {
        expect(painted, JSON.stringify(segment)).toBe(true);
      }
    }
  }
};

it.effect.prop(
  "Pi Box paints every cell behind tools, messages and notices without child background resets",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      for (const fixture of Object.values(receiptFixtures)) {
        assertBackground(
          receiptBox(fixture, sample.expanded).render(sample.width),
          sample.width
        );
      }

      for (const { theme } of themes) {
        const components = [
          {
            invalidate() {},
            render: (width: number) => [
              ...inboundLines({
                expanded: sample.expanded,
                labels,
                theme,
                tool: "ratking",
                value: mail,
                width,
              }),
            ],
          },
          digestView({ ...digest, expanded: sample.expanded, labels, theme }),
          recordView({ ...record, expanded: sample.expanded, labels, theme }),
        ];

        for (const component of components) {
          const box = new Box(1, 1, (text) => theme.bg("toolSuccessBg", text));
          box.addChild(component);
          assertBackground(box.render(sample.width), sample.width);
        }
      }

      const box = new Box(1, 0, (text) =>
        receiptTheme.bg("toolSuccessBg", text)
      );

      box.addChild({
        invalidate() {},
        render: () => [terminalStyles("\u001B[1mstyled\u001B[0m tail")],
      });
      assertBackground(box.render(sample.width), sample.width);
    })
);

it.effect.prop(
  "collapsed call and receipt are tight, each recipient appears once, full ids stay in model content and expanded metadata",
  [Arbitrary.schema(Schema.Literals([80, 100]))],
  ([width]) =>
    Effect.sync(() => {
      for (const [name, fixture] of Object.entries(receiptFixtures)) {
        const rendered = receiptBox(fixture, false).render(width);
        const rows = rendered.map(stripTerminalSequences);
        const content = rows.slice(1, -1);
        expect(
          content.every((line) => line.trim() !== ""),
          name
        ).toBe(true);

        if (fixture.result.isError) {
          expect(content.join("\n")).toContain("✗");
          expect(content.join("\n")).toContain("NOT DELIVERED");
        } else {
          expect(content.length, name).toBeLessThanOrEqual(4);
          const text = content.join("\n");
          expect(text).not.toContain("3fixturemsg");
          expect(text).not.toContain("seq ");
          expect(text).toContain("✓");

          const target =
            name === "sender only" ? "📁 Archive · Desk" : "peer/desk";

          expect(text.split(target).length - 1, name).toBe(1);

          if (name === "reply all with cc") {
            expect(text.split("💬 Observer · Desk").length - 1).toBe(1);
            expect(text).not.toContain("observer/desk");
            expect(text).toContain("quiet");
          }

          if (name === "sender only") {
            expect(text).not.toContain("archive/desk");
            expect(text).toContain("sender only");
          }

          expect(text).toMatch(/(?:96|63) ms/u);

          const expanded = receiptBox(fixture, true)
            .render(width)
            .map(stripTerminalSequences)
            .join("\n");

          const id = name === "sender only" ? "3fixturemsg02" : "3fixturemsg01";
          expect(expanded).toContain(id);
          expect(expanded).toContain("seq ");
          expect(fixture.result.text).toContain(id);
        }
      }

      const long = {
        ...receiptFixtures.send,
        call: {
          ...receiptFixtures.send.call,
          summary: `${"The gate is clear. ".repeat(12)}summary-tail`,
        },
      };

      const collapsed = receiptBox(long, false).render(width);
      const expanded = receiptBox(long, true).render(width);

      expect(collapsed.length - 2).toBeLessThanOrEqual(4);
      expect(expanded.map(stripTerminalSequences).join("\n")).toContain(
        "summary-tail"
      );
    })
);

it.effect.prop(
  "metadata-only confirmations retain a visible success receipt when collapsed IDs are hidden",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const input = Object.freeze({
        action: "handled",
        details: { id: "3confirmation", seq: 7 },
        expanded: sample.expanded,
        isError: false,
        isPartial: false,
        text: "Reply confirmed over Rat King (id 3confirmation, seq 7).",
      });

      const rendered = resultView(input, receiptTheme)
        .render(sample.width)
        .map(stripTerminalSequences);

      expect(rendered[0]).toBe("✓   confirmed");
      expect(rendered.join("\n").includes("3confirmation")).toBe(
        sample.expanded
      );
      expect(input.text).toContain("3confirmation, seq 7");
    })
);

it.each([80, 100])("receipt fixture snapshots at %s columns", (width) => {
  for (const [name, fixture] of Object.entries(receiptFixtures)) {
    for (const expanded of [false, true]) {
      expect(
        receiptBox(fixture, expanded).render(width).map(stripTerminalSequences)
      ).toMatchSnapshot(`${name}, expanded ${expanded}`);
    }
  }
});
