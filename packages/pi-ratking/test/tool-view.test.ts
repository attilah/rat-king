import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { expect } from "vitest";

import { callView, resultView } from "../src/tool-view.ts";
import { Action } from "../src/tool.ts";
import {
  Tokens,
  Width,
  ansiTheme,
  assertFits,
  joined,
  maybeJoined,
} from "./view-arbitraries.ts";

const Sample = Schema.Struct({
  action: Action,
  cc: Schema.UndefinedOr(Schema.Array(Tokens).check(Schema.isMaxLength(3))),
  encrypt: Schema.UndefinedOr(Schema.Boolean),
  error: Schema.Boolean,
  expanded: Schema.Boolean,
  message: Schema.UndefinedOr(Tokens),
  partial: Schema.Boolean,
  replyTo: Schema.UndefinedOr(Tokens),
  result: Tokens,
  summary: Schema.UndefinedOr(Tokens),
  to: Schema.UndefinedOr(Tokens),
  width: Width,
});

it.effect.prop(
  "tool calls and results fit every width from 1 to 200 columns, strip escapes from network text, and a failed result never shows a success mark",
  [Arbitrary.schema(Sample)],
  ([sample]) =>
    Effect.sync(() => {
      const call = callView(
        "ratking",
        {
          action: sample.action,
          cc: sample.cc?.map(joined),
          encrypt: sample.encrypt,
          message: maybeJoined(sample.message),
          replyTo: maybeJoined(sample.replyTo),
          summary: maybeJoined(sample.summary),
          to: maybeJoined(sample.to),
        },
        ansiTheme
      ).render(sample.width);

      const input = Object.freeze({
        action: sample.action,
        details: sample.error ? { error: true } : {},
        expanded: sample.expanded,
        isError: false,
        isPartial: sample.partial,
        text: joined(sample.result),
      });

      const result = resultView(input, ansiTheme).render(sample.width);

      expect(input.text).toBe(joined(sample.result));

      if (sample.width >= 20) {
        for (const [index, line] of call.entries()) {
          const prefix = index === 0 ? "🐀  " : "    ";
          expect(stripTerminalSequences(line).startsWith(prefix)).toBe(true);
        }

        for (const [index, line] of result.entries()) {
          const plain = stripTerminalSequences(line);
          expect(
            index === 0 ? /^[✓✗⋯↩] {3}/u.test(plain) : plain.startsWith("    ")
          ).toBe(true);
        }
      }

      assertFits(call, sample.width);
      assertFits(result, sample.width);

      if (sample.error && !sample.partial) {
        const first = stripTerminalSequences(result[0] ?? "");

        expect(first.startsWith("✗") || sample.width < 2).toBe(true);
        expect(result.join("\n")).not.toContain("✓");
      }
    })
);
