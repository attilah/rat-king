import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.mschf.ratking.attention.status"),
    delegate: Schema.optionalKey(
      Runtime.lexString({ type: "string" }).check(
        Schema.isPattern(
          /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u
        )
      )
    ),
    exempt: Schema.optionalKey(
      Schema.Array(
        Runtime.lexString({ type: "string" }).check(
          Schema.isPattern(
            /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u
          )
        )
      ).check(Schema.isMinLength(0), Schema.isMaxLength(16))
    ),
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
