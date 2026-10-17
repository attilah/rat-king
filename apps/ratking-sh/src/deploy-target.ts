import { Effect, Schema } from "effect";

export class TargetFailure extends Schema.TaggedError<TargetFailure>()(
  "TargetFailure",
  { reason: Schema.String }
) {}

export const requireZoneAccount = (
  stage: string,
  expectedAccount: string,
  actualAccount: string
) =>
  stage === "public-edge" &&
  /^[a-f0-9]{32}$/u.test(expectedAccount) &&
  expectedAccount === actualAccount
    ? Effect.void
    : Effect.fail(
        new TargetFailure({
          reason:
            "Select the public-edge stage and the zone's explicitly configured Cloudflare account",
        })
      );
