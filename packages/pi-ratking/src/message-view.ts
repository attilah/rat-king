import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Match, Option, Schema } from "effect";

import { compactRecord } from "./agentgraph.ts";
import { formatReason, reasonTone } from "./attend.ts";
import { DeliveryReason, storedReason } from "./delivery.ts";
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
  noLabels,
  recordType,
  short,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";
import { Box } from "./ui/box.ts";
import { Fold } from "./ui/fold.ts";
import { Footer } from "./ui/footer.ts";
import { Header } from "./ui/header.ts";
import { Tag } from "./ui/tag.ts";

const Details = Schema.Struct({
  body: Schema.String,
  cc: Schema.Boolean,
  ccNames: Schema.optional(Schema.Array(Schema.String)),
  did: Schema.String,
  from: Schema.String,
  id: Schema.String,
  kind: Kind,
  label: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.Union([DeliveryReason, Schema.String])),
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

const actionOf = (value: InboundView) => {
  if (value.sentBy !== undefined) {
    return "sent to";
  }

  if (value.cc) {
    return "cc from";
  }

  if (value.kind === "message") {
    return "from";
  }

  return `${value.kind === "data" ? `record ${recordType(value.body)}` : value.kind} from`;
};

const sender = (
  theme: Paint,
  value: InboundView,
  expanded: boolean,
  labels: Labels = noLabels
) => {
  const mark = value.verified ? "" : `${theme.fg("warning", "⚠")} `;

  const name =
    value.sentBy === undefined ? value.from : (value.to ?? "unknown");

  const label =
    value.sentBy === undefined ? (value.label ?? labels(name)) : labels(name);

  const action = actionOf(value);

  const reply =
    value.kind === "reply" && value.replyTo !== undefined
      ? theme.fg(
          "muted",
          ` · ↩ ${expanded ? oneLine(value.replyTo) : short(value.replyTo)}`
        )
      : "";

  return `${mark}${Header({ party: party(theme, name, label), theme, variant: "inbound", verb: action })}${reply}`;
};

const senderLine = (
  theme: Paint,
  value: InboundView,
  withName: boolean,
  width: number,
  labels: Labels = noLabels
) =>
  !value.verified && width < 3
    ? theme.fg("warning", "⚠")
    : truncateToWidth(sender(theme, value, withName, labels), width, "…");

const reasonText = (value: NonNullable<InboundView["reason"]>): string =>
  Match.value(value).pipe(
    Match.when(Match.string, (text) => {
      const reason = storedReason(text);

      return reason === undefined ? text : formatReason(reason);
    }),
    Match.orElse(formatReason)
  );

const copyNotice = (value: InboundView): boolean => {
  const reason = storedReason(value.reason);

  return value.cc && reason !== undefined && reasonTone(reason) !== "woken";
};

const tag = (theme: Paint, value: InboundView) => {
  const reason = storedReason(value.reason);
  const tone = reason === undefined ? undefined : reasonTone(reason);
  const held = tone === "held";

  const quiet = value.cc && value.kind !== "ask" && tone !== "woken";

  const nondefault = value.sentBy === undefined && (held || quiet);

  const level = held ? "held" : "quiet";

  return Tag({
    theme,
    variant: nondefault ? level : "default",
  });
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
  Footer({
    cc: ccText(value, theme, labels),
    hint: hint === undefined ? undefined : theme.fg("dim", hint),
    relay:
      value.relay === undefined
        ? undefined
        : `${theme.fg("muted", "via")} ${party(theme, value.relay.name, labels(value.relay.name))}`,
    reply:
      value.replyTo === undefined
        ? undefined
        : theme.fg("muted", `↩ ${short(value.replyTo)}`),
    sentBy:
      value.sentBy === undefined
        ? undefined
        : `${theme.fg("muted", "sent by")} ${party(theme, value.sentBy, labels(value.sentBy))}`,
    theme,
    warning: value.verified ? undefined : theme.fg("warning", "unverified"),
  });

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

  return Box({
    body: clip(theme, lines, room, box.inner),
    border: border(value),
    footer: meta(theme, value, "ctrl+o expands", labels),
    header: sender(theme, value, false, labels),
    tag: tag(theme, value),
    theme,
    width,
  });
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
    ...(value.reason === undefined ? [] : dim(reasonText(value.reason))),
    ...(copyNotice(value) ? dim(COPY_NOTE) : []),
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

  return Box({
    body: [...summary, ...body, "", ...details],
    border: border(value),
    header: sender(theme, value, true, labels),
    tag: tag(theme, value),
    tail: hints,
    theme,
    width,
  });
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

  return Fold({
    collapsed: () =>
      collapsed(
        input.theme,
        input.value,
        input.width,
        input.labels ?? noLabels
      ),
    expanded: input.expanded,
    full: () =>
      expanded(
        input.theme,
        input.tool,
        input.value,
        input.width,
        input.labels ?? noLabels
      ),
  });
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
