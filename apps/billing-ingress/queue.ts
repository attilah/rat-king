import { Clock, Effect, Schema } from "effect";

import type { AlertValue } from "./contracts.ts";
import { Alert, BillingFailure, BATCH_LIMIT, RETENTION } from "./contracts.ts";

export interface QueueSql {
  readonly exec: (
    query: string,
    ...values: readonly (string | number | null)[]
  ) => Iterable<unknown>;
  readonly transaction: <A>(operation: () => A) => A;
}

const Row = Schema.Struct({
  id: Alert.fields.id,
  payload: Schema.String,
  receivedAt: Schema.Number,
});

export const QUEUE_CAPACITY = 1000;

export const initialize = (sql: QueueSql) => {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, receivedAt INTEGER NOT NULL, payload TEXT)"
  );
  sql.exec("CREATE INDEX IF NOT EXISTS alerts_expiry ON alerts(receivedAt)");
};

export const queueMethods = (sql: QueueSql) => {
  const transaction = <A>(operation: (now: number) => A) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Effect.try({
          catch: (error) =>
            Schema.is(BillingFailure)(error)
              ? error
              : new BillingFailure({ status: 503 }),
          try: () =>
            sql.transaction(() => {
              sql.exec(
                "DELETE FROM alerts WHERE receivedAt <= ?",
                now - RETENTION
              );

              return operation(now);
            }),
        })
      )
    );

  return {
    ack: Effect.fn("Billing.Queue.ack")((ids: readonly string[]) =>
      transaction(() => {
        for (const id of ids) {
          sql.exec("UPDATE alerts SET payload = NULL WHERE id = ?", id);
        }
      })
    ),
    insert: Effect.fn("Billing.Queue.insert")((alert: AlertValue) =>
      transaction(() => {
        if (
          [...sql.exec("SELECT id FROM alerts WHERE id = ?", alert.id)].length >
          0
        ) {
          return;
        }

        if (
          [...sql.exec("SELECT id FROM alerts LIMIT ?", QUEUE_CAPACITY)]
            .length >= QUEUE_CAPACITY
        ) {
          throw new BillingFailure({ status: 503 });
        }

        sql.exec(
          "INSERT INTO alerts (id, receivedAt, payload) VALUES (?, ?, ?)",
          alert.id,
          alert.receivedAt,
          JSON.stringify(alert.payload)
        );
      })
    ),
    pull: Effect.fn("Billing.Queue.pull")(function* pull() {
      const rows = yield* transaction(() => [
        ...sql.exec(
          "SELECT id, receivedAt, payload FROM alerts WHERE payload IS NOT NULL ORDER BY receivedAt, id LIMIT ?",
          BATCH_LIMIT
        ),
      ]);

      return yield* Effect.all(
        rows.map((row) =>
          Schema.decodeUnknownEffect(Row)(row).pipe(
            Effect.flatMap((decoded) =>
              Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
                decoded.payload
              ).pipe(Effect.map((payload) => ({ ...decoded, payload })))
            )
          )
        )
      ).pipe(Effect.mapError(() => new BillingFailure({ status: 503 })));
    }),
  };
};
