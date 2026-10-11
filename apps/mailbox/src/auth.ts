import { authenticateClaims } from "@rat-king/mailbox-client";
import type { AuthenticateRequest } from "@rat-king/mailbox-client";
import { Effect } from "effect";

export {
  authenticateClaims,
  base64url,
  unbase64url,
  Claims,
  Document,
  Documents,
  DidResolver,
  documentResolver,
  ReplayAuthority,
  staticResolver,
  serviceToken,
} from "@rat-king/mailbox-client";

export type {
  AuthenticateRequest,
  ClaimsValue,
  DocumentsValue,
} from "@rat-king/mailbox-client";

export const authenticate = Effect.fn("ServiceAuth.authenticate")(
  (request: AuthenticateRequest) =>
    authenticateClaims(request).pipe(Effect.map((claims) => claims.iss))
);
