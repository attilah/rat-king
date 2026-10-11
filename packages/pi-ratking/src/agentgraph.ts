import * as CheckIn from "@rat-king/lexicon/agentgraph.checkin";
import * as Outcome from "@rat-king/lexicon/agentgraph.outcome";
import * as Plan from "@rat-king/lexicon/agentgraph.plan";
import { Effect, Option, Result, Schema } from "effect";

export const AgentGraphRecord = Schema.Union([
  CheckIn.Main,
  Plan.Main,
  Outcome.Main,
]);

export type AgentGraphRecordValue = typeof AgentGraphRecord.Type;

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
        reason:
          "$type: choose sh.mschf.agentgraph.checkin, sh.mschf.agentgraph.plan or sh.mschf.agentgraph.outcome",
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

    return yield* Schema.decodeUnknownEffect(AgentGraphRecord)({
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
