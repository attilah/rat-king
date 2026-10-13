import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Match, Schema } from "effect";

import { Recipients } from "./delivery.ts";
import {
  clean,
  clip,
  noLabels,
  oneLine,
  paragraphs,
  party,
  short,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";
import { BRAND } from "./ui/brand.ts";
import { Fault } from "./ui/fault.ts";
import { Preview } from "./ui/fold.ts";
import { Header } from "./ui/header.ts";
import { Receipt, headed } from "./ui/receipt.ts";

export interface CallArgs {
  readonly action?: string | undefined;
  readonly cc?: readonly string[] | undefined;
  readonly encrypt?: boolean | undefined;
  readonly message?: string | undefined;
  readonly replyAll?: boolean | undefined;
  readonly replyTo?: string | undefined;
  readonly successor?: string | undefined;
  readonly summary?: string | undefined;
  readonly to?: string | undefined;
}

const ACTION_COLOURS = new Map<string, ThemeColor>([
  ["ask", "warning"],
  ["reply", "success"],
  ["retire", "error"],
]);

const lines = (render: (width: number) => readonly string[]): Component => {
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

export const callLines = (
  _tool: string,
  call: CallArgs,
  theme: Paint,
  width: number,
  labels: Labels = noLabels
): readonly string[] => {
  const action = oneLine(call.action ?? "");
  const dot = theme.fg("dim", " · ");

  const head = [
    Header({
      colour: ACTION_COLOURS.get(action) ?? "accent",
      theme,
      variant: "call",
      verb: action,
    }),
    ...(call.to === undefined
      ? []
      : [
          `${theme.fg("muted", "→")} ${party(theme, call.to, labels(call.to))}`,
        ]),
    ...(call.successor === undefined
      ? []
      : [
          `${theme.fg("muted", "→")} ${party(theme, call.successor, labels(call.successor))}`,
        ]),
  ].join(" ");

  const flags = [
    ...((call.cc?.length ?? 0) > 0
      ? [
          `${theme.fg("muted", "cc")} ${(call.cc ?? []).map((name) => party(theme, name, labels(name))).join(", ")}`,
        ]
      : []),
    ...(call.replyTo === undefined
      ? []
      : [theme.fg("muted", `↩ ${short(call.replyTo)}`)]),
    ...(call.replyAll === false ? [theme.fg("muted", "sender only")] : []),
    ...(call.encrypt === true ? [theme.fg("success", "🔒 encrypted")] : []),
  ];

  const preview = [
    ...(call.summary === undefined
      ? []
      : [theme.fg("text", oneLine(call.summary))]),
    ...(call.message === undefined
      ? []
      : [theme.fg("dim", oneLine(call.message))]),
  ];

  const [text] = preview;

  return [
    flags.length === 0 ? head : `${head}${dot}${flags.join(dot)}`,
    ...(text === undefined
      ? []
      : [`  ${truncateToWidth(text, Math.max(1, width - 2))}`]),
  ];
};

interface CallInput {
  readonly call: CallArgs;
  readonly labels: Labels;
  readonly theme: Paint;
  readonly tool: string;
}

class CallShell implements Component {
  input: CallInput;
  readonly view: Component;

  constructor(input: CallInput) {
    this.input = input;
    this.view = lines((width) => {
      const { call, labels, theme, tool } = this.input;

      return callLines(tool, call, theme, width, labels);
    });
  }

  invalidate() {
    this.view.invalidate();
  }

  render(width: number) {
    return this.view.render(width);
  }
}

interface CallState {
  shell?: CallShell;
}

interface CallContext {
  readonly state: CallState;
}

export const callView = (
  tool: string,
  call: CallArgs,
  theme: Paint,
  labels: Labels = noLabels,
  context?: CallContext
): Component => {
  const input: CallInput = { call, labels, theme, tool };
  const shell = context?.state.shell ?? new CallShell(input);
  shell.input = input;
  shell.invalidate();

  if (context !== undefined) {
    context.state.shell = shell;
  }

  return shell;
};

export interface ResultInput {
  readonly action: string;
  readonly details: unknown;
  readonly expanded: boolean;
  readonly isError: boolean;
  readonly isPartial: boolean;
  readonly text: string;
}

const PREVIEW_LINES = 3;

const failed = (input: ResultInput) =>
  input.isError ||
  Schema.is(Schema.Struct({ error: Schema.Literal(true) }))(input.details);

const receiptParty = (text: string, theme: Paint, labels: Labels) =>
  text.replaceAll(
    /(?<=[Dd]elivered to |confirmed to |Reply from |status: )(?<recipient>[^\n]+?)(?= over Rat King| \(id| \(did:)|^(?<copy>[^:]+)(?=: (?:woken|quiet))/gmu,
    (_match, recipient: string | undefined, copy: string | undefined) => {
      const name = recipient ?? copy ?? "";

      return party(theme, name, labels(name));
    }
  );

const ReceiptDetails = Schema.Struct({
  id: Schema.String,
  recipients: Schema.optionalKey(Recipients),
  to: Schema.optionalKey(Schema.String),
});

type ReceiptDetailsValue = typeof ReceiptDetails.Type;

const compactReceipt = (
  input: ResultInput,
  theme: Paint,
  labels: Labels
): readonly string[] | undefined => {
  if (!Schema.is(ReceiptDetails)(input.details)) {
    return undefined;
  }

  const details: ReceiptDetailsValue = input.details;

  const recipients =
    details.recipients ??
    (details.to === undefined ? [] : [{ level: "wake", name: details.to }]);

  if (recipients.length === 0) {
    return undefined;
  }

  const prefix = Match.value(input.action).pipe(
    Match.when("ask", () => "asked "),
    Match.when("record", () => "record → "),
    Match.orElse(() => "")
  );

  const trimmed = /^summary trimmed to /mu.test(clean(input.text))
    ? theme.fg("dim", " · summary trimmed")
    : "";

  return recipients.map((recipient, index) => {
    const level = recipient.level === "wake" ? "woken" : "quiet";
    const fact = recipients.length === 1 ? short(details.id) : level;

    return `${recipients.length === 1 ? prefix : ""}${party(theme, recipient.name, labels(recipient.name))}${theme.fg("dim", ` · ${fact}`)}${index === 0 ? trimmed : ""}`;
  });
};

const askReply = (
  text: string,
  theme: Paint,
  width: number,
  labels: Labels
) => {
  const match =
    /\*\*Reply from (?<name>[^\n]+?)\*\* \(id (?<id>[^)]+)\):\n(?<body>[\s\S]*)/u.exec(
      text
    );

  if (match?.groups === undefined) {
    return [];
  }

  return [
    `${theme.fg("success", "↩")} ${party(theme, match.groups.name ?? "", labels(match.groups.name ?? ""))}${theme.fg("dim", ` · ${short(match.groups.id ?? "")}`)}`,
    ...paragraphs(
      (match.groups.body ?? "").replace(/\nsummary trimmed to [^\n]*$/u, ""),
      width - 2
    ),
  ];
};

export const resultLines = (
  input: ResultInput,
  theme: Paint,
  width: number,
  labels: Labels = noLabels
): readonly string[] => {
  if (input.isPartial) {
    return [
      theme.fg(
        "warning",
        input.action === "ask" ? "⋯ waiting for the reply" : "⋯ sending"
      ),
    ];
  }

  const [first = "", ...rest] = clean(input.text).trim().split("\n");

  const head = receiptParty(first.replaceAll("**", ""), theme, labels).replace(
    new RegExp(`^${BRAND} status: `, "u"),
    ""
  );

  if (failed(input)) {
    return Fault({
      diagnostics: rest.join("\n"),
      expanded: input.expanded,
      reason: head,
      theme,
      width,
    });
  }

  const compact = input.expanded
    ? undefined
    : compactReceipt(input, theme, labels);

  if (compact !== undefined) {
    return [
      ...Receipt({ lines: compact, theme, width }),
      ...(input.action === "ask"
        ? clip(
            theme,
            askReply(clean(input.text), theme, width, labels).flatMap((line) =>
              wrapTextWithAnsi(line, Math.max(1, width - 2)).map(
                (wrapped) => `  ${wrapped}`
              )
            ),
            PREVIEW_LINES,
            width
          )
        : []),
    ];
  }

  if (input.action === "ask") {
    const body = rest.flatMap((line) =>
      wrapTextWithAnsi(
        receiptParty(line.replaceAll("**", ""), theme, labels),
        Math.max(1, width - 2)
      ).map((wrapped) => `  ${wrapped}`)
    );

    return [
      ...headed(theme.fg("success", "↩"), theme.fg("accent", head), width),
      ...Preview({
        expanded: input.expanded,
        lines: body,
        room: PREVIEW_LINES,
        theme,
        width,
      }),
    ];
  }

  if (input.action === "status") {
    const [self = "", factsText = ""] = head.split(" · reader ");
    const facts = factsText === "" ? [] : `reader ${factsText}`.split(" · ");

    return input.expanded
      ? [
          ...headed(theme.fg("success", "✓"), theme.fg("text", self), width),
          ...facts.flatMap((fact) =>
            wrapTextWithAnsi(fact, Math.max(1, width - 2)).map(
              (line) => `  ${theme.fg("dim", line)}`
            )
          ),
        ]
      : [
          `${theme.fg("success", "✓")} ${theme.fg("text", self)}${theme.fg("dim", facts[0] === undefined ? "" : ` · ${facts[0]}`)}`,
        ];
  }

  const others = rest
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const plain = receiptParty(line.replaceAll("**", ""), theme, labels);

      const colour = /no reader|not live|offline/iu.test(plain)
        ? "warning"
        : "dim";

      return wrapTextWithAnsi(plain, Math.max(1, width - 2)).map(
        (wrapped) => `  ${theme.fg(colour, wrapped)}`
      );
    });

  const tail = others.flat();

  return [
    ...headed(theme.fg("success", "✓"), theme.fg("text", head), width),
    ...Preview({
      expanded: input.expanded,
      lines: tail,
      room: PREVIEW_LINES,
      theme,
      width,
    }),
  ];
};

export const resultView = (
  input: ResultInput,
  theme: Paint,
  labels: Labels = noLabels,
  context?: CallContext
): Component => {
  const shell = context?.state.shell;

  if (shell !== undefined) {
    shell.input = { ...shell.input, labels, theme };
    shell.invalidate();
  }

  return lines((width) => resultLines(input, theme, width, labels));
};
