import { Schema } from "effect";

import * as AttentionPrefs from "./attention.prefs.ts";
import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.ratking.triage.judge"),
    arrivalId: Runtime.lexString({ minLength: 1, type: "string" }),
    body: Schema.optionalKey(Runtime.lexString({ type: "string" })),
    cc: Schema.Array(AttentionPrefs.Name).check(
      Schema.isMinLength(0),
      Schema.isMaxLength(9_007_199_254_740_991)
    ),
    from: AttentionPrefs.Name,
    intent: Runtime.lexString({
      enum: ["to", "cc", "ask", "reply"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["to", "cc", "ask", "reply"]))),
    kind: Runtime.lexString({ type: "string" }),
    recordType: Schema.optionalKey(
      Runtime.lexString({ format: "nsid", type: "string" }).pipe(
        Schema.brand("Lexicon:nsid")
      )
    ),
    sentAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    thread: Runtime.lexString({ minLength: 1, type: "string" }),
    to: AttentionPrefs.Name,
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.ratking.triage.judge",
  key: "any",
} as const;
