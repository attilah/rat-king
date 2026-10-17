import {
  EmptyInput,
  defineReadOnlyContract,
  projectToolkit,
} from "@rat-king/capability/read-only";
import type {
  CredentialValue,
  Signatures,
  TrustAuthority,
} from "@rat-king/lexicon/trust";
import {
  InviteScope,
  SignedInvite,
  TierDescription,
  TrustFailure,
  TrustResult,
  VerifiedInvite,
  tiers,
  verifyInvite,
  whoami,
} from "@rat-king/lexicon/trust";
import { Clock, Config, Effect, Schema } from "effect";

import { about } from "./content.ts";

const About = Schema.Struct({
  commit: Schema.String,
  connect: Schema.String,
  description: Schema.String,
  name: Schema.String,
  readOnly: Schema.Literal(true),
  version: Schema.String,
});

export const aboutContract = defineReadOnlyContract(
  "about",
  "Explain Rat King and the read-only edge.",
  EmptyInput,
  About,
  Schema.Never
);

export const tiersContract = defineReadOnlyContract(
  "tiers",
  "Describe the five trust tiers and what they prove.",
  EmptyInput,
  Schema.Struct({ tiers: Schema.Array(TierDescription) }),
  Schema.Never
);

export const verifyInviteContract = defineReadOnlyContract(
  "verifyInvite",
  "Verify a fleet-signed invite against current authority, expiry, revocation and exact requested scope. This does not grant mail access.",
  Schema.Struct({ invite: SignedInvite, scope: InviteScope }),
  VerifiedInvite,
  TrustFailure
);

export const whoamiContract = defineReadOnlyContract(
  "whoami",
  "Report the trust tier of the credential presented on this request. A session alone proves nothing.",
  EmptyInput,
  TrustResult,
  TrustFailure
);

export const toolkit = projectToolkit(
  aboutContract,
  tiersContract,
  verifyInviteContract,
  whoamiContract
);

export const handlers = (
  credential: CredentialValue | undefined,
  desk: string
) =>
  toolkit.toLayer(
    Effect.gen(function* buildToolHandlers() {
      const context = yield* Effect.context<Signatures | TrustAuthority>();

      const commit = yield* Config.String("RATKING_COMMIT").pipe(
        Config.withDefault("unreleased"),
        Effect.orDie
      );

      return {
        about: () => Effect.succeed({ ...about, commit }),
        tiers: () => Effect.succeed({ tiers }),
        verifyInvite: ({ invite, scope }) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => verifyInvite(invite, scope, now)),
            Effect.provideContext(context)
          ),
        whoami: () =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => whoami(credential, desk, now)),
            Effect.provideContext(context)
          ),
      };
    })
  );
