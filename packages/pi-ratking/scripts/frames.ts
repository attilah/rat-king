import { truncateToWidth } from "@earendil-works/pi-tui";

import { Box } from "../src/ui/box.ts";
import { Brand } from "../src/ui/brand.ts";
import { Fault } from "../src/ui/fault.ts";
import { Preview } from "../src/ui/fold.ts";
import { Footer } from "../src/ui/footer.ts";
import { Header } from "../src/ui/header.ts";
import { Party } from "../src/ui/party.ts";
import { Receipt } from "../src/ui/receipt.ts";
import { ShortId } from "../src/ui/short-id.ts";
import { Tag } from "../src/ui/tag.ts";

const theme = {
  bold: (text: string) => text,
  fg: (_colour: string, text: string) => text,
};

const party = Party({ label: "🔮 Merlin", name: "sample/desk", theme });

const header = Header({ party, theme, variant: "inbound", verb: "from" });

interface Entry {
  readonly dont: string;
  readonly example: string;
  readonly intent: string;
  readonly name: string;
  readonly pattern: string;
  readonly props: string;
  readonly render: (width: number) => readonly string[];
  readonly variants: string;
}

const entries: readonly Entry[] = [
  {
    dont: "Draw a second brand mark in a view.",
    example: "[Brand({ theme })]",
    intent: "Own the rat mark.",
    name: "Brand",
    pattern: "call-capsule",
    props: "theme",
    render: () => [Brand({ theme })],
    variants: "none",
  },
  {
    dont: "Build identities by concatenating a callsign and raw name in a view.",
    example: "[Party({ label: '🔮 Merlin', name: 'sample/desk', theme })]",
    intent: "Anchor a party with its callsign or raw-name fallback.",
    name: "Party",
    pattern: "identity-anchor",
    props: "label?, name, theme, variant?",
    render: () => [party],
    variants: "collapsed | expanded",
  },
  {
    dont: "Add another header to a delivery result.",
    example:
      "[Header({ party: Party({ name: 'sample/desk', theme }), theme, variant: 'inbound', verb: 'from' })]",
    intent: "Compose the rat, verb, party and short facts.",
    name: "Header",
    pattern: "call-capsule",
    props: "colour?, facts?, party?, theme, variant, verb",
    render: () => [header],
    variants: "call | inbound | digest | record",
  },
  {
    dont: "Render a tag for the default wake state.",
    example: "[Tag({ theme, variant: 'quiet' }) ?? '']",
    intent: "Own the nondefault right-edge state.",
    name: "Tag",
    pattern: "keyed-slot",
    props: "theme, variant",
    render: () => [Tag({ theme, variant: "quiet" }) ?? ""],
    variants: "default | quiet | held | woken",
  },
  {
    dont: "Shorten ids in model content.",
    example: "[ShortId({ id: '3abcdefghijk' })]",
    intent: "Fold an id to eight characters, retaining the full expanded id.",
    name: "ShortId",
    pattern: "detail-fold",
    props: "expanded?, id",
    render: () => [ShortId({ id: "3abcdefghijk" })],
    variants: "expanded false | true",
  },
  {
    dont: "Put a delivery tick on inbound mail.",
    example:
      "Receipt({ lines: [Party({ name: 'sample/desk', theme }) + ' · ' + ShortId({ id: '3abcdefghijk' })], theme, width })",
    intent: "Mark each delivered recipient without another rat header.",
    name: "Receipt",
    pattern: "detail-fold",
    props: "lines, theme, width",
    render: (width) =>
      Receipt({
        lines: [`${party} · ${ShortId({ id: "3abcdefghijk" })}`],
        theme,
        width,
      }),
    variants: "none",
  },
  {
    dont: "Hide the reason behind expanded diagnostics.",
    example:
      "Fault({ diagnostics: 'Tag: Offline\\nFix: reconnect\\nDebug: no reader', expanded: true, reason: 'Reader offline', theme, width })",
    intent: "Keep failure loud and reveal Tag, Fix and Debug on expansion.",
    name: "Fault",
    pattern: "error-digest",
    props: "diagnostics, expanded, reason, theme, width",
    render: (width) =>
      Fault({
        diagnostics: "Tag: Offline\nFix: reconnect\nDebug: no reader",
        expanded: true,
        reason: "Reader offline",
        theme,
        width,
      }),
    variants: "expanded false | true",
  },
  {
    dont: "Hand-draw borders or measure ANSI text with string length.",
    example:
      "Box({ body: ['The gate is clear.'], border: 'borderMuted', header: Header({ party: Party({ name: 'sample/desk', theme }), theme, variant: 'inbound', verb: 'from' }), theme, width })",
    intent: "Close a rounded mail box at every supported width.",
    name: "Box",
    pattern: "message-fold",
    props: "body, border, footer?, header, tail?, tag?, theme, width",
    render: (width) =>
      Box({
        body: ["The gate is clear."],
        border: "borderMuted",
        footer: "ctrl+o expands",
        header,
        theme,
        width,
      }),
    variants: "borderless below FRAME_MIN; framed otherwise",
  },
  {
    dont: "Change metadata order between views.",
    example:
      "[Footer({ cc: 'cc observer', hint: 'ctrl+o expands', reply: '↩ 3abcdefg', sentBy: 'sent by desk', theme })]",
    intent: "Order sent-by, cc, reply, relay, warning and fold hint.",
    name: "Footer",
    pattern: "message-fold",
    props: "cc?, hint?, relay?, reply?, sentBy?, theme, warning?",
    render: () => [
      Footer({
        cc: "cc observer",
        hint: "ctrl+o expands",
        reply: "↩ 3abcdefg",
        sentBy: "sent by desk",
        theme,
      }),
    ],
    variants: "none",
  },
  {
    dont: "Fold or clip the text the model receives.",
    example:
      "Preview({ expanded: false, lines: ['one', 'two', 'three'], room: 2, theme, width })",
    intent: "Select full or collapsed render without changing model text.",
    name: "Fold",
    pattern: "message-fold",
    props:
      "Fold: collapsed callback, expanded, full callback; Preview: expanded, lines, room, theme, width",
    render: (width) =>
      Preview({
        expanded: false,
        lines: ["one", "two", "three"],
        room: 2,
        theme,
        width,
      }),
    variants: "expanded false | true",
  },
];

export const frames = () =>
  [
    "# Rat King owned primitives",
    "",
    "Generated by `pnpm --filter pi-ratking tui:frames`. Edit the examples in `scripts/frames.ts`, not these frames.",
    "",
    "Inline atoms return one styled string; block primitives return lines. Pass atoms to Header, Footer and Box. The view owns data decoding; primitives own only rendering. `tui.ts` retains compatibility helpers for existing consumers.",
    "",
    ...entries.flatMap((entry) => [
      `## ${entry.name}`,
      "",
      entry.intent,
      "",
      `Props: ${entry.props}.`,
      "",
      `Variants: ${entry.variants}.`,
      "",
      `Pattern: [${entry.pattern}](https://pi-tui.ratstack.sh/patterns/${entry.pattern}.md).`,
      "",
      `Don't: ${entry.dont}`,
      "",
      "```",
      `import { ${entry.name === "Fold" ? "Preview" : entry.name} } from '../../../src/ui/${entry.name === "ShortId" ? "short-id" : entry.name.toLowerCase()}.ts';`,
      entry.example,
      "```",
      "",
      ...[40, 80].flatMap((width) => [
        `### ${width} columns`,
        "",
        "```text",
        ...entry.render(width).map((line) => truncateToWidth(line, width, "…")),
        "```",
        "",
      ]),
    ]),
  ].join("\n");
