import {
  invalidRecordText,
  recordSummary,
  validateRecord,
} from "@rat-king/ratking-client/agentgraph";
import { askAge } from "@rat-king/ratking-client/asks";
import { decimalPreferences } from "@rat-king/ratking-client/attention";
import { ccRefusalPrompt } from "@rat-king/ratking-client/cc-lint";
import { sendingOptions } from "@rat-king/ratking-client/compose";
import type { NotConfigured } from "@rat-king/ratking-client/config";
import { recipientLines } from "@rat-king/ratking-client/delivery";
import type { RecipientLevelValue } from "@rat-king/ratking-client/delivery";
import { LexiconRecord } from "@rat-king/ratking-client/payload";
import { RatKing, ReaderState } from "@rat-king/ratking-client/ratking";
import type {
  AskOptions,
  Delivered,
  NotDelivered,
  Status,
} from "@rat-king/ratking-client/ratking";
import { withSummaryLead } from "@rat-king/ratking-client/summary";
import { Clock, DateTime, Effect, Match, Option, Schema } from "effect";
import type { Duration } from "effect";

export const Action = Schema.Literals([
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
]);

export const Attachment = Schema.Struct({
  content: Schema.String,
  language: Schema.optionalKey(Schema.String),
  name: Schema.String,
  type: Schema.Literals(["file", "snippet", "context"]),
});

export const ToolParams = Schema.Struct({
  action: Action,
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
  cc: Schema.optionalKey(Schema.Array(Schema.String)),
  ccOnPurpose: Schema.optionalKey(Schema.Boolean),
  cwd: Schema.optionalKey(Schema.String),
  dueBy: Schema.optionalKey(Schema.Finite),
  encrypt: Schema.optionalKey(Schema.Boolean),
  focus: Schema.optionalKey(Schema.Boolean),
  message: Schema.optionalKey(Schema.String),
  messageId: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  openProjectPaneIfMissing: Schema.optionalKey(Schema.Boolean),
  prefs: Schema.optionalKey(Schema.Json),
  record: Schema.optionalKey(Schema.Json),
  replyAll: Schema.optionalKey(Schema.Boolean),
  replyTo: Schema.optionalKey(Schema.String),
  retryOf: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Literals(["available", "busy", "dnd"])),
  successor: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  supersedes: Schema.optionalKey(Schema.String),
  timeoutSeconds: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ maximum: 600, minimum: 1 }))
  ),
  to: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String),
  wait: Schema.optionalKey(Schema.Boolean),
});

export type ToolParamsValue = typeof ToolParams.Type;

export const toolCall = (tool: string, params: ToolParamsValue) =>
  `${tool}(${JSON.stringify(
    Schema.encodeSync(ToolParams)(params, { onExcessProperty: "error" })
  )})`;

export type DetailValue =
  | string
  | number
  | boolean
  | readonly RecipientLevelValue[];

export interface ToolText {
  readonly text: string;
  readonly isError: boolean;
  readonly details: Readonly<Record<string, DetailValue>>;
}

const ok = (text: string, details: ToolText["details"] = {}): ToolText => ({
  details,
  isError: false,
  text,
});

const loud = (text: string, details: ToolText["details"] = {}): ToolText => ({
  details: { error: true, ...details },
  isError: true,
  text,
});

const withPresence = (text: string, delivered: Delivered) =>
  delivered.presence === undefined ? text : `${text}\n${delivered.presence}`;

const presenceDetails = (delivered: Delivered) =>
  delivered.presence === undefined ? {} : { presence: delivered.presence };

const recipientsOf = (delivered: Delivered) =>
  delivered.recipients ?? [{ level: "wake" as const, name: delivered.to }];

export const receiptText = (lead: string, delivered: Delivered) =>
  recipientsOf(delivered).length > 1
    ? [
        `Delivered over Rat King (id ${delivered.id}, seq ${delivered.seq}).`,
        ...recipientLines(recipientsOf(delivered)),
      ].join("\n")
    : `${lead} ${delivered.to} over Rat King (id ${delivered.id}, seq ${delivered.seq}).`;

export const notDeliveredText = (error: NotDelivered) =>
  Match.value(error.code).pipe(
    Match.whenOr("ReaderCannotRender", "AskAimedAtCc", () => error.reason),
    Match.when("Partial", () => `PARTIAL DELIVERY: ${error.reason}`),
    Match.orElse(
      () =>
        `NOT DELIVERED: ${error.code}. ${error.reason}. No fallback; nothing reached the recipient.`
    )
  );

export const description = (tool: string) =>
  `Rat King messaging: signed mail between named agents on any machine. Every message goes to a name's durable mailbox; whoever holds that name's lease reads it. A failed send is an error, never a silent fallback.

Messages are signed plaintext by default, readable by operators and observers such as Joel's phone feed. Pass encrypt: true on send, ask or reply to end-to-end encrypt anything containing secrets, credentials, customer data or private transcripts.

Address agents by Rat King name (for example switchboard, or project/row).

send and ask accept cc: ["name", ...]. to: is for whoever must act, and wakes them. cc: is for whoever should know: a quiet copy that does not wake. A send whose message or summary addresses a cc'd name (@name, or an "ask for name" line) is refused; pass ccOnPurpose: true if the cc is deliberate. reply defaults to reply-all; replyAll: false answers only the sender. To answer a message that arrived before this Pi's reader last started, add to: the asker's name. handled with replyTo confirms a relayed original to its desk without replying to the sender.

Give every send, ask and reply a summary: one line, at most 280 characters; longer is trimmed and the full text leads the message. Lead with the point or the ask. Phones and compact views show it first; the message holds the detail.

Usage:
  ${tool}({ action: "send", to: "name", summary: "...", message: "..." }) → Deliver a message
  ${tool}({ action: "send", to: "name", message: "...", encrypt: true }) → Deliver an encrypted message
  ${tool}({ action: "record", to: "name", type: "sh.mschf.agentgraph.checkin", record: { ... } }) → Validate then send typed data
  ${tool}({ action: "ask", to: "name", summary: "...", message: "..." }) → Ask and get the reply as a message; your turn is not blocked
  ${tool}({ action: "reply", replyTo: "<id>", summary: "...", message: "..." }) → Answer a message by its id
  ${tool}({ action: "pending" })                                     → Unanswered inbound asks and open outbound asks
  ${tool}({ action: "list" })                                        → The Rat King directory
  ${tool}({ action: "status" })                                      → This Pi's name and reader
  ${tool}({ action: "attention" })                                   → Public status and private preferences; status/until/note sets status, prefs replaces preferences (Jev now/later use decimals 0..1)
  ${tool}({ action: "retire", successor: "name" })                   → Retire this Pi's own name; mail to it is refused naming the successor, and this reader stops`;

export const promptSnippet = (tool: string) =>
  `Message other agents over Rat King with ${tool}: send, async ask, reply by id, list the directory.`;

const readerText = (reader: ReaderState) =>
  ReaderState.$match(reader, {
    Acquiring: () => "acquiring lease",
    Live: ({ expiresAt, generation }) =>
      `live, lease generation ${generation} until ${expiresAt}`,
    Minting: ({ name }) => `minting ${name}`,
    Refused: ({ reason }) => `REFUSED: ${reason}`,
    Retrying: ({ attempt, reason }) =>
      `retrying (attempt ${attempt}): ${reason}`,
    SendOnly: ({ reason }) => `send-only: ${reason}`,
    Starting: () => "starting",
  });

export const readerFooter = (reader: ReaderState) =>
  ReaderState.$is("Live")(reader) || ReaderState.$is("SendOnly")(reader)
    ? undefined
    : `Rat King reader ${readerText(reader)}`;

export const statusText = (_tool: string, status: Status) => {
  const self = Option.match(status.self, {
    onNone: () => "no identity yet",
    onSome: ({ did, name }) => `${name} (${did})`,
  });

  const reader = readerText(status.reader);

  const quarantine =
    status.quarantine.count === 0
      ? ""
      : ` · quarantined ${status.quarantine.count}${Option.match(
          status.quarantine.latest,
          {
            onNone: () => "",
            onSome: (latest) =>
              ` (latest seq ${latest.seq} from ${latest.senderDid}: ${latest.reason})`,
          }
        )}`;

  return `🐀 status: ${self} · reader ${reader}${quarantine} · mailbox ${status.endpoint}`;
};

const withAttachments = (params: ToolParamsValue) =>
  Option.map(Option.fromNullishOr(params.message), (message) =>
    params.attachments === undefined || params.attachments.length === 0
      ? message
      : [
          message,
          ...params.attachments.map(
            (item) =>
              `--- ${item.type}: ${item.name}${item.language === undefined ? "" : ` (${item.language})`}\n${item.content}`
          ),
        ].join("\n\n")
  );

const needMessage = (params: ToolParamsValue, lead?: string) =>
  Option.match(
    Option.fromNullishOr(
      withSummaryLead(lead, Option.getOrUndefined(withAttachments(params)))
    ),
    {
      onNone: () => Effect.fail(loud("Missing 'message' parameter")),
      onSome: Effect.succeed,
    }
  );

const needTo = (params: ToolParamsValue) =>
  params.to === undefined || params.to.trim() === ""
    ? Effect.fail(
        loud(
          params.cwd === undefined
            ? "Missing 'to' parameter"
            : "Rat King addresses agents by name; cwd targeting is not supported. Pass 'to'."
        )
      )
    : Effect.succeed(params.to.trim());

export const runAction = Effect.fn("RatKing.runAction")(function* runAction(
  tool: string,
  askTimeout: Duration.Input,
  params: ToolParamsValue
) {
  const ratking = yield* RatKing;

  const { clamp, options: encryption } = sendingOptions(params);

  const lead = params.action === "record" ? undefined : clamp?.full;

  if (params.openProjectPaneIfMissing === true) {
    return loud(
      "openProjectPaneIfMissing is not available on Rat King; launch the agent first, then send."
    );
  }

  return yield* Match.value(params.action).pipe(
    Match.when("status", () =>
      ratking.status.pipe(
        Effect.map((status) =>
          ReaderState.$is("Refused")(status.reader)
            ? loud(statusText(tool, status))
            : ok(statusText(tool, status))
        )
      )
    ),
    Match.whenOr("list", "list-cwd", () =>
      Effect.gen(function* list() {
        const status = yield* ratking.status;
        const entries = yield* ratking.list;
        const own = status.self.pipe(Option.map(({ name }) => name));

        return ok(
          [
            statusText(tool, status),
            "",
            "**Directory:**",
            ...(entries.length === 0
              ? ["- empty"]
              : entries.map(
                  (entry) =>
                    `- ${entry.name}${entry.aliases.length === 0 ? "" : ` (alias ${entry.aliases.join(", ")})`} · ${entry.did}${entry.reserved ? " · reserved" : ""}${own.pipe(Option.contains(entry.name)) ? " · you" : ""}`
                )),
          ].join("\n")
        );
      })
    ),
    Match.when("attention", () =>
      ratking.attention(params).pipe(
        Effect.map((value) =>
          ok(
            JSON.stringify(
              { prefs: decimalPreferences(value.prefs), status: value.status },
              null,
              2
            )
          )
        ),
        Effect.catch((error) =>
          Effect.succeed(loud(`Attention refused: ${String(error)}`))
        )
      )
    ),
    Match.when("cancel", () =>
      Effect.succeed(
        loud(
          "cancel is not possible on Rat King: an accepted message is already in the recipient's mailbox. Send a correction instead."
        )
      )
    ),
    Match.when("handover", () =>
      Effect.succeed(
        loud(
          "handover is not supported by Rat King yet. Summarise the work yourself and use send."
        )
      )
    ),
    Match.when("pending", () =>
      ratking.pending.pipe(
        Effect.flatMap((asks) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((now) =>
              asks.length === 0
                ? ok("No unresolved inbound or outbound asks.")
                : ok(
                    [
                      "**Inbound unanswered asks:**",
                      ...asks
                        .filter((ask) => ask.outbound === undefined)
                        .map(
                          (ask) => `- ${ask.from} · ${ask.id} · ${ask.preview}`
                        ),
                      "**Outbound open asks:**",
                      ...asks.flatMap((ask) =>
                        ask.outbound === undefined
                          ? []
                          : [
                              `- to ${ask.outbound.to} · ${ask.id} · ${ask.outbound.summary} · ${askAge(ask.outbound, now)} · dueBy ${ask.outbound.dueBy === undefined ? "none" : DateTime.formatIso(DateTime.makeUnsafe(ask.outbound.dueBy))}`,
                            ]
                      ),
                    ].join("\n"),
                    { pending: asks.length }
                  )
            )
          )
        )
      )
    ),
    Match.when("handled", () =>
      Effect.gen(function* handled() {
        if (params.replyTo === undefined) {
          return loud("Pass replyTo: the original id of the relayed message.");
        }

        const delivered = yield* ratking.handled(params.replyTo);

        if ("acked" in delivered) {
          return ok(
            `Handled recorded for ${delivered.id}: this Pi no longer holds the relayed message, so its delivery was acknowledged and no confirmation was sent to the desk.`,
            { acked: true, id: delivered.id, replyTo: params.replyTo }
          );
        }

        return ok(
          `Handled confirmed to ${delivered.to} (id ${delivered.id}, seq ${delivered.seq}).`,
          { id: delivered.id, replyTo: params.replyTo, seq: delivered.seq }
        );
      })
    ),
    Match.when("reply", () =>
      Effect.gen(function* reply() {
        const message = yield* needMessage(params, lead);

        const pending = (yield* ratking.pending).filter(
          (ask) => ask.outbound === undefined
        );

        const target =
          params.replyTo ?? (pending.length === 1 ? pending[0]?.id : undefined);

        if (target === undefined) {
          return loud(
            pending.length === 0
              ? "No pending ask to reply to; pass replyTo from the message, or use send."
              : `Several asks are pending; pass replyTo: ${pending.map((ask) => ask.id).join(", ")}`
          );
        }

        const delivered = yield* ratking.reply(target, message, {
          ...encryption,
          replyAll: params.replyAll ?? true,
          to: params.to,
        });

        return ok(
          withPresence(receiptText("Reply delivered to", delivered), delivered),
          {
            id: delivered.id,
            recipients: recipientsOf(delivered),
            replyTo: target,
            seq: delivered.seq,
            ...presenceDetails(delivered),
          }
        );
      })
    ),
    Match.when("record", () =>
      Effect.gen(function* record() {
        const value = yield* validateRecord(params.type, params.record).pipe(
          Effect.mapError((error) => loud(invalidRecordText(error)))
        );

        const to = yield* needTo(params);

        const body =
          value.$type === "sh.mschf.agentgraph.wake"
            ? yield* Schema.decodeUnknownEffect(LexiconRecord)(value).pipe(
                Effect.mapError((error) => loud(error.message))
              )
            : JSON.stringify(value);

        const delivered = yield* ratking.send(to, body, {
          ...encryption,
          cc: params.cc ?? [],
          kind: "data",
          summary: params.summary ?? recordSummary(value),
        });

        return ok(
          `Record delivered to ${delivered.to} over Rat King (id ${delivered.id}, seq ${delivered.seq}).`,
          { id: delivered.id, seq: delivered.seq, to: delivered.to }
        );
      })
    ),
    Match.when("send", () =>
      Effect.gen(function* send() {
        const to = yield* needTo(params);
        const message = yield* needMessage(params, lead);

        const delivered = yield* ratking.send(to, message, {
          ...encryption,
          cc: params.cc ?? [],
        });

        return ok(
          withPresence(receiptText("Delivered to", delivered), delivered),
          {
            id: delivered.id,
            recipients: recipientsOf(delivered),
            seq: delivered.seq,
            to: delivered.to,
            ...presenceDetails(delivered),
          }
        );
      })
    ),
    Match.when("ask", () =>
      Effect.gen(function* ask() {
        const to = yield* needTo(params);
        const message = yield* needMessage(params, lead);

        const askOptions: AskOptions = {
          ...encryption,
          cc: params.cc ?? [],
        };

        if (params.dueBy !== undefined) {
          Object.assign(askOptions, { dueBy: params.dueBy });
        }

        if (params.wait !== undefined) {
          Object.assign(askOptions, { wait: params.wait });
        }

        const { delivered, reply } = yield* ratking.ask(
          to,
          message,
          params.wait === true
            ? `${params.timeoutSeconds ?? 600} seconds`
            : askTimeout,
          askOptions
        );

        if (reply === undefined) {
          return ok(
            withPresence(
              `✓ asked ${delivered.to} · ${delivered.id.slice(0, 8)}\nThe reply arrives as a message; your turn is not blocked.`,
              delivered
            ),
            { id: delivered.id, recipients: recipientsOf(delivered) }
          );
        }

        return ok(
          [
            ...(recipientsOf(delivered).length > 1
              ? [receiptText("Delivered to", delivered), ""]
              : []),
            `**Reply from ${reply.from}** (id ${reply.id}):\n${reply.body}`,
          ].join("\n"),
          {
            id: delivered.id,
            recipients: recipientsOf(delivered),
            replyId: reply.id,
          }
        );
      })
    ),
    Match.when("retire", () =>
      Effect.gen(function* retire() {
        const successor = Option.fromNullishOr(params.successor).pipe(
          Option.map((name) => name.trim()),
          Option.filter((name) => name !== "")
        );

        const retired = yield* ratking.retire(successor);

        return ok(
          `Retired ${retired.name} at ${retired.retiredAt}. Mail to it is now refused${
            retired.successor === undefined
              ? ""
              : `, naming ${retired.successor} as the current row`
          }. This reader stops; a new session under this name acquires its lease and clears the retirement.`,
          { name: retired.name, retired: true }
        );
      })
    ),
    Match.exhaustive,
    Effect.map((result) =>
      clamp === undefined || result.isError
        ? result
        : { ...result, text: `${result.text}\n${clamp.note}` }
    ),
    Effect.catchTags({
      AskFailed: (error) =>
        Effect.succeed(
          loud(`${error.code}: ${error.reason}`, { code: error.code })
        ),
      NotDelivered: (error) =>
        Effect.succeed(
          loud(
            error.addressed === undefined
              ? notDeliveredText(error)
              : ccRefusalPrompt({
                  action: params.action,
                  addressed: error.addressed,
                  call: (call) => toolCall(tool, call),
                }),
            { code: error.code }
          )
        ),
    }),
    Effect.match({ onFailure: (text) => text, onSuccess: (text) => text })
  );
});

export const notConfiguredText = (error: NotConfigured) =>
  loud(`NOT DELIVERED: NotConfigured. ${error.reason}.`, {
    code: "NotConfigured",
  });
