import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.ratking.attention.status"),
    note: Schema.optionalKey(
      Runtime.lexString({ maxLength: 120, type: "string" })
    ),
    state: Runtime.lexString({
      enum: ["available", "busy", "dnd"],
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literals(["available", "busy", "dnd"]))),
    until: Schema.optionalKey(
      Runtime.lexString({ format: "datetime", type: "string" }).pipe(
        Schema.brand("Lexicon:datetime")
      )
    ),
    version: Runtime.lexString({ const: "0.1", type: "string" }).pipe(
      Schema.decodeTo(Schema.Literal("0.1"))
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.mschf.ratking.attention.status",
  key: "literal:self",
} as const;
