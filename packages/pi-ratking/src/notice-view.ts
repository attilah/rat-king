import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { DeliveryReason } from "@rat-king/ratking-client/delivery";
import { Option, Schema } from "effect";

import { messageView } from "./message-view.ts";
import { digestLabel } from "./pending.ts";
import {
  noLabels,
  oneLine,
  paragraphs,
  recordType,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";
import { Block, GUTTER } from "./ui/block.ts";
import { BRAND } from "./ui/brand.ts";
import { mailParty } from "./ui/mail-party.ts";
import { Party } from "./ui/party.ts";

const PartyDetails = Schema.Struct({
  body: Schema.optional(Schema.String),
  from: Schema.String,
  id: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["message", "ask", "reply", "data"])),
  label: Schema.optional(Schema.String),
  replyTo: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  verified: Schema.optional(Schema.Boolean),
});

const DigestDetails = Schema.Struct({
  ids: Schema.optional(Schema.Array(Schema.String)),
  messages: Schema.Array(Schema.Unknown),
  reason: Schema.optional(DeliveryReason),
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

const entriesOf = (messages: readonly unknown[]): readonly DigestEntry[] =>
  messages.flatMap((details) =>
    Option.match(Schema.decodeUnknownOption(PartyDetails)(details), {
      onNone: () => [],
      onSome: (value) => [{ depth: 0, details, value }],
    })
  );

const threaded = (messages: readonly unknown[]): readonly DigestEntry[] => {
  const entries = entriesOf(messages);

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

const row = (entry: DigestEntry, input: NoticeInput, width: number): string => {
  const { value } = entry;

  const name = Party({
    label: mailParty({
      from: value.from,
      kind: value.kind ?? "message",
      label: value.label ?? (input.labels ?? noLabels)(value.from),
      verified: value.verified,
    }),
    name: value.from,
    theme: input.theme,
  });

  return truncateToWidth(
    `${"  ".repeat(Math.min(entry.depth, 3))}${name} · ${oneLine(value.summary ?? value.body ?? "message")}`,
    Math.max(1, width - GUTTER),
    "…"
  );
};

const digestVerb = (value: typeof DigestDetails.Type | undefined): string => {
  if (value?.variant === "wake") {
    return value.reason?.facts.includes("wake") === true
      ? "wake"
      : "while you were away";
  }

  return digestLabel(value?.reason);
};

const digestEntries = (
  value: typeof DigestDetails.Type
): readonly DigestEntry[] =>
  value.variant === "wake"
    ? threaded(value.messages)
    : entriesOf(value.messages);

export const digestView = (input: NoticeInput): Component =>
  component((width) => {
    const decoded = Schema.decodeUnknownOption(DigestDetails)(input.details);

    const entries = Option.isSome(decoded) ? digestEntries(decoded.value) : [];

    const rows = Option.isSome(decoded)
      ? entries.map((entry) => row(entry, input, width))
      : input.content
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .map(oneLine);

    const count = Option.isSome(decoded)
      ? decoded.value.messages.length
      : rows.length;

    const ids = Option.isSome(decoded)
      ? (decoded.value.ids ??
        entries.flatMap(({ value }) =>
          value.id === undefined ? [] : [value.id]
        ))
      : [];

    const verb = digestVerb(Option.getOrUndefined(decoded));

    const hints =
      input.expanded &&
      Option.isSome(decoded) &&
      decoded.value.variant !== "wake"
        ? paragraphs(
            input.content
              .split("\n")
              .filter((line) => !line.startsWith("- "))
              .slice(1)
              .join("\n"),
            Math.max(1, width - GUTTER)
          ).map((line) => input.theme.fg("dim", line))
        : [];

    const header = Block({
      body: [...rows, ...hints],
      footer: `${count} messages · ids ${ids.map(oneLine).join(", ")}${input.expanded ? "" : " · ctrl+o expands"}`,
      glyph: `${BRAND}⋯`,
      headline: `${verb} · ${count}`,
      theme: input.theme,
      width,
    });

    return input.expanded &&
      Option.isSome(decoded) &&
      decoded.value.variant === "wake"
      ? [
          ...header,
          ...entries.flatMap(
            ({ details, value }) =>
              messageView({
                details,
                expanded: true,
                labels: input.labels ?? noLabels,
                theme: input.theme,
                tool: input.tool ?? "ratking",
              })?.render(width) ??
              Block({
                body: paragraphs(value.body ?? "", Math.max(1, width - GUTTER)),
                glyph: BRAND,
                headline: `from ${oneLine(value.from)}`,
                theme: input.theme,
                width,
              })
          ),
        ]
      : header;
  });

export const recordView = (input: NoticeInput): Component =>
  component((width) => {
    const value = Schema.decodeUnknownOption(PartyDetails)(input.details);

    const sender = Option.isSome(value)
      ? ` from ${mailParty({ ...value.value, kind: "data" })}`
      : "";

    return Block({
      body: paragraphs(
        input.expanded ? input.content : "Not rendered by this reader",
        Math.max(1, width - GUTTER)
      ),
      footer: `${Option.isSome(value) && value.value.id !== undefined ? `id ${oneLine(value.value.id)} · ` : ""}${input.expanded ? "" : "ctrl+o expands"}`,
      glyph: BRAND,
      headline: `record ${recordType(input.content)}${sender}`,
      theme: input.theme,
      width,
    });
  });
