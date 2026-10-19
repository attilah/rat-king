// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary; Effect owns the work behind it.
import type {
  EventBus,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { recordType } from "@rat-king/mailbox-client";
import { decodeAgentGraphBody } from "@rat-king/ratking-client/agentgraph";
import { attend, formatReason } from "@rat-king/ratking-client/attend";
import type { Verdict } from "@rat-king/ratking-client/attend";
import { countFilterHit, filterHits } from "@rat-king/ratking-client/attention";
import {
  loadSettings,
  NotConfigured,
  resolveTurnOwner,
  settingsLayer,
  Settings,
  toolName,
} from "@rat-king/ratking-client/config";
import { deliveryReason, injects } from "@rat-king/ratking-client/delivery";
import { directoryLayer } from "@rat-king/ratking-client/directory";
import type { SessionFacts } from "@rat-king/ratking-client/identity";
import { issuerLayer } from "@rat-king/ratking-client/issuer";
import { canonicalName } from "@rat-king/ratking-client/name";
import type { ReservedValue } from "@rat-king/ratking-client/name";
import {
  COPY_NOTE,
  LexiconRecord,
  renderInbound,
} from "@rat-king/ratking-client/payload";
import type { Inbound, InboundRecord } from "@rat-king/ratking-client/payload";
import {
  NotDelivered,
  Inbox,
  RatKing,
  ratKingLayer,
} from "@rat-king/ratking-client/ratking";
import type { Deliver, SendOptions } from "@rat-king/ratking-client/ratking";
import {
  CONTROL_RECORD_TYPES,
  recordNotice,
  recordRuleVerdict,
} from "@rat-king/ratking-client/record-visibility";
import { secretStoreLayer } from "@rat-king/ratking-client/secrets";
import {
  Cause,
  Clock,
  Config,
  Duration,
  Effect,
  Exit,
  Layer,
  Logger,
  ManagedRuntime,
  Match,
  Option,
  Path,
  Ref,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { Type } from "typebox";

import { ancestorsOf, parentOfProcess } from "./ancestry.ts";
import { paneLabel } from "./herdr.ts";
import { messageView } from "./message-view.ts";
import {
  chooseName,
  heldElsewhere,
  heldNotice,
  heldReason,
  NAME_ENTRY,
  parseNameEntries,
  parentEntry,
  shouldRecord,
  stateName,
} from "./name.ts";
import type { NamedFacts, NameEntryValue, NameSourceValue } from "./name.ts";
import { digestView, recordView } from "./notice-view.ts";
import {
  applyDelivery,
  DIGEST_MESSAGE,
  digestLabel,
  digestReason,
  inbox,
  MAIL_MESSAGE,
  shownIds,
  shownInHistory,
  verdictToHold,
  WAKE_MESSAGE,
  WAKE_REASON,
} from "./pending.ts";
import type { DigestVariant, HistoryEntry, PendingMail } from "./pending.ts";
import {
  againOutcome,
  noNameOutcome,
  RETIRE_COMMAND,
  RETIRE_COMMAND_DESCRIPTION,
  retireCommand,
} from "./retire.ts";
import type { RetireOutcome, Retirement } from "./retire.ts";
import { forkLabel, parentSessionId } from "./session-parent.ts";
import { callView, resultView } from "./tool-view.ts";
import {
  cancelledText,
  description,
  idleDispatch,
  notConfiguredText,
  notDeliveredText,
  promptSnippet,
  readerFooter,
  runAction,
  ToolParams,
  toolProgress,
  withToolLiveness,
} from "./tool.ts";
import type { ToolProgressParams, ToolText } from "./tool.ts";
import type { Labels } from "./tui.ts";
import { stopReason, turnReporter } from "./turn-record.ts";
import type { TurnReporter } from "./turn-record.ts";
import {
  flushWake,
  receiveWake,
  shownTurnKeys,
  turnInbox,
  TURN_SHOWN_ENTRY,
  WAKE_RECORD,
} from "./wake-record.ts";

export const SEND_EVENT = "ratking/send";

export const SEND_RESULT_EVENT = "ratking/send:result";

export const MESSAGE_EVENT = "ratking/message";

export const RECORD_EVENT = "ratking/record";

export const STATUS_EVENT = "ratking/status";

export const STATUS_RESULT_EVENT = "ratking/status:result";

export interface ReaderStatus {
  readonly name: string | null;
  readonly did: string | null;
  readonly reader: "live" | "acquiring" | "retired" | "off" | "send-only";
  readonly leaseGeneration?: number;
  readonly leaseUntil?: string;
}

export const RETIRE_EVENT = "ratking/retire";

export const RETIRE_RESULT_EVENT = "ratking/retire:result";

const RELEASE_WAIT_MS = 2000;

const DIGEST_LINE_MAX = 160;

const DIGEST_TICK = Duration.minutes(1);

export const digestLine = (inbound: Inbound) => {
  const gist = Option.getOrElse(inbound.summary, () =>
    inbound.body.length > DIGEST_LINE_MAX
      ? `${inbound.body.slice(0, DIGEST_LINE_MAX)}…`
      : inbound.body
  );

  const sender = Option.match(inbound.label, {
    onNone: () => inbound.from,
    onSome: (label) => `${label} (${inbound.from})`,
  });

  return `- ${sender} · id ${inbound.id}${inbound.delegatedTo === undefined ? "" : ` · handled by ${inbound.delegatedTo}`} · ${gist.replaceAll("\n", " ")}`;
};

const WakeEntry = Schema.Struct({
  body: Schema.String,
  from: Schema.String,
  replyTo: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
});

const wakeLine = (mail: PendingMail) =>
  Option.match(Schema.decodeUnknownOption(WakeEntry)(mail.details), {
    onNone: () => `- id ${mail.id}`,
    onSome: (value) =>
      `- ${value.from} · ${(value.summary ?? value.body).replaceAll(/\s+/gu, " ").slice(0, DIGEST_LINE_MAX)} · id ${mail.id}${value.replyTo === undefined ? "" : ` · reply to ${value.replyTo}`}`,
  });

export const renderDigest = (
  tool: string,
  mails: readonly PendingMail[],
  variant: DigestVariant = "cc"
) =>
  variant === "wake"
    ? [
        `**🐀 ${mails.every((mail) => mail.wake === true) ? "wake" : "while you were away"}** · ${mails.length}`,
        ...mails.map(wakeLine),
        "",
        ...mails.flatMap((mail) => (mail.wake === true ? [mail.content] : [])),
        ...(mails.every((mail) => mail.wake === true)
          ? []
          : [
              COPY_NOTE,
              `To reply: ${tool}({ action: "reply", replyTo: "<id>", summary: "...", message: "..." })`,
            ]),
      ].join("\n")
    : [
        `**🐀 ${digestLabel(digestReason(mails))}** · ${mails.length}${digestLabel(digestReason(mails)) === "cc digest" ? " cc'd" : ""} since the last digest, newest first`,
        formatReason(digestReason(mails)),
        "",
        ...mails.map((mail) => mail.line ?? `- id ${mail.id}`),
        "",
        `${digestLabel(digestReason(mails)) === "cc digest" ? "These are copies; the sender used to: for whoever must act. " : ""}To answer one: ${tool}({ action: "reply", replyTo: "<id>", summary: "...", message: "..." })`,
      ].join("\n");

export const digestDetails = (
  mails: readonly PendingMail[],
  variant: DigestVariant = "cc"
) => {
  const details = {
    ids: mails.map((held) => held.id),
    reason: digestReason(mails),
  };

  return variant === "wake"
    ? {
        ...details,
        reason: mails.every((mail) => mail.wake === true)
          ? WAKE_REASON
          : details.reason,
        variant,
      }
    : details;
};

export { injects } from "@rat-king/ratking-client/delivery";

const sendFields = {
  cc: Schema.optionalKey(Schema.Array(Schema.String)),
  critical: Schema.optionalKey(Schema.Boolean),
  encrypt: Schema.optionalKey(Schema.Boolean),
  kind: Schema.optionalKey(Schema.Literals(["message", "ask", "data"])),
  quiet: Schema.optionalKey(Schema.Boolean),
  replyAll: Schema.optionalKey(Schema.Boolean),
  replyTo: Schema.optionalKey(Schema.String),
  replyToDid: Schema.optionalKey(Schema.String),
  requestId: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  thread: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
};

const SendRequest = Schema.Union([
  Schema.Struct({
    ...sendFields,
    body: Schema.String,
    record: Schema.optionalKey(Schema.Never),
  }),
  Schema.Struct({
    ...sendFields,
    body: Schema.optionalKey(Schema.Never),
    record: LexiconRecord,
  }),
]);

const platform = Layer.merge(NodeServices.layer, FetchHttpClient.layer);

const fileLog = Logger.layer([
  Effect.gen(function* fileLogger() {
    const settings = yield* Settings;
    const path = yield* Path.Path;

    return yield* Logger.toFile(
      Logger.formatJson,
      path.join(settings.state, "pi-ratking.log")
    ).pipe(Effect.orElseSucceed(() => Logger.make(() => null)));
  }),
]);

export const appLayer = ratKingLayer.pipe(
  Layer.provideMerge(fileLog),
  Layer.provideMerge(issuerLayer),
  Layer.provideMerge(secretStoreLayer),
  Layer.provideMerge(directoryLayer),
  Layer.provideMerge(settingsLayer),
  Layer.provideMerge(platform)
);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return Schema.is(Schema.Struct({ code: Schema.Literal("EPERM") }))(error);
  }
};

export const collectFacts = (
  session: string,
  sessionName?: () => string | undefined,
  interactive = true,
  entries: readonly NameEntryValue[] = [],
  parentSession?: string
) =>
  Effect.gen(function* sessionFacts() {
    const path = yield* Path.Path;

    const given = yield* Config.option(
      Config.String(interactive ? "RATKING_NAME" : "RATKING_PRINT_NAME")
    );

    const label = yield* Config.option(Config.String("RATKING_FORK_LABEL"));

    const succeeds = yield* Config.option(Config.String("RATKING_SUCCEEDS"));

    const fork = parentSession !== undefined && parentSession !== session;

    const successor = fork && Option.contains(succeeds, parentSession);

    const configured = fork
      ? yield* loadSettings().pipe(Effect.option)
      : Option.none();

    const reserved: ReservedValue = configured.pipe(
      Option.map((settings) => settings.reserved),
      Option.getOrElse(() => ({}))
    );

    const parent = Option.fromNullishOr(
      parentEntry(entries, parentSession)
    ).pipe(Option.map((entry) => canonicalName(reserved, entry.name)));

    const choice = chooseName({
      entries: interactive ? entries : [],
      env: fork
        ? given.pipe(Option.map((name) => canonicalName(reserved, name)))
        : given,
      fork,
      label: forkLabel(label, sessionName?.(), session),
      parent,
      parentSession,
      session,
      succeeds: Option.getOrUndefined(succeeds),
    });

    const env = choice.name;

    const paneId = interactive
      ? yield* Config.option(Config.String("HERDR_PANE_ID"))
      : Option.none<string>();

    const pane = Option.isSome(paneId)
      ? yield* paneLabel(paneId.value)
      : Option.none<string>();

    const owner = yield* resolveTurnOwner();

    const nameless =
      Option.isNone(env) &&
      !entries.some(
        (entry) => entry.session === session && entry.source === "default"
      );

    return {
      alive,
      ancestors: () => ancestorsOf(process.pid, parentOfProcess),
      disabled: Option.contains(given, "off"),
      env,
      fork: choice.fork,
      label: () =>
        Option.orElse(
          Option.filter(
            Option.fromNullishOr(sessionName?.()),
            (name) => name.trim() !== ""
          ),
          () => pane
        ),
      nameless,
      owner,
      pane,
      parent: choice.parent,
      pid: process.pid,
      reads: interactive || Option.isSome(env),
      session,
      source: choice.source,
      successor: successor && choice.source === "env",
      via: () =>
        `${Option.fromNullishOr(sessionName?.()).pipe(
          Option.filter((name) => name.trim() !== ""),
          Option.getOrElse(() => path.basename(process.cwd()))
        )} (${session.slice(0, 8)})`,
    } satisfies NamedFacts;
  }).pipe(Effect.provide(NodeServices.layer));

const delegationDetails = (inbound: Inbound) => {
  const details: Pick<Inbound, "delegatedFor" | "delegatedTo" | "originalId"> =
    {};

  if (inbound.delegatedFor !== undefined) {
    Object.assign(details, {
      delegatedFor: inbound.delegatedFor,
      originalId: inbound.originalId,
    });
  }

  if (inbound.delegatedTo !== undefined) {
    Object.assign(details, { delegatedTo: inbound.delegatedTo });
  }

  return details;
};

export const inboundDetails = (inbound: Inbound, settled: boolean) => ({
  ...delegationDetails(inbound),
  body: inbound.body,
  cc: inbound.cc,
  ccNames: inbound.ccNames,
  did: inbound.did,
  from: inbound.from,
  id: inbound.id,
  kind: inbound.kind,
  label: Option.getOrUndefined(inbound.label),
  reason: deliveryReason(inbound),
  relay: inbound.relay,
  replyTo: Option.getOrUndefined(inbound.replyTo),
  sentBy: inbound.sentBy,
  settled,
  summary: Option.getOrUndefined(inbound.summary),
  thread: inbound.thread,
  to: inbound.to,
  verified: inbound.verified,
});

const toolResult = (result: ToolText) => {
  const content = [{ text: result.text, type: "text" as const }];

  return result.isError
    ? { content, details: result.details, isError: true as const }
    : { content, details: result.details };
};

export const executeToolWithLiveness = async (
  params: ToolProgressParams,
  action: Effect.Effect<ToolText>,
  update: (progress: ToolText) => void
): Promise<ToolText> => {
  update(toolProgress(params));

  return await Effect.runPromise(withToolLiveness(params, action, update));
};

type Services = Layer.Success<typeof appLayer>;

type Runtime = ManagedRuntime.ManagedRuntime<Services, NotConfigured>;

export interface SessionStart {
  readonly isIdle?: () => boolean;
  readonly turnCount?: number;
  readonly rememberTurn?: (n: number) => void;
  readonly interactive?: boolean;
  readonly names?: readonly NameEntryValue[];
  readonly parentSession?: string | undefined;
  readonly rememberName?: (entry: NameEntryValue) => void;
  readonly shownTurns?: readonly string[];
  readonly rememberShownTurn?: (key: string) => void;
  readonly session: string;
  readonly sessionName?: () => string | undefined;
  readonly status?: (text: string | undefined) => void;
  readonly warn: (message: string) => void;
}

export interface PiHost {
  readonly noteSettledRecord?: (id: string, type: string) => void;
  readonly onBeforeAgentStart?: (handler: () => void) => void;
  readonly onAgentStart?: (handler: () => Promise<void>) => void;
  readonly onAgentEnd?: (
    handler: (messages: readonly unknown[]) => Promise<void>
  ) => void;
  readonly onApproval?: (handler: () => Promise<void>) => void;
  readonly events: EventBus;
  readonly onMessageShown?: (handler: (id: string) => void) => void;
  readonly onTurnEnd?: (handler: () => void) => void;
  readonly shownInSession?: () => ReadonlySet<string>;
  readonly registerMessageRenderer: ExtensionAPI["registerMessageRenderer"];
  readonly registerTool: ExtensionAPI["registerTool"];
  readonly sendMessage: ExtensionAPI["sendMessage"];
  readonly onSessionStart: (
    handler: (start: SessionStart) => Promise<void>
  ) => void;
  readonly onSessionEnd: (handler: () => Promise<void>) => void;
  readonly registerCommand?: (
    name: string,
    command: {
      readonly description: string;
      readonly handler: (
        args: string,
        print: (line: string) => void
      ) => Promise<void>;
    }
  ) => void;
}

interface MailDispatch {
  readonly mail: ReturnType<typeof inbox>;
  readonly send: PiHost["sendMessage"];
}

const noEntries = (): readonly HistoryEntry[] => [];

export const piHost = (pi: ExtensionAPI): PiHost => {
  let history = noEntries;

  return {
    events: pi.events,
    noteSettledRecord: (id, type) => {
      pi.appendEntry("ratking.record.settled", { id, type });
    },
    onAgentEnd: (handler) => {
      pi.on("agent_end", async (event) => {
        await handler(event.messages);
      });
    },
    onAgentStart: (handler) => {
      pi.on("agent_start", handler);
    },
    onApproval: (handler) => {
      pi.on("ui_prompt_start", async (event) => {
        if (event.kind === "confirm") {
          await handler();
        }
      });
    },
    onBeforeAgentStart: (handler) => {
      pi.on("before_agent_start", handler);
    },
    onMessageShown: (handler) => {
      pi.on("message_end", (event) => {
        for (const id of shownIds(event.message)) {
          handler(id);
        }
      });
    },
    onSessionEnd: (handler) => {
      pi.on("session_shutdown", handler);
    },
    onSessionStart: (handler) => {
      pi.on("session_start", async (_event, ctx) => {
        history = () => ctx.sessionManager.getEntries();

        const Counter = Schema.Struct({ n: Schema.Int });

        let turnCount = 0;

        for (const entry of ctx.sessionManager.getEntries()) {
          if (entry.type === "custom" && entry.customType === "ratking.turn") {
            const data = Schema.decodeUnknownOption(Counter)(entry.data);

            if (Option.isSome(data)) {
              turnCount = Math.max(turnCount, data.value.n);
            }
          }
        }

        await handler({
          interactive: ctx.hasUI,
          isIdle: () => ctx.isIdle(),
          names: parseNameEntries(ctx.sessionManager.getEntries()),
          parentSession: await Effect.runPromise(
            parentSessionId(ctx.sessionManager.getHeader()?.parentSession).pipe(
              Effect.provide(NodeServices.layer),
              Effect.map(Option.getOrUndefined)
            )
          ),
          rememberName: (entry) => {
            pi.appendEntry(NAME_ENTRY, entry);
          },
          rememberShownTurn: (key) => {
            pi.appendEntry(TURN_SHOWN_ENTRY, { key });
          },
          rememberTurn: (n) => {
            pi.appendEntry("ratking.turn", { n });
          },
          session: ctx.sessionManager.getSessionId(),
          sessionName: () => pi.getSessionName(),
          shownTurns: shownTurnKeys(ctx.sessionManager.getEntries()),
          status: (text) => {
            ctx.ui.setStatus("ratking", text);
          },
          turnCount,
          warn: (message) => {
            ctx.ui.notify(message, "warning");
          },
        });
      });
    },
    onTurnEnd: (handler) => {
      pi.on("turn_end", () => {
        handler();
      });
    },
    registerCommand: (name, command) => {
      pi.registerCommand(name, {
        description: command.description,
        handler: async (args, ctx) => {
          await command.handler(args, (line) => {
            ctx.ui.notify(line, "info");
          });
        },
      });
    },
    registerMessageRenderer: (customType, renderer) => {
      pi.registerMessageRenderer(customType, renderer);
    },
    registerTool: (tool) => {
      pi.registerTool(tool);
    },
    sendMessage: (message, delivery) => {
      pi.sendMessage(message, delivery);
    },
    shownInSession: () => shownInHistory(history()),
  };
};

type TurnAction = Pick<typeof ToolParams.Type, "action" | "wait">;

export const withTurnWait = <A, E, R>(
  turns: TurnReporter | undefined,
  params: TurnAction,
  action: Effect.Effect<A, E, R>
) =>
  params.action === "ask" && params.wait === true && turns !== undefined
    ? turns.waitForReply(action)
    : action;

export interface ExtensionOptions {
  readonly layer: Layer.Layer<Services, NotConfigured>;
  readonly facts: (
    session: string,
    sessionName?: () => string | undefined,
    interactive?: boolean,
    entries?: readonly NameEntryValue[],
    parentSession?: string
  ) => Effect.Effect<NamedFacts, Config.ConfigError>;
  readonly tool: Effect.Effect<string>;
}

const notRunning = (cause: Cause.Cause<NotConfigured>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => "Rat King is not running in this Pi",
    onSome: (error) => error.reason,
  });

const forwardSend = (request: typeof SendRequest.Type) =>
  Effect.gen(function* forward() {
    const ratking = yield* RatKing;

    const body = request.record ?? request.body;

    const options: SendOptions & { readonly replyAll: boolean } = {
      cc: request.cc ?? [],
      ccOnPurpose: true,
      kind: request.kind ?? "message",
      replyAll: request.replyAll ?? true,
    };

    if (request.critical !== undefined) {
      Object.assign(options, { critical: request.critical });
    }

    if (request.quiet === true) {
      Object.assign(options, { quiet: true });
    }

    if (request.encrypt !== undefined) {
      Object.assign(options, { encrypt: request.encrypt });
    }

    if (request.thread !== undefined) {
      Object.assign(options, { thread: request.thread });
    }

    if (request.summary !== undefined) {
      Object.assign(options, { summary: request.summary });
    }

    if (request.replyToDid !== undefined) {
      if (request.replyTo === undefined) {
        return yield* new NotDelivered({
          code: "NotAttempted",
          reason: "replyToDid requires replyTo",
        });
      }

      Object.assign(options, {
        replyTo: { messageId: request.replyTo, senderDid: request.replyToDid },
      });
    }

    const delivered =
      request.replyTo === undefined || request.replyToDid !== undefined
        ? yield* ratking.send(request.to ?? "", body, options)
        : yield* ratking.reply(request.replyTo, body, options);

    const result = {
      id: delivered.id,
      requestId: request.requestId,
      seq: delivered.seq,
      status: "delivered",
      to: delivered.to,
    } as const;

    if (delivered.presence !== undefined) {
      Object.assign(result, { presence: delivered.presence });
    }

    return result;
  }).pipe(
    Effect.catchTags({
      AskFailed: (error) =>
        Effect.succeed({
          code: error.code,
          reason: error.reason,
          requestId: request.requestId,
          status: "not-delivered",
        } as const),
      NotDelivered: (error) =>
        Effect.succeed({
          code: error.code,
          reason: notDeliveredText(error),
          requestId: request.requestId,
          status: "not-delivered",
        } as const),
      QuietAsk: (error) =>
        Effect.succeed({
          code: error.code,
          reason: notDeliveredText(error),
          requestId: request.requestId,
          status: "not-delivered",
        } as const),
    })
  );

const parameters = Type.Object({
  action: Type.Union(
    [
      "attention",
      "filter",
      "list",
      "list-cwd",
      "send",
      "record",
      "ask",
      "handover",
      "reply",
      "pending",
      "handled",
      "status",
      "claim",
      "cancel",
      "retire",
    ].map((action) => Type.Literal(action)),
    {
      description:
        "send, ask (returns immediately; the reply arrives as a message), reply, handled (confirm a relayed original id), pending, list, status, claim (retry a blocked lease once), retire (retire this Pi's own name, optionally naming a successor, and stop its reader). handover and cancel are refused on Rat King.",
    }
  ),
  attachments: Type.Optional(
    Type.Array(
      Type.Object({
        content: Type.String(),
        language: Type.Optional(Type.String()),
        name: Type.String(),
        type: Type.Union([
          Type.Literal("file"),
          Type.Literal("snippet"),
          Type.Literal("context"),
        ]),
      })
    )
  ),
  cc: Type.Optional(
    Type.Array(
      Type.String({
        description:
          "Additional recipient names for send and ask. A cc gets a quiet copy and does not wake.",
      })
    )
  ),
  ccOnPurpose: Type.Optional(
    Type.Boolean({
      description:
        "Send even though the message or summary addresses a cc'd name. A cc gets a quiet copy and does not wake.",
    })
  ),
  critical: Type.Optional(Type.Boolean()),
  cwd: Type.Optional(
    Type.String({ description: "Not supported: Rat King addresses by name." })
  ),
  delegate: Type.Optional(Type.String()),
  dueBy: Type.Optional(
    Type.Number({
      description:
        "Optional ask deadline as Unix milliseconds. One quiet nudge; the ask stays open.",
    })
  ),
  encrypt: Type.Optional(
    Type.Boolean({
      description:
        "End-to-end encrypt this send, ask or reply. Use it for secrets, credentials, customer data or private transcripts. Default: signed plaintext, readable by observers.",
    })
  ),
  exempt: Type.Optional(Type.Array(Type.String(), { maxItems: 16 })),
  focus: Type.Optional(Type.Boolean({ description: "Unused." })),
  id: Type.Optional(Type.String()),
  message: Type.Optional(
    Type.String({ description: "Message text for send, ask or reply." })
  ),
  messageId: Type.Optional(
    Type.String({ description: "Accepted for compatibility; unused." })
  ),
  note: Type.Optional(Type.String({ maxLength: 120 })),
  op: Type.Optional(
    Type.Union(["add", "remove", "list"].map((op) => Type.Literal(op)))
  ),
  openProjectPaneIfMissing: Type.Optional(
    Type.Boolean({ description: "Not available on Rat King." })
  ),
  prefs: Type.Optional(
    Type.Unknown({
      description:
        "Replace private preferences. Jev now/later are decimals 0..1.",
    })
  ),
  quiet: Type.Optional(
    Type.Boolean({
      description:
        "Deliver without waking: the recipient sees it next turn or in their digest. Not for asks.",
    })
  ),
  record: Type.Optional(
    Type.Unknown({ description: "Record content, validated before sending." })
  ),
  replyAll: Type.Optional(
    Type.Boolean({
      description:
        "Reply to all thread participants by default; false answers only the sender.",
    })
  ),
  replyTo: Type.Optional(
    Type.String({
      description: "Message id to answer, from the inbound message.",
    })
  ),
  retryOf: Type.Optional(
    Type.String({ description: "Accepted for compatibility; unused." })
  ),
  rule: Type.Optional(Type.Unknown()),
  status: Type.Optional(
    Type.Union([
      Type.Literal("available"),
      Type.Literal("busy"),
      Type.Literal("dnd"),
    ])
  ),
  successor: Type.Optional(
    Type.String({
      description:
        "For retire: the Rat King name that replaces this one. Senders to the retired name are told to use it.",
    })
  ),
  summary: Type.Optional(
    Type.String({
      description:
        "One-line concise summary of the message (at most 280 characters; longer is trimmed and the full text leads the message), shown first on phones and in compact views. Include it on every send, ask or reply; lead with the point or the ask.",
    })
  ),
  supersedes: Type.Optional(
    Type.String({ description: "Accepted for compatibility; unused." })
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "Bound for explicit wait: true, in seconds; default 600.",
      maximum: 600,
      minimum: 1,
    })
  ),
  to: Type.Optional(Type.String({ description: "Target Rat King name." })),
  type: Type.Optional(
    Type.String({ description: "Agent-graph NSID for action record." })
  ),
  until: Type.Optional(
    Type.String({ description: "Attention expiry as an ISO datetime." })
  ),
  wait: Type.Optional(
    Type.Boolean({
      description:
        "Only for scripts: explicitly block for a reply. Use the default async ask for agents.",
    })
  ),
});

const idle = () => true;

const ignoreFilterHit = (_verdict: Verdict | undefined): Effect.Effect<void> =>
  Effect.void;

export const ratkingExtension = (options: ExtensionOptions) =>
  async function piRatking(pi: PiHost) {
    const tool = await Effect.runPromise(options.tool);

    const knownLabels = new Map<string, string>();
    let ownName: string | undefined;
    let ownLabel: () => Option.Option<string> = Option.none;

    const labels: Labels = (name) =>
      name === ownName
        ? Option.getOrUndefined(ownLabel())
        : knownLabels.get(name);

    pi.registerMessageRenderer(
      "ratking_message",
      (message, renderOptions, theme) =>
        messageView({
          details: message.details,
          expanded: renderOptions.expanded,
          labels,
          theme,
          tool,
        })
    );

    const renderDigestMessage: Parameters<
      PiHost["registerMessageRenderer"]
    >[1] = (message, renderOptions, theme) =>
      digestView({
        content: Schema.is(Schema.String)(message.content)
          ? message.content
          : message.content
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n"),
        details: message.details,
        expanded: renderOptions.expanded,
        labels,
        theme,
        tool,
      });

    pi.registerMessageRenderer(DIGEST_MESSAGE, renderDigestMessage);
    pi.registerMessageRenderer(WAKE_MESSAGE, renderDigestMessage);
    pi.registerMessageRenderer(
      "ratking_record_notice",
      (message, renderOptions, theme) =>
        recordView({
          content: Schema.is(Schema.String)(message.content)
            ? message.content
            : message.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n"),
          details: message.details,
          expanded: renderOptions.expanded,
          labels,
          theme,
        })
    );

    let runtime = Option.none<Runtime>();
    let turns: TurnReporter | undefined;

    const reportTurn = async (
      effect: Effect.Effect<void, never, RatKing | Settings> | undefined
    ) => {
      if (effect !== undefined && Option.isSome(runtime)) {
        await runtime.value.runPromiseExit(effect);
      }
    };

    let busy = false;

    pi.onApproval?.(async () => {
      await reportTurn(turns?.approval());
    });
    const acknowledgments = new Map<string, Effect.Effect<void>>();
    const controlRecords = new Map<string, string>();
    let isIdle = idle;
    let flushing = false;
    const sweeps: (() => void)[] = [];

    const consume = (id: string) => {
      const type = controlRecords.get(id);

      if (type !== undefined) {
        controlRecords.delete(id);
        pi.noteSettledRecord?.(id, type);
      }

      const ack = acknowledgments.get(id);

      if (Option.isSome(runtime) && ack !== undefined) {
        acknowledgments.delete(id);
        void runtime.value.runPromiseExit(ack);
      }
    };

    const dispatch: MailDispatch = {
      mail: inbox({
        digest: (mails, variant, delivery) => {
          dispatch.send(
            {
              content: renderDigest(tool, mails, variant),
              customType: DIGEST_MESSAGE,
              details: {
                ...digestDetails(mails, variant),
                messages: mails.map((held) => held.details),
              },
              display: true,
            },
            {
              deliverAs:
                delivery?.deliverAs ??
                (variant === "wake" ? "nextTurn" : "followUp"),
              triggerTurn: delivery?.triggerTurn ?? variant !== "wake",
            }
          );
        },
        show: (pending, deliverAs, triggerTurn) => {
          dispatch.send(
            {
              content: pending.content,
              customType: MAIL_MESSAGE,
              details: pending.details,
              display: true,
            },
            { deliverAs, triggerTurn: triggerTurn ?? deliverAs !== "nextTurn" }
          );
        },
      }),
      send: (message, delivery) => {
        if (delivery?.triggerTurn === true && !flushing) {
          flushing = true;

          try {
            dispatch.mail.flushNext({
              deliverAs: "followUp",
              triggerTurn: !isIdle(),
            });
          } finally {
            flushing = false;
          }
        }

        pi.sendMessage(message, delivery);

        for (const run of sweeps) {
          run();
        }
      },
    };

    const { mail } = dispatch;

    const turnMail = turnInbox(
      {
        consume,
        take: (pending, hold) => {
          if (hold === "steer") {
            mail.take(pending, isIdle() ? "followUp" : "steer");
          } else {
            mail.take(pending, hold);
          }
        },
      },
      () => ownName
    );

    const wakes = inbox({
      digest: (mails) => {
        flushWake(
          { events: pi.events, sendMessage: dispatch.send },
          {
            content: renderDigest(tool, mails, "wake"),
            customType: WAKE_MESSAGE,
            details: {
              ...digestDetails(mails, "wake"),
              messages: mails.map((held) => held.details),
            },
          },
          mails.map((held) => held.id).join(":")
        );
      },
      show: (pending, deliverAs) => {
        dispatch.send(
          {
            content: renderDigest(tool, [pending], "wake"),
            customType: WAKE_MESSAGE,
            details: {
              ...digestDetails([pending], "wake"),
              messages: [pending.details],
            },
            display: true,
          },
          { deliverAs, triggerTurn: deliverAs !== "nextTurn" }
        );
      },
    });

    const markShown = (id: string) => {
      mail.shown(id);
      wakes.shown(id);
      turnMail.shown(id);
      consume(id);
    };

    const inSession = () => pi.shownInSession?.() ?? new Set<string>();

    const sweep = () => {
      for (const id of inSession()) {
        markShown(id);
      }
    };

    sweeps.push(sweep);

    pi.onTurnEnd?.(() => {
      sweep();
      mail.flushNext({ deliverAs: "followUp", triggerTurn: false });
    });

    pi.onAgentStart?.(async () => {
      sweep();
      busy = true;
      flushing = true;

      try {
        mail.flushNext({ deliverAs: "steer", triggerTurn: true });
      } finally {
        flushing = false;
      }

      await reportTurn(turns?.working());
    });

    pi.onAgentEnd?.(async (messages) => {
      sweep();
      busy = false;
      wakes.flushNext();
      await reportTurn(turns?.done(stopReason(messages)));
    });

    pi.onBeforeAgentStart?.(() => {
      sweep();
      busy = true;
      mail.flushNext();
    });

    pi.onMessageShown?.((id) => {
      if (pi.shownInSession === undefined || inSession().has(id)) {
        markShown(id);
      }
    });

    const digestTicks = Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Effect.sync(() => {
          mail.tick(now);
          wakes.tick(now);
        })
      ),
      Effect.repeat(Schedule.spaced(DIGEST_TICK)),
      Effect.forkScoped,
      Effect.asVoid
    );

    const rememberControl = (inbound: Parameters<Deliver>[0]) => {
      const type =
        "record" in inbound ? inbound.record.$type : recordType(inbound.body);

      if (CONTROL_RECORD_TYPES.includes(type)) {
        controlRecords.set(inbound.id, type);
      }
    };

    let recordHit = ignoreFilterHit;

    const deliverRecord = Effect.fn("RatKing.deliverRecord")(
      function* deliverRecord(
        inbound: InboundRecord,
        settled: boolean,
        now: number
      ) {
        pi.events.emit(RECORD_EVENT, {
          did: inbound.did,
          from: inbound.from,
          id: inbound.id,
          record: inbound.record,
          ...Option.match(inbound.replyTo, {
            onNone: () => ({}),
            onSome: (replyTo) => ({ replyTo }),
          }),
          verified: inbound.verified,
        });

        const filtered = settled ? undefined : recordRuleVerdict(inbound, now);
        const quiet = filtered?._tag === "Next" || filtered?._tag === "Later";

        yield* recordHit(filtered);

        if (inbound.record.$type === WAKE_RECORD) {
          receiveWake(
            {
              consume,
              take: quiet ? mail.take : wakes.take,
              withdraw: wakes.withdraw,
            },
            inbound,
            settled,
            now,
            filtered
          );

          if (!busy && !quiet && filtered?._tag !== "Never") {
            wakes.flushNext();
          }

          return;
        }

        if (filtered?._tag === "Never") {
          consume(inbound.id);

          return;
        }

        if (inbound.record.$type === "sh.mschf.agentgraph.turn") {
          turnMail.receive(inbound, settled, filtered);

          return;
        }

        const body = JSON.stringify(inbound.record);

        if (
          !settled &&
          (Option.isSome(decodeAgentGraphBody(body)) ||
            (quiet &&
              recordNotice({ ...inbound, body }, settled) !== undefined))
        ) {
          const { levers: _levers, ...recordInbound } = inbound;

          const message: Inbound = {
            ...recordInbound,
            body,
            cc: false,
            kind: "data",
            label: Option.none(),
            summary: Option.none(),
          };

          mail.take(
            {
              coalesce: quiet,
              content: renderInbound(tool, message),
              details: inboundDetails(message, settled),
              id: message.id,
            },
            quiet ? "nextTurn" : "steer"
          );

          return;
        }

        const notice = recordNotice({ ...inbound, body }, settled);

        if (notice === undefined) {
          consume(inbound.id);
        } else {
          dispatch.send(
            {
              content: notice,
              customType: "ratking_record_notice",
              details: { from: inbound.from, id: inbound.id },
              display: true,
            },
            { deliverAs: "followUp", triggerTurn: false }
          );
        }
      }
    );

    const deliver: Deliver = (inbound, settled, ack) =>
      Effect.gen(function* deliverMail() {
        const now = yield* Clock.currentTimeMillis;
        rememberControl(inbound);

        if (ack !== undefined) {
          acknowledgments.set(inbound.id, ack);
        }

        if (inSession().has(inbound.id)) {
          consume(inbound.id);

          return;
        }

        if (
          !("record" in inbound) &&
          inbound.verified &&
          Option.isSome(inbound.label)
        ) {
          knownLabels.set(inbound.from, inbound.label.value);
        }

        if ("record" in inbound) {
          yield* deliverRecord(inbound, settled, now);

          return;
        }

        if (inbound.sentBy !== undefined || settled) {
          dispatch.send(
            {
              content: renderInbound(tool, inbound),
              customType: "ratking_message",
              details: inboundDetails(inbound, settled),
              display: true,
            },
            { triggerTurn: false }
          );

          return;
        }

        pi.events.emit(MESSAGE_EVENT, inboundDetails(inbound, settled));

        if (inbound.verified) {
          turnMail.heard(inbound.from);
        }

        const verdict = attend(
          {
            ...inbound,
            type:
              inbound.kind === "data" ? recordType(inbound.body) : "message",
          },
          inbound.levers ?? {},
          now,
          undefined,
          Option.none()
        );

        yield* recordHit(verdict);

        if (
          Predicate.isTagged(verdict, "Never") &&
          Predicate.isTagged(verdict.reason, "lever") &&
          verdict.reason.rule !== undefined
        ) {
          consume(inbound.id);

          return;
        }

        const notice =
          inbound.kind === "data" ? recordNotice(inbound, settled) : undefined;

        if (notice !== undefined) {
          dispatch.send(
            {
              content: notice,
              customType: "ratking_record_notice",
              details: inboundDetails(inbound, settled),
              display: true,
            },
            { deliverAs: "followUp", triggerTurn: false }
          );
        }

        if (injects(inbound, settled)) {
          yield* applyDelivery(verdictToHold(verdict), {
            inject: (hold) =>
              Effect.sync(() => {
                const pending = {
                  coalesce:
                    pi.onBeforeAgentStart !== undefined &&
                    hold === "nextTurn" &&
                    ((Predicate.isTagged(verdict.reason, "lever") &&
                      verdict.reason.rule !== undefined) ||
                      inbound.cc ||
                      inbound.copy === true ||
                      inbound.quiet === true) &&
                    inbound.kind !== "ask",
                  content: renderInbound(tool, inbound),
                  details: inboundDetails(inbound, settled),
                  digestMinutes:
                    Predicate.isTagged(verdict, "Later") &&
                    (Predicate.isTagged(verdict.reason, "lever") ||
                      Predicate.isTagged(verdict.reason, "delegated"))
                      ? verdict.window / 60_000
                      : inbound.digestMinutes,
                  id: inbound.id,
                  line: digestLine(inbound),
                  reason: verdict.reason,
                };

                if (
                  Predicate.isTagged(verdict, "Later") &&
                  (Predicate.isTagged(verdict.reason, "lever") ||
                    Predicate.isTagged(verdict.reason, "delegated"))
                ) {
                  Object.assign(pending, { notBefore: now + verdict.window });
                }

                mail.take(pending, hold);
              }),
            settle: () =>
              Effect.logInfo("Rat King arrival settled without injection").pipe(
                Effect.annotateLogs({
                  from: inbound.from,
                  id: inbound.id,
                  reason: verdict.reason,
                }),
                Effect.andThen(
                  Effect.sync(() => {
                    consume(inbound.id);
                  })
                )
              ),
          });
        } else if (notice === undefined) {
          consume(inbound.id);
        }
      });

    let retired = false;
    let retirement: Retirement | undefined;
    let degraded: string | undefined;

    const run = async <A>(
      effect: Effect.Effect<A, never, Services>,
      fallback: (reason: string) => A,
      signal?: AbortSignal,
      cancelled?: () => A
    ) => {
      if (degraded !== undefined) {
        return fallback(degraded);
      }

      if (Option.isNone(runtime)) {
        return fallback(
          retired
            ? "Rat King reader retired; a successor session holds this name"
            : "Rat King has not started"
        );
      }

      const exit = await runtime.value.runPromiseExit(
        effect,
        signal === undefined ? undefined : { signal }
      );

      return Exit.match(exit, {
        onFailure: (cause) =>
          Cause.hasInterruptsOnly(cause) && cancelled !== undefined
            ? cancelled()
            : fallback(
                Cause.hasInterruptsOnly(cause) ? "Cancelled" : notRunning(cause)
              ),
        onSuccess: (value) => value,
      });
    };

    const stop = async () => {
      const previous = runtime;

      runtime = Option.none();

      if (Option.isSome(previous)) {
        await Effect.runPromise(
          Effect.promise(async () => {
            await previous.value.dispose();
          }).pipe(
            Effect.timeoutOption(Duration.millis(RELEASE_WAIT_MS)),
            Effect.asVoid
          )
        );
      }
    };

    const markRetired = async () => {
      retired = true;
      await stop();
    };

    pi.registerCommand?.(RETIRE_COMMAND, {
      description: RETIRE_COMMAND_DESCRIPTION,
      handler: async (args, print) => {
        const outcome =
          retirement === undefined
            ? await run<RetireOutcome>(retireCommand(args), noNameOutcome)
            : againOutcome(args, retirement);

        if (outcome.retired !== undefined && retirement === undefined) {
          retirement = outcome.retired;
          await markRetired();
        }

        print(outcome.line);
      },
    });

    pi.registerTool({
      description: description(tool),
      execute: async (_id, params, signal, onUpdate) => {
        const update = (progress: ToolText) => onUpdate?.(toolResult(progress));
        const phase = idleDispatch();

        const result = await executeToolWithLiveness(
          params,
          Effect.promise(async () => {
            const outcome = await run(
              Effect.gen(function* execute() {
                const decoded =
                  yield* Schema.decodeUnknownEffect(ToolParams)(params);

                const settings = yield* Settings;
                const context = yield* Effect.context<Services>();

                const status = yield* RatKing.use((ratking) => ratking.status);

                ownName = Option.getOrUndefined(
                  status.self.pipe(Option.map((self) => self.name))
                );

                return yield* withTurnWait(
                  turns,
                  decoded,
                  runAction(
                    tool,
                    settings.askTimeoutMs,
                    decoded,
                    phase,
                    filterHits.pipe(Effect.provideContext(context))
                  )
                );
              }).pipe(
                Effect.orElseSucceed((): ToolText => ({
                  details: { error: true },
                  isError: true,
                  text: "Invalid Rat King tool parameters",
                }))
              ),
              (reason) => notConfiguredText(new NotConfigured({ reason })),
              signal,
              () => cancelledText(params, Ref.getUnsafe(phase))
            );

            if (
              !outcome.isError &&
              Schema.is(Schema.Struct({ retired: Schema.Literal(true) }))(
                outcome.details
              )
            ) {
              await markRetired();
            }

            return outcome;
          }),
          update
        );

        return toolResult(result);
      },
      executionMode: "parallel",
      label: "🐀",
      name: tool,
      parameters,
      promptSnippet: promptSnippet(tool),
      renderCall: (args, theme, context) =>
        callView(tool, args, theme, labels, context),
      renderResult: (result, { expanded, isPartial }, theme, context) =>
        resultView(
          {
            action: context.args.action,
            details: result.details,
            expanded,
            isError: context.isError,
            isPartial,
            text: result.content
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n"),
          },
          theme,
          labels,
          context
        ),
    });

    const forward = async (request: typeof SendRequest.Type) => {
      const outcome = await run(forwardSend(request), (reason) => ({
        code: "NotConfigured" as const,
        reason,
        requestId: request.requestId,
        status: "not-delivered" as const,
      }));

      pi.events.emit(SEND_RESULT_EVENT, outcome);
    };

    pi.events.on(SEND_EVENT, (data) => {
      const request = Schema.decodeUnknownOption(SendRequest)(data);

      if (Option.isSome(request)) {
        void forward(request.value);

        return;
      }

      const loose = Schema.decodeUnknownOption(
        Schema.Struct({ requestId: Schema.String })
      )(data);

      if (Option.isSome(loose)) {
        pi.events.emit(SEND_RESULT_EVENT, {
          code: "NotAttempted" as const,
          reason:
            "InvalidRequest: ratking/send needs requestId and exactly one of body or record ($type string), with optional to, replyTo, encrypt and kind message, ask or data",
          requestId: loose.value.requestId,
          status: "not-delivered" as const,
        });
      }
    });

    pi.events.on(STATUS_EVENT, (data) => {
      const request = Schema.decodeUnknownOption(
        Schema.Struct({ requestId: Schema.String })
      )(data);

      if (Option.isNone(request)) {
        return;
      }

      const status = async () => {
        const current = await run<ReaderStatus>(
          RatKing.use((ratking) => ratking.status).pipe(
            Effect.map((value) => ({
              did: value.self.pipe(
                Option.map((own) => own.did),
                Option.getOrNull
              ),
              name: value.self.pipe(
                Option.map((own) => own.name),
                Option.getOrNull
              ),
              ...Match.value(value.reader).pipe(
                Match.tag("Live", (reader) => ({
                  leaseGeneration: reader.generation,
                  leaseUntil: reader.expiresAt,
                  reader: "live" as const,
                })),
                Match.tag("Acquiring", () => ({
                  reader: "acquiring" as const,
                })),
                Match.tag("SendOnly", () => ({ reader: "send-only" as const })),
                Match.tag("Starting", "Minting", "Retrying", "Refused", () => ({
                  reader: "off" as const,
                })),
                Match.exhaustive
              ),
            }))
          ),
          () => ({
            did: null,
            name: null,
            reader: retired ? ("retired" as const) : ("off" as const),
          })
        );

        pi.events.emit(STATUS_RESULT_EVENT, {
          requestId: request.value.requestId,
          ...current,
        });
      };

      void status();
    });

    pi.events.on(RETIRE_EVENT, (data) => {
      const request = Schema.decodeUnknownOption(
        Schema.Struct({ requestId: Schema.optionalKey(Schema.String) })
      )(data ?? {});

      const retire = async () => {
        await markRetired();

        pi.events.emit(RETIRE_RESULT_EVENT, {
          ...Option.getOrElse(request, () => ({})),
          status: "retired" as const,
        });
      };

      void retire();
    });

    pi.onSessionStart(async (start) => {
      retired = false;
      retirement = undefined;
      isIdle = start.isIdle ?? idle;

      await stop();

      mail.clear();
      wakes.clear();
      acknowledgments.clear();
      controlRecords.clear();
      turnMail.restore(start.shownTurns ?? [], start.rememberShownTurn);

      degraded = undefined;

      const names = start.names ?? [];

      const collected = await Effect.runPromise(
        options.facts(
          start.session,
          start.sessionName,
          start.interactive,
          names,
          start.parentSession
        )
      );

      const source: NameSourceValue =
        collected.source ?? (Option.isSome(collected.env) ? "env" : "default");

      let recorded = names.at(-1);

      knownLabels.clear();
      ownName = Option.getOrUndefined(collected.env);
      ownLabel = collected.label ?? (() => collected.pane);

      turns = turnReporter(collected, start.turnCount, start.rememberTurn);

      const remember = (name: string) => {
        if (collected.disabled === true) {
          return;
        }

        const entry: NameEntryValue = { name, session: start.session, source };

        if (collected.parent !== undefined) {
          Object.assign(entry, { parent: collected.parent });
        }

        if (start.rememberName !== undefined && shouldRecord(recorded, entry)) {
          recorded = entry;
          start.rememberName(entry);
        }
      };

      const probeHeld = async (name: string) => {
        if (Option.isNone(runtime)) {
          return;
        }

        const exit = await runtime.value.runPromiseExit(
          Inbox.use((current) => current.holder)
        );

        if (
          Exit.isSuccess(exit) &&
          heldElsewhere(exit.value, start.session) &&
          degraded === undefined
        ) {
          degraded = heldReason(name);
          start.status?.(heldNotice(name));
          start.warn(heldNotice(name));
        }
      };

      const facts: SessionFacts = {
        ...collected,
        onState: (reader) => {
          const named = stateName(reader);

          if (
            Option.isSome(named) &&
            !(
              collected.nameless === true &&
              (Predicate.isTagged(reader, "SendOnly") ||
                Predicate.isTagged(reader, "Refused"))
            )
          ) {
            ownName = named.value;
            remember(named.value);
          }

          if (Predicate.isTagged(reader, "Live")) {
            degraded = undefined;
          }

          if (
            Predicate.isTagged(reader, "SendOnly") &&
            reader.reason === heldReason(reader.name)
          ) {
            start.status?.(heldNotice(reader.name));

            if (degraded !== heldReason(reader.name)) {
              start.warn(heldNotice(reader.name));
            }

            degraded = heldReason(reader.name);
          } else if (degraded === undefined) {
            start.status?.(readerFooter(reader));
          }

          if (
            Predicate.isTagged(reader, "Acquiring") &&
            source === "restored"
          ) {
            void probeHeld(reader.name);
          }

          if (Predicate.isTagged(reader, "Live")) {
            void reportTurn(turns?.idle());
          }
        },
      };

      const live: Runtime = ManagedRuntime.make(
        Layer.effectDiscard(
          Effect.gen(function* startReader() {
            const context = yield* Effect.context<Services>();
            recordHit = (verdict) =>
              countFilterHit(verdict).pipe(
                Effect.provideContext(context),
                Effect.matchEffect({
                  onFailure: (failure) =>
                    Effect.logWarning("Filter hit count unavailable", failure),
                  onSuccess: () => Effect.void,
                })
              );
            yield* digestTicks;
            yield* RatKing.use((ratking) => ratking.run(facts, deliver));
          })
        ).pipe(Layer.provideMerge(options.layer))
      );

      runtime = Option.some(live);

      const exit = await live.runPromiseExit(Effect.void);

      if (Exit.isFailure(exit)) {
        start.warn(`Rat King is off: ${notRunning(exit.cause)}`);
      }
    });

    pi.onSessionEnd(stop);
  };

const production = ratkingExtension({
  facts: collectFacts,
  layer: appLayer,
  tool: toolName.pipe(Effect.provide(NodeServices.layer)),
});

const extension: ExtensionFactory = async (pi) => {
  await production(piHost(pi));
};

export default extension;
