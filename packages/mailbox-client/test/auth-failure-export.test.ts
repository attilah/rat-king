import { it } from "@effect/vitest";
import {
  authenticateClaims,
  ReplayAuthority,
  ServiceAuthFailure,
  serviceToken,
  staticResolver,
} from "@rat-king/mailbox-client/auth";
import { Effect, Layer, Result, Schema } from "effect";
import { expect } from "vitest";

import { XrpcFailure } from "../../lexicon/src/xrpc-failure.ts";
import { importSigning } from "../src/identity.ts";
import { document, identity } from "./identity.ts";

it.effect(
  "a replay port built only from the auth entry refuses with the wire failure",
  () =>
    Effect.gen(function* proof() {
      const sender = yield* identity("did:web:sender.invalid");
      const doc = yield* document(sender);
      const key = yield* importSigning(sender);
      const now = 1000;

      const replay = Layer.succeed(ReplayAuthority, {
        consume: () =>
          Effect.fail(
            new ServiceAuthFailure({
              error: "AuthRequired",
              response: {},
              status: 401,
            })
          ),
      });

      const claims = {
        aud: "did:web:mischief.invalid",
        exp: now + 60,
        iat: now,
        iss: sender.did,
        jti: "replay-port-export-jti-0001",
        lxm: "sh.mschf.mischief.run",
      };

      const result = yield* authenticateClaims({
        audience: claims.aud,
        authorization: `Bearer ${yield* serviceToken(claims, key)}`,
        now: now * 1000,
        nsid: claims.lxm,
      }).pipe(
        Effect.provide(Layer.merge(staticResolver([doc]), replay)),
        Effect.result
      );

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("XrpcFailure");
        expect(Schema.is(XrpcFailure)(result.failure)).toBe(true);
        expect(result.failure.error).toBe("AuthRequired");
        expect(result.failure.status).toBe(401);
      }
    })
);
