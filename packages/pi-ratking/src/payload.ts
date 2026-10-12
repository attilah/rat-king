import { Effect, Option, Schema } from "effect";

import { PayloadJson } from "../../mailbox-client/src/payload.ts";
import type { KindValue } from "../../mailbox-client/src/payload.ts";
import { renderRecordBody } from "./agentgraph.ts";
import { AgentName } from "./name.ts";

export const LexiconRecord = Schema.StructWithRest(
  Schema.Struct({ $type: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)]
);

export type LexiconRecordValue = typeof LexiconRecord.Type;

export const RecordJson = Schema.fromJsonString(LexiconRecord);

export const decodeRecord = (body: string) =>
  Schema.decodeEffect(RecordJson)(body).pipe(Effect.option);

export interface InboundRecord {
  readonly id: string;
  readonly did: string;
  readonly from: string;
  readonly verified: boolean;
  readonly record: LexiconRecordValue;
  readonly replyTo: Option.Option<string>;
}

export {
  encodePayload,
  Kind,
  Payload,
  PayloadJson,
  SUMMARY_MAX,
} from "../../mailbox-client/src/payload.ts";

export type {
  KindValue,
  PayloadValue,
} from "../../mailbox-client/src/payload.ts";

export const decodePayload = (body: string) =>
  Schema.decodeEffect(PayloadJson)(body).pipe(Effect.option);

export const RelaySource = Schema.Struct({
  did: Schema.String,
  encrypted: Schema.Boolean,
  name: AgentName,
});

export interface Inbound {
  readonly relay?: typeof RelaySource.Type;
  readonly sentBy?: string;
  readonly id: string;
  readonly did: string;
  readonly from: string;
  readonly label: Option.Option<string>;
  readonly verified: boolean;
  readonly body: string;
  readonly kind: KindValue;
  readonly replyTo: Option.Option<string>;
  readonly summary: Option.Option<string>;
  readonly cc: boolean;
  readonly ccNames?: readonly string[];
  readonly copy?: boolean;
  readonly to?: string;
  readonly thread?: string;
}

export const replyHint = (tool: string, inbound: Inbound) =>
  [
    `To reply${inbound.relay === undefined ? "" : ` to ${inbound.from}`}: ${tool}({ action: "reply", replyTo: "${inbound.id}", ${inbound.relay === undefined ? "" : "replyAll: false, "}summary: "...", message: "..." })`,
    ...(inbound.relay === undefined
      ? []
      : [
          `To confirm handled without replying: ${tool}({ action: "handled", replyTo: "${inbound.id}" })`,
        ]),
    ...(inbound.kind === "ask"
      ? ["The sender is waiting for this reply."]
      : []),
  ].join("\n");

const renderSent = (inbound: Inbound, by: string) =>
  [
    `**Rat King message sent by ${by}** · to ${inbound.to ?? "unknown"} · id ${inbound.id}${Option.match(
      inbound.replyTo,
      { onNone: () => "", onSome: (id) => ` · in reply to ${id}` }
    )}`,
    ...((inbound.ccNames?.length ?? 0) > 0
      ? [`cc: ${(inbound.ccNames ?? []).join(", ")}`]
      : []),
    "",
    ...Option.match(inbound.summary, {
      onNone: () => [],
      onSome: (summary) => [`Summary: ${summary}`, ""],
    }),
    inbound.kind === "data" ? renderRecordBody(inbound.body) : inbound.body,
    "",
    `Context only: ${by} already sent this. Do not reply to it.`,
  ].join("\n");

export const COPY_BODY_MAX = 500;

export const COPY_NOTE =
  "You are cc'd, so this did not wake you. No action is expected unless it names you; the sender uses to: for whoever must act.";

const quietCopy = (inbound: Inbound) =>
  inbound.copy === true &&
  inbound.kind !== "ask" &&
  inbound.relay === undefined;

const copyBody = (inbound: Inbound) => {
  if (Option.isSome(inbound.summary)) {
    return "(Full text kept in the session view.)";
  }

  return inbound.body.length > COPY_BODY_MAX
    ? `${inbound.body.slice(0, COPY_BODY_MAX)}… (clipped; full text kept in the session view)`
    : inbound.body;
};

export const renderInbound = (tool: string, inbound: Inbound) => {
  if (inbound.sentBy !== undefined) {
    return renderSent(inbound, inbound.sentBy);
  }

  const name = inbound.verified
    ? inbound.from
    : `${inbound.from} (unverified name; sender ${inbound.did})`;

  const sender = Option.match(inbound.label, {
    onNone: () => name,
    onSome: (label) => `${label} (${name})`,
  });

  const label = inbound.cc ? "Rat King CC" : "Rat King message";

  const thread = Option.match(inbound.replyTo, {
    onNone: () => "",
    onSome: (id) => ` · in reply to ${id}`,
  });

  return [
    `**${label} from ${sender}** · id ${inbound.id}${thread}${inbound.relay === undefined ? "" : ` · via ${inbound.relay.name}`}`,
    ...((inbound.ccNames?.length ?? 0) > 0
      ? [`cc: ${(inbound.ccNames ?? []).join(", ")}`]
      : []),
    "",
    ...Option.match(inbound.summary, {
      onNone: () => [],
      onSome: (summary) => [`Summary: ${summary}`, ""],
    }),
    ...(quietCopy(inbound)
      ? [copyBody(inbound), "", COPY_NOTE]
      : [
          inbound.kind === "data"
            ? renderRecordBody(inbound.body)
            : inbound.body,
        ]),
    "",
    replyHint(tool, inbound),
  ].join("\n");
};
