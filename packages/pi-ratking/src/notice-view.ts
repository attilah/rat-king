import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Option, Schema } from "effect";

import {
  noLabels,
  oneLine,
  paragraphs,
  party,
  ratKingTitle,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";

const PartyDetails = Schema.Struct({
  body: Schema.optional(Schema.String),
  from: Schema.String,
  label: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
});

const DigestDetails = Schema.Struct({
  messages: Schema.Array(Schema.Unknown),
});

export interface NoticeInput {
  readonly content: string;
  readonly details: unknown;
  readonly expanded: boolean;
  readonly labels?: Labels;
  readonly theme: Paint;
}

const component = (render: (width: number) => readonly string[]): Component => {
  let cache: { lines: string[]; width: number } | undefined;

  return {
    invalidate() {
      cache = undefined;
    },
    render(width) {
      if (width <= 0) {
        return [];
      }

      if (cache?.width !== width) {
        cache = {
          lines: render(width).map((line) =>
            terminalStyles(truncateToWidth(line, width, "…"))
          ),
          width,
        };
      }

      return cache.lines;
    },
  };
};

export const digestView = (input: NoticeInput): Component =>
  component((width) => {
    const labels = input.labels ?? noLabels;
    const decoded = Schema.decodeUnknownOption(DigestDetails)(input.details);

    const entries = Option.match(decoded, {
      onNone: () =>
        input.content.split("\n").filter((line) => line.startsWith("- ")),
      onSome: ({ messages }) =>
        messages.flatMap((details) =>
          Option.match(Schema.decodeUnknownOption(PartyDetails)(details), {
            onNone: () => [],
            onSome: (value) =>
              wrapTextWithAnsi(
                `${party(input.theme, value.from, value.label ?? labels(value.from))} · ${oneLine(value.summary ?? value.body ?? "message").slice(0, 160)}`,
                width
              ),
          })
        ),
    });

    const hints = input.expanded
      ? paragraphs(
          input.content
            .split("\n")
            .filter((line) => !line.startsWith("- "))
            .slice(1)
            .join("\n"),
          width
        ).map((line) => input.theme.fg("dim", line))
      : [];

    return [
      ratKingTitle(input.theme, "cc digest"),
      input.theme.fg("dim", "cc · quiet · held: cc digest"),
      ...entries,
      ...hints,
    ];
  });

export const recordView = (input: NoticeInput): Component =>
  component((width) => {
    const labels = input.labels ?? noLabels;
    const value = Schema.decodeUnknownOption(PartyDetails)(input.details);

    const sender = Option.match(value, {
      onNone: () => "",
      onSome: (details) =>
        ` ${party(input.theme, details.from, details.label ?? labels(details.from))}`,
    });

    return [
      `${ratKingTitle(input.theme, "record")}${sender}`,
      ...paragraphs(input.content, width).map((line) =>
        input.theme.fg("dim", line)
      ),
    ];
  });
