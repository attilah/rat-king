import { Credential, TrustFailure } from "@rat-king/lexicon/trust";
import { Effect, Option, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

export const presentedCredential = Effect.fn("Edge.presentedCredential")(
  function* presentedCredential(request: Request) {
    const value = request.headers.get("authorization");

    if (value === null) {
      return Option.none<typeof Credential.Type>();
    }

    if (!value.startsWith("Bearer ") || value.length > 16_384) {
      return yield* new TrustFailure({ reason: "Invalid bearer credential" });
    }

    const text = yield* Effect.fromResult(
      Base64Url.decodeString(value.slice(7))
    ).pipe(
      Effect.mapError(
        () => new TrustFailure({ reason: "Invalid bearer credential" })
      )
    );

    return Option.some(
      yield* Schema.decodeEffect(Schema.fromJsonString(Credential))(text).pipe(
        Effect.mapError(
          () => new TrustFailure({ reason: "Invalid bearer credential" })
        )
      )
    );
  }
);
