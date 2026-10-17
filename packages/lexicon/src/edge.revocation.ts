import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.ratking.revocation"),
    createdAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    invite: Runtime.lexString({
      maxLength: 64,
      minLength: 64,
      type: "string",
    }).check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
    issuer: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.ratking.revocation",
  key: "tid",
} as const;
