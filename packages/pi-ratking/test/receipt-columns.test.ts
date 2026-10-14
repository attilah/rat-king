import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { callView, resultView } from "../src/tool-view.ts";
import { clean } from "../src/tui.ts";
import { Block, GUTTER } from "../src/ui/block.ts";
import { Tokens, ansiTheme, assertFits, joined } from "./view-arbitraries.ts";

const ColumnWidth = Schema.Int.check(
  Schema.isBetween({ maximum: 160, minimum: 20 })
);

const Sample = Schema.Struct({
  glyph: Schema.Literals(["🐀", "✓", "✗", "⋯", "↩", "!"]),
  text: Tokens,
  width: ColumnWidth,
});

const plain = (lines: readonly string[]) => lines.map(stripTerminalSequences);

const dim = ansiTheme.fg("dim", "").slice(0, -5);

it.effect.prop(
  "the reusable block aligns every right column for every source/status glyph and width 20 to 160",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const text = clean(joined(sample.text));

      const rendered = Block({
        body: ["body wraps across several lines with 漢字 and 🐀"],
        footer: "footer-id · seq 2108 · peer",
        glyph: sample.glyph,
        headline: text,
        theme: ansiTheme,
        width: sample.width,
      });

      for (const [index, line] of plain(rendered).entries()) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(sample.width);
        const mark = index === 0 ? sample.glyph : "";
        expect(
          line.startsWith(`${mark}${" ".repeat(GUTTER - visibleWidth(mark))}`)
        ).toBe(true);
      }
    })
);

const ReceiptSample = Schema.Struct({
  action: Schema.Literals(["send", "reply", "record", "handled"]),
  seq: Schema.Int.check(Schema.isBetween({ maximum: 9999, minimum: 1 })),
  trimmed: Schema.Boolean,
  width: ColumnWidth,
});

it.effect.prop(
  "single-recipient success has no repeated action, party or summary and all full ids and sequence facts live in dim footer rows",
  [Arbitrary.schema(ReceiptSample)],
  ([sample]) =>
    Effect.sync(() => {
      const model = `Delivered to peer over Rat King (id 3abcdefghijk, seq ${sample.seq}).${sample.trimmed ? "\nsummary trimmed to 274 characters; the full text leads the message." : ""}`;

      const input = {
        action: sample.action,
        details: { id: "3abcdefghijk", seq: sample.seq, to: "peer" },
        expanded: false,
        isError: false,
        isPartial: false,
        text: model,
      };

      const rendered = resultView(
        input,
        ansiTheme,
        () => "🤓 Brains · Desk"
      ).render(sample.width);

      assertFits(rendered, sample.width);
      const text = plain(rendered).join("\n");
      expect(text).not.toContain(sample.action);
      expect(text).not.toContain("🐀");
      expect(text).not.toContain("Brains");
      expect(text).not.toContain("Gate ready");
      expect(text.replaceAll(/\s/gu, "")).toContain(
        `3abcdefghijk·seq${sample.seq}`
      );

      for (const line of rendered) {
        expect(line).toContain(dim);
        expect(line).not.toContain(ansiTheme.fg("text", "").slice(0, -5));
      }

      expect(input.text).toBe(model);
    })
);

it.effect.prop(
  "refusals keep the Tag, why, fix and debug readable in collapsed and expanded modes",
  [
    Arbitrary.schema(
      Schema.Struct({ expanded: Schema.Boolean, width: ColumnWidth })
    ),
  ],
  ([sample]) =>
    Effect.sync(() => {
      const rendered = resultView(
        {
          action: "send",
          details: { error: true },
          expanded: sample.expanded,
          isError: false,
          isPartial: false,
          text: "Tag: NotConfigured\nwhy: no identity\nfix: configure identity\ndebug: no reader",
        },
        ansiTheme
      ).render(sample.width);

      assertFits(rendered, sample.width);
      expect(plain(rendered)[0]).toMatch(/^✗ {3}Tag:/u);
      const text = plain(rendered).join("\n");

      for (const field of ["Tag:", "why:", "fix:", "debug:"]) {
        expect(text).toContain(field);
      }

      for (const line of rendered) {
        expect(line).not.toContain(dim);
      }
    })
);

it.effect.prop(
  "expanded calls retain the full message body under the same gutter",
  [Arbitrary.schema(ColumnWidth)],
  ([width]) =>
    Effect.sync(() => {
      const call = callView(
        "ratking",
        {
          action: "send",
          message: "Full body\nSecond paragraph",
          summary: "Gate ready",
          to: "peer",
        },
        ansiTheme,
        undefined,
        { expanded: true, state: {} }
      ).render(width);

      assertFits(call, width);
      const text = plain(call).join("\n");
      expect(text).toContain("Full body");
      expect(text).toContain("Second paragraph");
    })
);
