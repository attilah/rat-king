import { DurableObject } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import { bindingServices } from "./bindings.ts";
import type { BillingBindings } from "./bindings.ts";
/* oxlint-disable typescript/promise-function-async -- Cloudflare RPC and fetch are Promise boundaries. */
import type { AlertValue } from "./contracts.ts";
import { Ack, Alert } from "./contracts.ts";
import { handle } from "./http.ts";
import { initialize, queueMethods } from "./queue.ts";

export class BillingQueue extends DurableObject<BillingBindings> {
  private readonly queue;
  constructor(ctx: DurableObjectState, env: BillingBindings) {
    super(ctx, env);

    const sql = {
      exec: (query: string, ...values: readonly (string | number | null)[]) =>
        ctx.storage.sql.exec(query, ...values),
      transaction: <A>(operation: () => A) =>
        ctx.storage.transactionSync(operation),
    };

    initialize(sql);
    this.queue = queueMethods(sql);
  }
  insert(value: AlertValue) {
    return Effect.runPromise(
      Schema.decodeUnknownEffect(Alert)(value).pipe(
        Effect.flatMap(this.queue.insert)
      )
    );
  }
  pull() {
    return Effect.runPromise(this.queue.pull());
  }
  ack(value: readonly string[]) {
    return Effect.runPromise(
      Schema.decodeUnknownEffect(Ack)({ ids: value }).pipe(
        Effect.flatMap(({ ids }) => this.queue.ack(ids))
      )
    );
  }
}

export default {
  fetch: (request: Request, env: BillingBindings) =>
    Effect.runPromise(
      handle(HttpServerRequest.fromWeb(request)).pipe(
        Effect.provide(bindingServices(env)),
        Effect.map(HttpServerResponse.toWeb)
      )
    ),
};
