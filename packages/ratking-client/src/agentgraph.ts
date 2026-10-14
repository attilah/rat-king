import * as CheckIn from "@rat-king/lexicon/agentgraph.checkin";
import * as Friction from "@rat-king/lexicon/agentgraph.friction";
import * as Outcome from "@rat-king/lexicon/agentgraph.outcome";
import * as Plan from "@rat-king/lexicon/agentgraph.plan";
import * as Wake from "@rat-king/lexicon/agentgraph.wake";
import { Turn } from "@rat-king/lexicon/turns";
import { Effect, Option, Result, Schema } from "effect";

export const AgentGraphRecord = Schema.Union([
  CheckIn.Main,
  Plan.Main,
  Outcome.Main,
]);

const OutboundRecord = Schema.Union([
  AgentGraphRecord,
  Friction.Main,
  Turn,
  Wake.Main,
]);

export type AgentGraphRecordValue = typeof OutboundRecord.Type;

export class InvalidRecord extends Schema.TaggedError<InvalidRecord>()(
  "InvalidRecord",
  {
    reason: Schema.String,
  }
) {}

const allowedKeys = new Map([
  ["sh.mschf.agentgraph.checkin", Object.keys(CheckIn.Main.schema.fields)],
  ["sh.mschf.agentgraph.plan", Object.keys(Plan.Main.schema.fields)],
  ["sh.mschf.agentgraph.outcome", Object.keys(Outcome.Main.schema.fields)],
  ["sh.mschf.agentgraph.turn", Object.keys(Turn.schema.fields)],
  ["sh.mschf.agentgraph.friction", Object.keys(Friction.Main.schema.fields)],
  ["sh.mschf.agentgraph.wake", Object.keys(Wake.Main.schema.fields)],
]);

export const invalidRecordText = (error: InvalidRecord) =>
  `NOT SENT: InvalidRecord. ${error.reason}`;

export const validateRecord = Effect.fn("RatKing.validateRecord")(
  function* validateRecord(
    type: string | undefined,
    record: Schema.Json | undefined
  ) {
    if (type === undefined || !allowedKeys.has(type)) {
      return yield* new InvalidRecord({
        reason: `$type: choose ${[...allowedKeys.keys()].toSorted().join(", ")}`,
      });
    }

    const object = Schema.decodeUnknownResult(
      Schema.Record(Schema.String, Schema.Json)
    )(record);

    if (Result.isFailure(object)) {
      return yield* new InvalidRecord({
        reason: "record: supply a JSON object",
      });
    }

    const keys = allowedKeys.get(type);

    if (keys === undefined) {
      return yield* new InvalidRecord({ reason: "$type: unknown record type" });
    }

    if (object.success.$type !== undefined && object.success.$type !== type) {
      return yield* new InvalidRecord({
        reason: `$type: must match requested type ${type}`,
      });
    }

    const allowed = keys.toSorted();

    const unknown = Object.keys(object.success).find(
      (key) => !allowed.includes(key)
    );

    if (unknown !== undefined) {
      return yield* new InvalidRecord({
        reason: `${unknown}: unknown top-level key; allowed: ${allowed.join(", ")}`,
      });
    }

    return yield* Schema.decodeUnknownEffect(OutboundRecord)({
      $type: type,
      ...object.success,
    }).pipe(
      Effect.mapError((error) => new InvalidRecord({ reason: error.message }))
    );
  }
);

export const recordSummary = (record: AgentGraphRecordValue) => {
  switch (record.$type) {
    case "sh.mschf.agentgraph.checkin": {
      return `check-in${record.mode === "ask" ? " ask" : ""}: ${record.project} ${record.goal}`.slice(
        0,
        280
      );
    }

    case "sh.mschf.agentgraph.plan": {
      return `plan: ${record.verdict} · ${record.packets.length} packets`;
    }

    case "sh.mschf.agentgraph.friction": {
      return `friction: ${record.kind} · ${record.what}`.slice(0, 280);
    }

    case "sh.mschf.agentgraph.turn": {
      return `turn: ${record.agent} ${record.state}`;
    }

    case "sh.mschf.agentgraph.wake": {
      return `wake: ${record.label} · ${record.status}`.slice(0, 280);
    }

    case "sh.mschf.agentgraph.outcome": {
      return `outcome: ${record.outcome} · gate ${record.gate}`;
    }

    default: {
      return record satisfies never;
    }
  }
};

export const decodeAgentGraphBody = (body: string) =>
  Schema.decodeUnknownResult(Schema.fromJsonString(AgentGraphRecord))(
    body
  ).pipe(Result.getSuccess);

export const compactRecord = (body: string) =>
  decodeAgentGraphBody(body).pipe(
    Option.map((record) => {
      if (record.$type === "sh.mschf.agentgraph.checkin") {
        return `check-in ${record.mode}: ${record.project} · guess ${record.guess.workType} ${record.guess.model} ${record.guess.thinking} · ${record.guess.packets} packets`;
      }

      return recordSummary(record);
    })
  );

export const renderRecordBody = (body: string) =>
  Option.match(decodeAgentGraphBody(body), {
    onNone: () => body,
    onSome: (record) =>
      `${record.$type}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``,
  });
