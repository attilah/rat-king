import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Option, Schema } from "effect";

import { compactRecord } from "./agentgraph.ts";
import { COPY_NOTE, Kind, RelaySource, replyHint } from "./payload.ts";
import type { Inbound } from "./payload.ts";
import {
  FRAME_MIN,
  clean,
  clip,
  frame,
  oneLine,
  paragraphs,
  party,
  ratKingTitle,
  noLabels,
  short,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";

const Details = Schema.Struct({
  body: Schema.String,
  cc: Schema.Boolean,
  ccNames: Schema.optional(Schema.Array(Schema.String)),
  did: Schema.String,
  from: Schema.String,
  id: Schema.String,
  kind: Kind,
  label: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  relay: Schema.optional(RelaySource),
  replyTo: Schema.optional(Schema.String),
  sentBy: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  thread: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  verified: Schema.Boolean,
});

export type InboundView = typeof Details.Type;

export const COMPACT_LINES = 4;

const border = (value: InboundView) => {
  if (!value.verified) {
    return "warning";
  }

  return value.sentBy === undefined ? "borderMuted" : "dim";
};

const sender = (
  theme: Paint,
  value: InboundView,
  _withName: boolean,
  labels: Labels = noLabels
) => {
  const mark = value.verified
    ? theme.fg("success", "✓")
    : theme.fg("warning", "⚠");

  const name =
    value.sentBy === undefined ? value.from : (value.to ?? "unknown");

  const label =
    value.sentBy === undefined ? (value.label ?? labels(name)) : labels(name);

  const title = `${value.sentBy === undefined ? "" : "📤 to "}${party(theme, name, label)}`;
  const action = value.sentBy === undefined ? value.kind : "sent";

  return `${mark} ${ratKingTitle(theme, action)} ${title}`;
};

const senderLine = (
  theme: Paint,
  value: InboundView,
  withName: boolean,
  width: number,
  labels: Labels = noLabels
) => {
  const [mark = "", ...rest] = sender(theme, value, withName, labels).split(
    " "
  );

  return width < 3
    ? mark
    : `${mark} ${truncateToWidth(rest.join(" "), width - 2, "…")}`;
};

const tag = (theme: Paint, value: InboundView) => {
  if (value.sentBy !== undefined) {
    return theme.fg("dim", "sent");
  }

  const parts = [
    ...(value.cc
      ? [
          theme.fg(
            "dim",
            value.reason?.startsWith("woken:") === true
              ? "cc · woken"
              : "cc · quiet"
          ),
        ]
      : []),
    ...(value.kind === "ask" ? [theme.fg("warning", "ask")] : []),
    ...(value.kind === "reply" ? [theme.fg("muted", "reply")] : []),
  ];

  return parts.length === 0 ? undefined : parts.join(theme.fg("dim", " · "));
};

const ccText = (value: InboundView, theme: Paint, labels: Labels) =>
  (value.ccNames?.length ?? 0) > 0
    ? `cc ${(value.ccNames ?? []).map((name) => party(theme, name, labels(name))).join(", ")}`
    : undefined;

const meta = (
  theme: Paint,
  value: InboundView,
  hint: string | undefined,
  labels: Labels
) =>
  [
    ...(value.verified ? [] : [theme.fg("warning", "unverified")]),
    ...(value.sentBy === undefined
      ? []
      : [
          `${theme.fg("muted", "sent by")} ${party(theme, value.sentBy, labels(value.sentBy))}`,
        ]),
    ...(value.relay === undefined
      ? []
      : [
          `${theme.fg("muted", "via")} ${party(theme, value.relay.name, labels(value.relay.name))}`,
        ]),
    ...(ccText(value, theme, labels) === undefined
      ? []
      : [ccText(value, theme, labels) ?? ""]),
    ...(value.replyTo === undefined
      ? []
      : [theme.fg("muted", `↩ ${short(value.replyTo)}`)]),
    ...(hint === undefined ? [] : [theme.fg("dim", hint)]),
  ].join(theme.fg("dim", " · "));

const preview = (theme: Paint, value: InboundView, width: number) => [
  ...(value.kind === "data" && Option.isSome(compactRecord(value.body))
    ? wrapTextWithAnsi(
        Option.getOrElse(compactRecord(value.body), () => ""),
        width
      ).map((line) => theme.bold(line))
    : []),
  ...(value.summary === undefined
    ? []
    : wrapTextWithAnsi(oneLine(value.summary), width).map((line) =>
        theme.bold(line)
      )),
  ...paragraphs(
    value.kind === "data" && Option.isSome(compactRecord(value.body))
      ? ""
      : value.body,
    width
  )
    .filter((line) => line !== "")
    .map((line) => theme.fg("customMessageText", line)),
];

const collapsed = (
  theme: Paint,
  value: InboundView,
  width: number,
  labels: Labels
) => {
  if (width < FRAME_MIN) {
    return [
      senderLine(theme, value, false, width, labels),
      ...clip(theme, preview(theme, value, width), COMPACT_LINES - 1, width),
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  const box = frame(theme, width, border(value));

  const lines = preview(theme, value, box.inner);
  const room = COMPACT_LINES - 2;

  return [
    box.top(sender(theme, value, false, labels), tag(theme, value)),
    ...clip(theme, lines, room, box.inner).map(box.row),
    box.bottom(meta(theme, value, "ctrl+o expands", labels)),
  ];
};

const expanded = (
  theme: Paint,
  tool: string,
  value: InboundView,
  width: number,
  labels: Labels
) => {
  const box = frame(theme, width, border(value));

  const inner = width < FRAME_MIN ? width : box.inner;

  const dim = (text: string) =>
    wrapTextWithAnsi(text, inner).map((line) => theme.fg("dim", line));

  const details = [
    ...(value.verified
      ? []
      : wrapTextWithAnsi(
          `unverified name; sender ${oneLine(value.did)}`,
          inner
        ).map((line) => theme.fg("warning", line))),
    ...(value.relay === undefined
      ? []
      : dim(
          `via ${party(theme, value.relay.name, labels(value.relay.name))}${value.relay.encrypted ? " · encrypted" : ""}`
        )),
    ...(value.sentBy === undefined
      ? []
      : dim(`sent by ${party(theme, value.sentBy, labels(value.sentBy))}`)),
    ...(value.to === undefined || value.sentBy !== undefined
      ? []
      : dim(`to ${party(theme, value.to, labels(value.to))}`)),
    ...(ccText(value, theme, labels) === undefined
      ? []
      : dim(ccText(value, theme, labels) ?? "")),
    ...(value.reason === undefined ? [] : dim(value.reason)),
    ...(value.cc &&
    (value.reason === "quiet: cc" || value.reason === "held: cc digest")
      ? dim(COPY_NOTE)
      : []),
    ...(value.replyTo === undefined
      ? []
      : dim(`↩ in reply to ${oneLine(value.replyTo)}`)),
    ...(value.thread === undefined
      ? []
      : dim(`thread ${oneLine(value.thread)}`)),
    ...dim(`id ${oneLine(value.id)}`),
  ];

  const summary =
    value.summary === undefined
      ? []
      : [
          ...wrapTextWithAnsi(oneLine(value.summary), inner).map((line) =>
            theme.bold(line)
          ),
          "",
        ];

  const body = paragraphs(value.body, inner).map((line) =>
    theme.fg("customMessageText", line)
  );

  const inbound: Inbound = {
    body: value.body,
    cc: value.cc,
    did: value.did,
    from: value.from,
    id: oneLine(value.id),
    kind: value.kind,
    label: Option.none(),
    replyTo: Option.none(),
    summary: Option.none(),
    verified: value.verified,
  };

  if (value.relay !== undefined) {
    Object.assign(inbound, { relay: value.relay });
  }

  const hint = replyHint(tool, inbound);

  const hints =
    value.sentBy === undefined
      ? clean(hint)
          .split("\n")
          .flatMap((line) => dim(line))
      : dim(
          `Context only: ${oneLine(value.sentBy)} already sent this. No reply needed.`
        );

  if (width < FRAME_MIN) {
    return [
      senderLine(theme, value, true, width, labels),
      ...summary,
      ...body,
      "",
      ...details,
      ...hints,
    ].map((line) => truncateToWidth(line, width, "…"));
  }

  return [
    box.top(sender(theme, value, true, labels), tag(theme, value)),
    ...[...summary, ...body, "", ...details].map(box.row),
    box.rule(),
    ...hints.map(box.row),
    box.bottom(),
  ];
};

export const inboundLines = (input: {
  readonly expanded: boolean;
  readonly labels?: Labels;
  readonly theme: Paint;
  readonly tool: string;
  readonly value: InboundView;
  readonly width: number;
}): readonly string[] => {
  if (input.width <= 0) {
    return [];
  }

  return input.expanded
    ? expanded(
        input.theme,
        input.tool,
        input.value,
        input.width,
        input.labels ?? noLabels
      )
    : collapsed(
        input.theme,
        input.value,
        input.width,
        input.labels ?? noLabels
      );
};

export const messageView = (input: {
  readonly details: unknown;
  readonly expanded: boolean;
  readonly labels?: Labels;
  readonly theme: Paint;
  readonly tool: string;
}): Component | undefined =>
  Schema.decodeUnknownOption(Details)(input.details).pipe(
    Option.map((value) => {
      let cache: { width: number; lines: string[] } | undefined;

      return {
        invalidate() {
          cache = undefined;
        },
        render(width: number) {
          if (cache?.width !== width) {
            cache = {
              lines: inboundLines({ ...input, value, width }).map(
                terminalStyles
              ),
              width,
            };
          }

          return cache.lines;
        },
      };
    }),
    Option.getOrUndefined
  );
