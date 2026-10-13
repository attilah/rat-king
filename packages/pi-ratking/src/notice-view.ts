import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Option, Schema } from "effect";

import {
  FRAME_MIN,
  clip,
  frame,
  noLabels,
  oneLine,
  paragraphs,
  recordType,
  short,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";
import { Box } from "./ui/box.ts";
import { Fold } from "./ui/fold.ts";
import { Header } from "./ui/header.ts";
import { Party } from "./ui/party.ts";

const PartyDetails = Schema.Struct({
  body: Schema.optional(Schema.String),
  from: Schema.String,
  id: Schema.optional(Schema.String),
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
                `${Party({ label: value.label ?? labels(value.from), name: value.from, theme: input.theme, variant: input.expanded ? "expanded" : "collapsed" })} · ${oneLine(value.summary ?? value.body ?? "message").slice(0, 160)}`,
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

    const count = Option.match(decoded, {
      onNone: () => entries.length,
      onSome: ({ messages }) => messages.length,
    });

    const header = Header({
      facts: [String(count)],
      theme: input.theme,
      variant: "digest",
      verb: "cc digest",
    });

    const body = Fold({
      collapsed: () => clip(input.theme, entries, 2, width),
      expanded: input.expanded,
      full: () => [...entries, ...hints],
    });

    return [header, ...body];
  });

export const recordView = (input: NoticeInput): Component =>
  component((width) => {
    const labels = input.labels ?? noLabels;
    const value = Schema.decodeUnknownOption(PartyDetails)(input.details);

    const sender = Option.match(value, {
      onNone: () => "",
      onSome: (details) =>
        ` from ${Party({ label: details.label ?? labels(details.from), name: details.from, theme: input.theme, variant: input.expanded ? "expanded" : "collapsed" })}`,
    });

    const header = `${Header({ theme: input.theme, variant: "record", verb: `record ${recordType(input.content)}` })}${sender}`;
    const box = frame(input.theme, width, "borderMuted");
    const inner = width < FRAME_MIN ? width : box.inner;

    const body = paragraphs(
      input.expanded ? input.content : "Not rendered by this reader",
      inner
    ).map((line) => input.theme.fg("dim", line));

    const id = Option.match(value, {
      onNone: () => "",
      onSome: (details) =>
        details.id === undefined
          ? ""
          : `${input.expanded ? oneLine(details.id) : short(details.id)} · `,
    });

    return width < FRAME_MIN
      ? [header, ...body]
      : Box({
          body,
          border: "borderMuted",
          footer: input.theme.fg(
            "dim",
            `${id}${input.expanded ? "" : "ctrl+o expands"}`
          ),
          header,
          theme: input.theme,
          width,
        });
  });
