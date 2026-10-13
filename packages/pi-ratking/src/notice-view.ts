import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Option, Schema } from "effect";

import { messageView } from "./message-view.ts";
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
import { ShortId } from "./ui/short-id.ts";
import { Text } from "./ui/text.ts";

const PartyDetails = Schema.Struct({
  body: Schema.optional(Schema.String),
  from: Schema.String,
  id: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  replyTo: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
});

const DigestDetails = Schema.Struct({
  messages: Schema.Array(Schema.Unknown),
  variant: Schema.optional(Schema.Literal("wake")),
});

export interface NoticeInput {
  readonly content: string;
  readonly details: unknown;
  readonly expanded: boolean;
  readonly labels?: Labels;
  readonly theme: Paint;
  readonly tool?: string;
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

interface DigestEntry {
  readonly depth: number;
  readonly details: unknown;
  readonly value: typeof PartyDetails.Type;
}

const threaded = (messages: readonly unknown[]): readonly DigestEntry[] => {
  const entries = messages.flatMap((details) =>
    Option.match(Schema.decodeUnknownOption(PartyDetails)(details), {
      onNone: () => [],
      onSome: (value) => [{ depth: 0, details, value }],
    })
  );

  const ids = new Set(
    entries.flatMap((entry) =>
      entry.value.id === undefined ? [] : [entry.value.id]
    )
  );

  const roots = entries.filter(
    (entry) =>
      entry.value.replyTo === undefined || !ids.has(entry.value.replyTo)
  );

  const seen = new Set<unknown>();
  const ordered: DigestEntry[] = [];
  const stack = [...roots, ...entries].toReversed();

  while (stack.length > 0) {
    const entry = stack.pop();

    if (entry === undefined || seen.has(entry.details)) {
      continue;
    }

    seen.add(entry.details);
    ordered.push(entry);

    if (entry.value.id !== undefined) {
      stack.push(
        ...entries
          .flatMap((child) =>
            child.value.replyTo === entry.value.id
              ? [{ ...child, depth: entry.depth + 1 }]
              : []
          )
          .toReversed()
      );
    }
  }

  return ordered;
};

const wakeLines = (
  input: NoticeInput,
  messages: readonly unknown[],
  width: number
): readonly string[] => {
  const labels = input.labels ?? noLabels;
  const entries = threaded(messages);

  const header = Header({
    facts: [String(messages.length)],
    theme: input.theme,
    variant: "digest",
    verb: "while you were away",
  });

  const rows = entries.map(({ depth, value }) =>
    Text({
      suffix: input.theme.fg(
        "dim",
        ` · ${ShortId({ id: value.id ?? "unknown" })}`
      ),
      text: `${"  ".repeat(Math.min(depth, 3))}${Party({ label: value.label ?? labels(value.from), name: value.from, theme: input.theme })}${input.theme.fg("dim", ` · ${oneLine(value.summary ?? value.body ?? "message")}`)}`,
      width,
    })
  );

  if (!input.expanded) {
    return [
      header,
      ...rows.slice(0, 8),
      ...(rows.length > 8
        ? [input.theme.fg("dim", `+${rows.length - 8} more`)]
        : []),
      input.theme.fg("dim", "ctrl+o expands"),
    ];
  }

  return [
    header,
    ...entries.flatMap(
      ({ details, value }) =>
        messageView({
          details,
          expanded: true,
          labels,
          theme: input.theme,
          tool: input.tool ?? "ratking",
        })?.render(width) ?? paragraphs(value.body ?? "", width)
    ),
  ];
};

export const digestView = (input: NoticeInput): Component =>
  component((width) => {
    const labels = input.labels ?? noLabels;
    const decoded = Schema.decodeUnknownOption(DigestDetails)(input.details);

    if (Option.isSome(decoded) && decoded.value.variant === "wake") {
      return wakeLines(input, decoded.value.messages, width);
    }

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
