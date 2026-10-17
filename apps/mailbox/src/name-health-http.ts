/* oxlint-disable typescript/promise-function-async -- Effect adapters require lazy Promise thunks. */
import * as NameHealth from "@rat-king/lexicon/mailbox.nameHealth";
import { Effect } from "effect";

import type { Bindings } from "./bindings.ts";
import { didAllowlist } from "./documents.ts";
import { failure } from "./failure.ts";

export const nameHealthRequest = Effect.fn("Mailbox.nameHealthRequest")(
  function* nameHealthRequest(request: Request, env: Bindings, issuer: string) {
    if (request.method !== "GET") {
      return yield* failure("InvalidRequest");
    }

    if (!didAllowlist(env.OPERATOR_DIDS).includes(issuer)) {
      return yield* failure("Forbidden", 403);
    }

    const params = yield* NameHealth.decodeParams([
      ...new URL(request.url).searchParams.entries(),
    ]).pipe(Effect.mapError(() => failure("InvalidRequest")));

    const result = yield* Effect.tryPromise({
      catch: () => failure("MailboxUnavailable", 503),
      try: () =>
        env.MAILBOX.getByName(params.recipientDid).readNameHealth(
          JSON.stringify(params),
          issuer
        ),
    });

    return new Response(result.body, {
      headers: { "content-type": "application/json" },
      status: result.status,
    });
  }
);
