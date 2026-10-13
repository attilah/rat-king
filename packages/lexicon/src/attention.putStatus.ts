import { Schema } from "effect";

import * as AttentionStatus from "./attention.status.ts";
import * as Runtime from "./runtime.ts";

export const Params = Schema.Undefined;

export type ParamsValue = typeof Params.Type;

export const Input = Schema.StructWithRest(
  Schema.Struct({
    did: Runtime.lexString({ format: "did", type: "string" }).pipe(
      Schema.brand("Lexicon:did")
    ),
    keyId: Runtime.lexString({ type: "string" }),
    signature: Runtime.Bytes.check(
      Schema.makeFilter(
        (value) => value.length >= 0 && value.length <= 9_007_199_254_740_991,
        { expected: "byte length constraints" }
      )
    ),
    status: AttentionStatus.Main,
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type InputValue = typeof Input.Type;

export const Output = Schema.StructWithRest(
  Schema.Struct({ status: AttentionStatus.Main }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type OutputValue = typeof Output.Type;

export const ErrorBody = Runtime.XrpcErrorBody;

export type ErrorBodyValue = typeof ErrorBody.Type;

export const KnownErrors = [
  "AuthRequired",
  "Forbidden",
  "InvalidRequest",
] as const;

export type KnownError = (typeof KnownErrors)[number];

export const isKnownError = (value: string): value is KnownError =>
  KnownErrors.some((name) => name === value);

export const Method = {
  defaults: {},
  error: ErrorBody,
  input: Input,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.attention.putStatus",
  output: Output,
  outputEncoding: "application/json",
  params: Params,
  path: "/xrpc/sh.mschf.ratking.attention.putStatus",
} as const;
