import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Recipients } from "@rat-king/ratking-client/delivery";
import { Schema } from "effect";

import {
  clean,
  noLabels,
  oneLine,
  party,
  short,
  terminalStyles,
} from "./tui.ts";
import type { Labels, Paint } from "./tui.ts";
import { Block } from "./ui/block.ts";
import { BRAND } from "./ui/brand.ts";

export interface CallArgs {
  readonly action?: string | undefined;
  readonly cc?: readonly string[] | undefined;
  readonly encrypt?: boolean | undefined;
  readonly id?: string | undefined;
  readonly message?: string | undefined;
  readonly op?: string | undefined;
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

const callVerb = (call: CallArgs, action: string): string =>
  action === "filter"
    ? oneLine([action, call.op ?? "", call.id ?? ""].join(" ").trim())
    : action;

export const callLines = (
  _tool: string,
  call: CallArgs,
  theme: Paint,
  width: number,
  labels: Labels = noLabels,
  queued = false,
  expanded = false
): readonly string[] => {
  const action = oneLine(call.action ?? "");
  const dot = theme.fg("dim", " · ");

  const targets = [call.to, call.successor].flatMap((name) =>
    name === undefined
      ? []
      : [`${theme.fg("muted", "→")} ${party(theme, name, labels(name))}`]
  );

  const flags = [
    ...((call.cc?.length ?? 0) > 0
      ? [theme.fg("muted", `+${call.cc?.length ?? 0} cc`)]
      : []),
    ...(call.replyTo === undefined
      ? []
      : [theme.fg("muted", `↩ ${short(call.replyTo)}`)]),
    ...(call.replyAll === false ? [theme.fg("muted", "sender only")] : []),
    ...(call.encrypt === true ? [theme.fg("success", "🔒 encrypted")] : []),
  ];

  const verb = callVerb(call, action);

  const head = [
    theme.fg(ACTION_COLOURS.get(action) ?? "accent", verb),
    ...targets,
  ].join(" ");

  const preview = call.summary ?? call.message;

  return Block({
    body:
      preview === undefined
        ? []
        : wrapTextWithAnsi(
            theme.fg(
              call.summary === undefined ? "dim" : "text",
              oneLine(preview)
            ),
            Math.max(1, width - 4)
          ).slice(0, expanded ? undefined : 2),
    glyph: queued ? theme.fg("dim", "⋯") : theme.fg("accent", BRAND),
    headline: flags.length === 0 ? head : `${head}${dot}${flags.join(dot)}`,
    theme,
    width,
  });
};

interface CallInput {
  readonly call: CallArgs;
  readonly expanded: boolean;
  readonly labels: Labels;
  readonly queued: boolean;
  readonly theme: Paint;
  readonly tool: string;
}

class CallShell implements Component {
  input: CallInput;
  recipient?: string | undefined;
  receipted = false;
  readonly view: Component;

  constructor(input: CallInput) {
    this.input = input;
    this.view = lines((width) => {
      const { call, expanded, labels, queued, theme, tool } = this.input;

      const rendered = callLines(
        tool,
        {
          ...call,
          replyAll: this.receipted ? undefined : call.replyAll,
          to: call.to ?? (call.action === "reply" ? this.recipient : undefined),
        },
        theme,
        width,
        labels,
        queued,
        expanded
      );

      if (queued) {
        return [
          ...rendered,
          ...Block({
            glyph: "",
            headline: theme.fg("dim", "queued"),
            theme,
            width,
          }),
        ];
      }

      return expanded && call.message !== undefined
        ? [
            ...rendered,
            ...Block({
              glyph: "",
              headline: theme.fg("text", clean(call.message)),
              theme,
              width,
            }),
          ]
        : rendered;
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
  hasResult?: boolean;
  shell?: CallShell;
}

interface CallContext {
  readonly executionStarted?: boolean;
  readonly expanded?: boolean;
  readonly state: CallState;
}

export const callView = (
  tool: string,
  call: CallArgs,
  theme: Paint,
  labels: Labels = noLabels,
  context?: CallContext
): Component => {
  const input: CallInput = {
    call,
    expanded: context?.expanded ?? false,
    labels,
    queued:
      context?.executionStarted === false && context.state.hasResult !== true,
    theme,
    tool,
  };

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

const failed = (input: ResultInput) =>
  input.isError ||
  Schema.is(Schema.Struct({ error: Schema.Literal(true) }))(input.details);

const ReceiptDetails = Schema.Struct({
  durationMs: Schema.optionalKey(Schema.Finite),
  id: Schema.String,
  recipients: Schema.optionalKey(Recipients),
  replyId: Schema.optionalKey(Schema.String),
  seq: Schema.optionalKey(Schema.Number),
  to: Schema.optionalKey(Schema.String),
});

type ReceiptDetailsValue = typeof ReceiptDetails.Type;

const replyParts = (text: string) =>
  /\*\*Reply from [^\n]+?\*\* \(id (?<id>[^)]+)\):\n(?<body>[\s\S]*)/u.exec(
    text
  )?.groups;

const trimNote = (text: string) => {
  const match = /summary trimmed to (?<length>\d+) characters/u.exec(text);

  return match?.groups === undefined
    ? []
    : [`summary trimmed ${match.groups.length ?? ""}`];
};

const TimingDetails = Schema.Struct({ durationMs: Schema.Finite });

const timing = (input: Pick<ResultInput, "details">): readonly string[] => {
  const { details } = input;

  return Schema.is(TimingDetails)(details)
    ? [
        details.durationMs < 1000
          ? `${Math.round(details.durationMs)} ms`
          : `${(details.durationMs / 1000).toFixed(1)} s`,
      ]
    : [];
};

const CancelledDetails = Schema.Struct({
  cancelled: Schema.Literal(true),
  sent: Schema.Union([Schema.Boolean, Schema.Literal("uncertain")]),
});

const cancelMark = (sent: boolean | "uncertain") => {
  if (sent === true) {
    return ["success", "↩"] as const;
  }

  return sent === false
    ? (["error", "✗"] as const)
    : (["warning", "!"] as const);
};

const cancelledLines = (
  input: ResultInput,
  details: typeof CancelledDetails.Type,
  theme: Paint,
  width: number
) => {
  const [colour, glyph] = cancelMark(details.sent);

  return Block({
    footer: [...timing(input), "cancelled"].join(" · "),
    glyph: theme.fg(colour, glyph),
    headline: theme.fg(colour, clean(input.text).trim()),
    theme,
    width,
  });
};

const ProgressDetails = Schema.Struct({
  elapsedMs: Schema.Finite,
  phase: Schema.String,
});

const receiptFooter = (details: ReceiptDetailsValue, text: string) =>
  [
    details.id,
    ...(details.seq === undefined ? [] : [`seq ${details.seq}`]),
    ...(details.replyId === undefined ? [] : [`reply ${details.replyId}`]),
    ...trimNote(text),
  ].join(" · ");

const receiptRows = (facts: readonly string[], theme: Paint, width: number) => {
  const rows: string[] = [];

  for (const fact of facts) {
    const last = rows.at(-1);

    const candidate =
      last === undefined ? fact : `${last}${theme.fg("dim", " · ")}${fact}`;

    if (
      last === undefined ||
      visibleWidth(candidate) > Math.max(1, width - 4)
    ) {
      rows.push(fact);
    } else {
      rows[rows.length - 1] = candidate;
    }
  }

  return rows;
};

const receiptLines = (
  input: ResultInput,
  details: ReceiptDetailsValue,
  theme: Paint,
  width: number,
  labels: Labels,
  call?: CallArgs
) => {
  const recipients =
    details.recipients ??
    (details.to === undefined ? [] : [{ level: "wake", name: details.to }]);

  const primary = call?.to ?? recipients[0]?.name;

  const parties = recipients.map(({ level, name }) => {
    const delivery = level === "wake" ? "woken" : "quiet";

    const outcome =
      call?.replyAll === false && name === primary ? "sender only" : delivery;

    const target =
      call !== undefined && name === primary
        ? ""
        : `${party(theme, name, labels(name))} · `;

    return `${target}${theme.fg("dim", outcome)}`;
  });

  const reply =
    input.action === "ask" ? replyParts(clean(input.text)) : undefined;

  const body =
    reply?.body?.replace(/\nsummary trimmed to [^\n]*$/u, "").split("\n") ?? [];

  const waiting = input.action === "ask" && reply === undefined;
  const mark = reply === undefined ? "✓" : "↩";

  const [headline = "", ...facts] = receiptRows(
    [
      ...parties,
      ...(waiting ? ["waiting for the reply"] : []),
      ...trimNote(input.text),
      ...timing(input),
    ],
    theme,
    width
  );

  return Block({
    body: [
      ...facts,
      ...(input.expanded
        ? [
            ...body,
            ...clean(input.text)
              .split("\n")
              .map((line) => theme.fg("dim", line)),
          ]
        : body.slice(0, 2)),
    ],
    footer: input.expanded ? receiptFooter(details, input.text) : undefined,
    glyph: theme.fg("success", mark),
    headline: headline === "" ? theme.fg("dim", "confirmed") : headline,
    theme,
    width,
  });
};

const pendingBody = (text: string) => {
  const sections = clean(text)
    .replaceAll("**", "")
    .split(/(?=^(?:Inbound unanswered|Outbound open) asks:)/mu);

  const populated = sections.filter((section) =>
    section.split("\n").some((line) => line.startsWith("- "))
  );

  return populated.length === 0
    ? ["No open asks"]
    : populated.flatMap((section) => section.trim().split("\n"));
};

const statusLines = (
  input: ResultInput,
  head: string,
  theme: Paint,
  width: number,
  labels: Labels
) => {
  const [self = "", ...facts] = head.split(" · ");
  const name = self.split(" (")[0] ?? "";
  const identity = self.slice(name.length).trim();
  const footer = [identity, ...facts];

  const body = clean(input.text)
    .replaceAll("**", "")
    .split("\n")
    .slice(1)
    .map((line) => {
      const [entry = "", did = "", ...flags] = line.split(" · ");

      if (!line.startsWith("- ") || !did.startsWith("did:")) {
        return line;
      }

      footer.push(`${did} · ${entry.slice(2)}`);

      return [entry, ...flags].join(" · ");
    });

  return Block({
    body: input.expanded ? [clean(input.text)] : body,
    footer: [...footer.filter((value) => value !== ""), ...timing(input)].join(
      " · "
    ),
    glyph: theme.fg("success", "✓"),
    headline: party(theme, name, labels(name)),
    theme,
    width,
  });
};

const progressLines = (input: ResultInput, theme: Paint, width: number) => {
  const progress = Schema.is(ProgressDetails)(input.details)
    ? input.details
    : undefined;

  const text = clean(input.text).trim();
  const phase = progress?.phase ?? (text === "" ? input.action : text);

  const elapsed =
    progress === undefined || progress.elapsedMs < 1000
      ? ""
      : theme.fg("dim", ` · ${Math.floor(progress.elapsedMs / 1000)}s`);

  return Block({
    glyph: theme.fg("warning", "⋯"),
    headline: `${clean(phase)}${elapsed}`,
    theme,
    width,
  });
};

export const resultLines = (
  input: ResultInput,
  theme: Paint,
  width: number,
  labels: Labels = noLabels,
  call?: CallArgs
): readonly string[] => {
  if (input.isPartial) {
    return progressLines(input, theme, width);
  }

  if (Schema.is(CancelledDetails)(input.details)) {
    return cancelledLines(input, input.details, theme, width);
  }

  if (!failed(input) && Schema.is(ReceiptDetails)(input.details)) {
    return receiptLines(input, input.details, theme, width, labels, call);
  }

  const error = failed(input);
  const pending = input.action === "pending" && !error;

  const content = pending
    ? pendingBody(input.text)
    : clean(input.text).trim().replaceAll("**", "").split("\n");

  const footer: string[] = [];

  const rows = pending
    ? content.map((line) => {
        if (!line.startsWith("- ")) {
          return line;
        }

        const [name = "", id = "", ...facts] = line.split(" · ");
        footer.push(`${id} · ${name.slice(2)}`);

        return [name, ...facts].join(" · ");
      })
    : content;

  const [first = "", ...rest] = rows;
  const head = first.replace(new RegExp(`^${BRAND} status: `, "u"), "");

  if (["status", "list", "list-cwd"].includes(input.action) && !error) {
    return statusLines(input, head, theme, width, labels);
  }

  return Block({
    body: [
      ...rest.map((line) => theme.fg(error ? "error" : "text", line)),
      ...(pending && input.expanded ? clean(input.text).split("\n") : []),
    ],
    footer: [...footer, ...timing(input)].join(" · ") || undefined,
    glyph: theme.fg(error ? "error" : "success", error ? "✗" : "✓"),
    headline: theme.fg(error ? "error" : "text", head),
    theme,
    width,
  });
};

export const resultView = (
  input: ResultInput,
  theme: Paint,
  labels: Labels = noLabels,
  context?: CallContext
): Component => {
  const shell = context?.state.shell;

  if (context !== undefined) {
    context.state.hasResult = true;
  }

  if (shell !== undefined) {
    shell.input = {
      ...shell.input,
      expanded: input.expanded,
      labels,
      queued: false,
      theme,
    };

    if (
      input.action === "reply" &&
      !input.isPartial &&
      !failed(input) &&
      Schema.is(ReceiptDetails)(input.details)
    ) {
      shell.recipient = input.details.to ?? input.details.recipients?.[0]?.name;
    }

    shell.receipted =
      !input.isPartial &&
      !failed(input) &&
      Schema.is(ReceiptDetails)(input.details);
    shell.invalidate();
  }

  return lines((width) =>
    resultLines(input, theme, width, labels, shell?.input.call)
  );
};
