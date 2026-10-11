import { XrpcFailure } from "@rat-king/lexicon/xrpc-failure";

export const errorResponse = (error: XrpcFailure) =>
  Response.json(
    { error: error.error, message: error.message },
    { status: error.status }
  );

export const failure = (error: string, status = 400, message = error) =>
  new XrpcFailure({ error, message, response: { error, message }, status });
