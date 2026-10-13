// @effect-diagnostics asyncFunction:off -- Pi's extension API is the Promise boundary; Effect owns the work behind it.
import type {
  EventBus,
  ExtensionAPI,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { signedTurn } from "@rat-king/lexicon/turns";
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
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { Type } from "typebox";

import { decodeAgentGraphBody } from "./agentgraph.ts";
import { attend, formatReason } from "./attend.ts";
import {
  NotConfigured,
  resolveTurnOwner,
  settingsLayer,
  Settings,
  toolName,
} from "./config.ts";
import { DIGEST_REASON, deliveryReason, injects } from "./delivery.ts";
import { directoryLayer } from "./directory.ts";
import { paneLabel } from "./herdr.ts";
import type { SessionFacts } from "./identity.ts";
import { issuerLayer } from "./issuer.ts";
import { messageView } from "./message-view.ts";
import { digestView, recordView } from "./notice-view.ts";
import { LexiconRecord, renderInbound } from "./payload.ts";
import type { Inbound } from "./payload.ts";
import {
  applyDelivery,
  DIGEST_MESSAGE,
  inbox,
  MAIL_MESSAGE,
  shownIds,
  verdictToHold,
} from "./pending.ts";
import type { PendingMail } from "./pending.ts";
import { NotDelivered, RatKing, ratKingLayer } from "./ratking.ts";
import type { Deliver, SendOptions } from "./ratking.ts";
import { recordNotice } from "./record-visibility.ts";
import { secretStoreLayer } from "./secrets.ts";
import { callView, resultView } from "./tool-view.ts";
import {
  description,
  notConfiguredText,
  notDeliveredText,
  promptSnippet,
  readerFooter,
  runAction,
  ToolParams,
} from "./tool.ts";
import type { ToolText } from "./tool.ts";
import type { Labels } from "./tui.ts";
import { stopReason, turnReporter } from "./turn-record.ts";
import type { TurnReporter } from "./turn-record.ts";

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

  return `- ${sender} · id ${inbound.id} · ${gist.replaceAll("\n", " ")}`;
};

export const renderDigest = (tool: string, mails: readonly PendingMail[]) =>
  [
    `**🐀 cc digest** · ${mails.length} cc'd since the last digest, newest first`,
    formatReason(DIGEST_REASON),
    "",
    ...mails.map((mail) => mail.line ?? `- id ${mail.id}`),
    "",
    `These are copies; the sender used to: for whoever must act. To answer one: ${tool}({ action: "reply", replyTo: "<id>", summary: "...", message: "..." })`,
  ].join("\n");

export const digestDetails = (mails: readonly PendingMail[]) => ({
  ids: mails.map((held) => held.id),
  reason: DIGEST_REASON,
});

export { injects } from "./delivery.ts";

const sendFields = {
  cc: Schema.optionalKey(Schema.Array(Schema.String)),
  encrypt: Schema.optionalKey(Schema.Boolean),
  kind: Schema.optionalKey(Schema.Literals(["message", "ask", "data"])),
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
  interactive = true
) =>
  Effect.gen(function* sessionFacts() {
    const env = yield* Config.option(
      Config.String(interactive ? "RATKING_NAME" : "RATKING_PRINT_NAME")
    );

    const paneId = interactive
      ? yield* Config.option(Config.String("HERDR_PANE_ID"))
      : Option.none<string>();

    const pane = Option.isSome(paneId)
      ? yield* paneLabel(paneId.value)
      : Option.none<string>();

    const owner = yield* resolveTurnOwner();

    return {
      alive,
      env,
      label: () =>
        Option.orElse(
          Option.filter(
            Option.fromNullishOr(sessionName?.()),
            (name) => name.trim() !== ""
          ),
          () => pane
        ),
      owner,
      pane,
      pid: process.pid,
      reads: interactive || Option.isSome(env),
      session,
    } satisfies SessionFacts;
  }).pipe(Effect.provide(NodeServices.layer));

export const inboundDetails = (inbound: Inbound, settled: boolean) => ({
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

type Services = Layer.Success<typeof appLayer>;

type Runtime = ManagedRuntime.ManagedRuntime<Services, NotConfigured>;

export interface SessionStart {
  readonly turnCount?: number;
  readonly rememberTurn?: (n: number) => void;
  readonly interactive?: boolean;
  readonly session: string;
  readonly sessionName?: () => string | undefined;
  readonly status?: (text: string | undefined) => void;
  readonly warn: (message: string) => void;
}

export interface PiHost {
  readonly onAgentStart?: (handler: () => Promise<void>) => void;
  readonly onAgentEnd?: (
    handler: (messages: readonly unknown[]) => Promise<void>
  ) => void;
  readonly onApproval?: (handler: () => Promise<void>) => void;
  readonly events: EventBus;
  readonly onMessageShown?: (handler: (id: string) => void) => void;
  readonly registerMessageRenderer: ExtensionAPI["registerMessageRenderer"];
  readonly registerTool: ExtensionAPI["registerTool"];
  readonly sendMessage: ExtensionAPI["sendMessage"];
  readonly onSessionStart: (
    handler: (start: SessionStart) => Promise<void>
  ) => void;
  readonly onSessionEnd: (handler: () => Promise<void>) => void;
}

export const piHost = (pi: ExtensionAPI): PiHost => ({
  events: pi.events,
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
        rememberTurn: (n) => {
          pi.appendEntry("ratking.turn", { n });
        },
        session: ctx.sessionManager.getSessionId(),
        sessionName: () => pi.getSessionName(),
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
  registerMessageRenderer: (customType, renderer) => {
    pi.registerMessageRenderer(customType, renderer);
  },
  registerTool: (tool) => {
    pi.registerTool(tool);
  },
  sendMessage: (message, delivery) => {
    pi.sendMessage(message, delivery);
  },
});

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
    interactive?: boolean
  ) => Effect.Effect<SessionFacts, Config.ConfigError>;
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
    })
  );

const parameters = Type.Object({
  action: Type.Union(
    [
      "attention",
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
      "cancel",
      "retire",
    ].map((action) => Type.Literal(action)),
    {
      description:
        "send, ask (returns immediately; the reply arrives as a message), reply, handled (confirm a relayed original id), pending, list, status, retire (retire this Pi's own name, optionally naming a successor, and stop its reader). handover and cancel are refused on Rat King.",
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
  cwd: Type.Optional(
    Type.String({ description: "Not supported: Rat King addresses by name." })
  ),
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
  focus: Type.Optional(Type.Boolean({ description: "Unused." })),
  message: Type.Optional(
    Type.String({ description: "Message text for send, ask or reply." })
  ),
  messageId: Type.Optional(
    Type.String({ description: "Accepted for compatibility; unused." })
  ),
  note: Type.Optional(Type.String({ maxLength: 120 })),
  openProjectPaneIfMissing: Type.Optional(
    Type.Boolean({ description: "Not available on Rat King." })
  ),
  prefs: Type.Optional(
    Type.Unknown({
      description:
        "Replace private preferences. Jev now/later are decimals 0..1.",
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

    pi.registerMessageRenderer(
      DIGEST_MESSAGE,
      (message, renderOptions, theme) =>
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
        })
    );
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

    pi.onAgentStart?.(async () => {
      await reportTurn(turns?.working());
    });
    pi.onAgentEnd?.(async (messages) => {
      await reportTurn(turns?.done(stopReason(messages)));
    });
    pi.onApproval?.(async () => {
      await reportTurn(turns?.approval());
    });
    const acknowledgments = new Map<string, Effect.Effect<void>>();

    const mail = inbox({
      digest: (mails) => {
        pi.sendMessage(
          {
            content: renderDigest(tool, mails),
            customType: DIGEST_MESSAGE,
            details: {
              ...digestDetails(mails),
              messages: mails.map((held) => held.details),
            },
            display: true,
          },
          { deliverAs: "followUp", triggerTurn: true }
        );
      },
      show: (pending, deliverAs) => {
        pi.sendMessage(
          {
            content: pending.content,
            customType: MAIL_MESSAGE,
            details: pending.details,
            display: true,
          },
          { deliverAs, triggerTurn: deliverAs !== "nextTurn" }
        );
      },
    });

    const consume = (id: string) => {
      const ack = acknowledgments.get(id);

      if (Option.isSome(runtime) && ack !== undefined) {
        acknowledgments.delete(id);
        void runtime.value.runPromiseExit(ack);
      }
    };

    pi.onMessageShown?.((id) => {
      mail.shown(id);
      consume(id);
    });

    const digestTicks = Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Effect.sync(() => {
          mail.tick(now);
        })
      ),
      Effect.repeat(Schedule.spaced(DIGEST_TICK)),
      Effect.forkScoped,
      Effect.asVoid
    );

    const deliver: Deliver = (inbound, settled, ack) =>
      Effect.gen(function* deliverMail() {
        const now = yield* Clock.currentTimeMillis;

        if (ack !== undefined) {
          acknowledgments.set(inbound.id, ack);
        }

        if (
          !("record" in inbound) &&
          inbound.verified &&
          Option.isSome(inbound.label)
        ) {
          knownLabels.set(inbound.from, inbound.label.value);
        }

        if ("record" in inbound) {
          if (
            inbound.record.$type === "sh.mschf.agentgraph.turn" &&
            Option.isNone(
              signedTurn(inbound.record, inbound.from, inbound.verified)
            )
          ) {
            consume(inbound.id);

            return;
          }

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

          const body = JSON.stringify(inbound.record);

          if (!settled && Option.isSome(decodeAgentGraphBody(body))) {
            const message: Inbound = {
              ...inbound,
              body,
              cc: false,
              kind: "data",
              label: Option.none(),
              summary: Option.none(),
            };

            mail.take(
              {
                content: renderInbound(tool, message),
                details: inboundDetails(message, settled),
                id: message.id,
              },
              "steer"
            );
          } else {
            const notice = recordNotice({ ...inbound, body }, settled);

            if (notice === undefined) {
              consume(inbound.id);
            } else {
              pi.sendMessage(
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

          return;
        }

        if (inbound.sentBy !== undefined || settled) {
          pi.sendMessage(
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

        const notice =
          inbound.kind === "data" ? recordNotice(inbound, settled) : undefined;

        if (notice !== undefined) {
          pi.sendMessage(
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
          const verdict = attend(
            inbound,
            inbound.levers ?? {},
            now,
            undefined,
            Option.none()
          );

          yield* applyDelivery(verdictToHold(verdict), {
            inject: (hold) =>
              Effect.sync(() => {
                const pending = {
                  content: renderInbound(tool, inbound),
                  details: inboundDetails(inbound, settled),
                  digestMinutes:
                    Predicate.isTagged(verdict, "Later") &&
                    Predicate.isTagged(verdict.reason, "lever")
                      ? verdict.window / 60_000
                      : inbound.digestMinutes,
                  id: inbound.id,
                  line: digestLine(inbound),
                };

                if (
                  Predicate.isTagged(verdict, "Later") &&
                  Predicate.isTagged(verdict.reason, "lever")
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

    const run = async <A>(
      effect: Effect.Effect<A, never, Services>,
      fallback: (reason: string) => A,
      signal?: AbortSignal
    ) => {
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
          fallback(
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

    pi.registerTool({
      description: description(tool),
      execute: async (_id, params, signal) => {
        const result = await run(
          Effect.gen(function* execute() {
            const decoded =
              yield* Schema.decodeUnknownEffect(ToolParams)(params);

            const settings = yield* Settings;
            const status = yield* RatKing.use((ratking) => ratking.status);
            ownName = Option.getOrUndefined(
              status.self.pipe(Option.map((self) => self.name))
            );

            return yield* withTurnWait(
              turns,
              decoded,
              runAction(tool, settings.askTimeoutMs, decoded)
            );
          }).pipe(
            Effect.orElseSucceed((): ToolText => ({
              details: { error: true },
              isError: true,
              text: "Invalid Rat King tool parameters",
            })),
            Effect.map(toolResult)
          ),
          (reason) =>
            toolResult(notConfiguredText(new NotConfigured({ reason }))),
          signal
        );

        if (
          !("isError" in result) &&
          Schema.is(Schema.Struct({ retired: Schema.Literal(true) }))(
            result.details
          )
        ) {
          retired = true;
          await stop();
        }

        return result;
      },
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

      retired = true;

      const retire = async () => {
        await stop();

        pi.events.emit(RETIRE_RESULT_EVENT, {
          ...Option.getOrElse(request, () => ({})),
          status: "retired" as const,
        });
      };

      void retire();
    });

    pi.onSessionStart(async (start) => {
      retired = false;

      await stop();

      mail.clear();
      acknowledgments.clear();

      const collected = await Effect.runPromise(
        options.facts(start.session, start.sessionName, start.interactive)
      );

      knownLabels.clear();
      ownName = undefined;
      ownLabel = collected.label ?? (() => collected.pane);

      turns = turnReporter(collected, start.turnCount, start.rememberTurn);

      const facts: SessionFacts = {
        ...collected,
        onState: (reader) => {
          start.status?.(readerFooter(reader));

          if (Predicate.isTagged(reader, "Live")) {
            void reportTurn(turns?.idle());
          }
        },
      };

      const live: Runtime = ManagedRuntime.make(
        Layer.effectDiscard(
          digestTicks.pipe(
            Effect.andThen(
              RatKing.use((ratking) => ratking.run(facts, deliver))
            )
          )
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
