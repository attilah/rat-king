import * as Presence from "@rat-king/lexicon/mailbox.getPresence";
import { Transport } from "@rat-king/lexicon/transport";
import { Effect, Option, Schema } from "effect";

import { clientError, MailboxClientError } from "./error.ts";

export interface ReaderPresence {
  readonly held: boolean;
  readonly renders?: readonly string[];
}

export const readerCannotRender = (
  name: string,
  type: string,
  presence: ReaderPresence | undefined
): string | undefined =>
  presence?.held === true &&
  presence.renders?.some((render) =>
    render.endsWith(".*")
      ? type.startsWith(render.slice(0, -1))
      : type === render
  ) !== true
    ? `NOT SENT: ReaderCannotRender. ${name}'s reader doesn't render ${type} (it predates typed records or doesn't declare it). Send prose instead, or ask them to restart.`
    : undefined;

export const recordType = (body: string) => {
  const result = Schema.decodeUnknownOption(
    Schema.fromJsonString(Schema.Struct({ $type: Schema.String }))
  )(body);

  return Option.match(result, {
    onNone: () => "unknown",
    onSome: (record) => record.$type,
  });
};

export const lookupPresence = Effect.fn("Mailbox.lookupPresence")(
  function* lookupPresence(did: string) {
    const transport = yield* Transport;

    const params = yield* Schema.decodeUnknownEffect(Presence.Params)({
      did,
    }).pipe(Effect.mapError(clientError));

    const response = yield* transport
      .request({
        input: undefined,
        method: "GET",
        nsid: Presence.Method.nsid,
        params: yield* Schema.encodeEffect(Presence.Params)(params).pipe(
          Effect.mapError(clientError)
        ),
      })
      .pipe(Effect.mapError(clientError));

    if (response.kind !== "json" || response.status !== 200) {
      return yield* new MailboxClientError({
        reason: "Presence request refused",
      });
    }

    return yield* Schema.decodeUnknownEffect(Presence.Output)(
      response.body
    ).pipe(Effect.mapError(clientError));
  }
);
