import { Schema } from "effect";

import * as Defs from "./defs.ts";
import * as Runtime from "./runtime.ts";

export const Params = Schema.Undefined;

export type ParamsValue = typeof Params.Type;

export const Input = Schema.StructWithRest(
  Schema.Struct({
    envelope: Defs.EncryptedEnvelope,
    pass: Defs.SignedPass,
    request: Defs.PassRequest,
    signature: Runtime.lexString({
      description:
        "Base64url ES256 by the pass's worker key over the request signing bytes.",
      type: "string",
    }).check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/u)),
  }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type InputValue = typeof Input.Type;

export const Output = Schema.StructWithRest(
  Schema.Struct({ receipt: Defs.Receipt }),
  [Schema.Record(Schema.String, Runtime.Data)]
);

export type OutputValue = typeof Output.Type;

export const ErrorBody = Runtime.XrpcErrorBody;

export type ErrorBodyValue = typeof ErrorBody.Type;

export const KnownErrors = [
  "Retired",
  "InvalidRequest",
  "AuthRequired",
  "Forbidden",
  "Conflict",
  "UnsupportedEnvelope",
  "MailboxUnavailable",
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
  nsid: "sh.mschf.ratking.mailbox.sendViaPass",
  output: Output,
  outputEncoding: "application/json",
  params: Params,
  path: "/xrpc/sh.mschf.ratking.mailbox.sendViaPass",
} as const;
