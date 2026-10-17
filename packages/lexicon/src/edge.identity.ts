import { Schema } from "effect";

import * as Runtime from "./runtime.ts";

export const PublicKey = Schema.StructWithRest(
  Schema.Struct({
    crv: Runtime.lexString({ const: "P-256", type: "string" }).pipe(
      Schema.decodeTo(Schema.Literal("P-256"))
    ),
    kty: Runtime.lexString({ const: "EC", type: "string" }).pipe(
      Schema.decodeTo(Schema.Literal("EC"))
    ),
    x: Runtime.lexString({
      maxLength: 43,
      minLength: 43,
      type: "string",
    }).check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)),
    y: Runtime.lexString({
      maxLength: 43,
      minLength: 43,
      type: "string",
    }).check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type PublicKeyValue = typeof PublicKey.Type;

export const Main = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("sh.ratking.identity"),
    atprotoHandle: Runtime.lexString({ format: "handle", type: "string" }).pipe(
      Schema.brand("Lexicon:handle")
    ),
    audience: Runtime.lexString({
      const: "https://ratking.sh/mcp",
      type: "string",
    }).pipe(Schema.decodeTo(Schema.Literal("https://ratking.sh/mcp"))),
    createdAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    expiresAt: Runtime.lexString({ format: "datetime", type: "string" }).pipe(
      Schema.brand("Lexicon:datetime")
    ),
    handle: Runtime.lexString({ maxLength: 256, type: "string" }).check(
      Schema.isPattern(/^ext\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/u)
    ),
    publicKey: PublicKey,
    subject: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type MainValue = typeof Main.Type;

export const RecordMetadata = {
  collection: "sh.ratking.identity",
  key: "tid",
} as const;
