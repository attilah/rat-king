import { Failure, Notice, Speaks } from "@rat-king/remembers";
import type { Job, NoticeValue } from "@rat-king/remembers";
import { SqlCells } from "@rat-king/remembers/sqlite";
import { Context, Effect, Layer, Schema, Semaphore } from "effect";

export class NoticeTransport extends Context.Service<
  NoticeTransport,
  {
    readonly prepare: (notice: NoticeValue) => Job<string>;
    readonly send: (wire: string) => Job<void>;
  }
>()("remembers-host/NoticeTransport") {}

const Pending = Schema.Struct({
  notice: Notice,
  sent: Schema.Boolean,
  wire: Schema.String,
});

const failed = () =>
  new Failure({ code: "notice_identity", operation: "speaks" });

export const durableSpeaks = Layer.effect(
  Speaks,
  Effect.gen(function* durableSpeaks() {
    const sql = yield* (yield* SqlCells).control();
    const transport = yield* NoticeTransport;
    const lock = yield* Semaphore.make(1);
    yield* sql.execute(
      "CREATE TABLE IF NOT EXISTS remembers_outbox(id TEXT PRIMARY KEY, json TEXT NOT NULL)",
      []
    );

    return Speaks.of({
      send: (notice) =>
        lock.withPermit(
          Effect.gen(function* send() {
            if (!notice.encrypted) {
              return yield* failed();
            }

            const [row] = yield* sql.query(
              "SELECT json FROM remembers_outbox WHERE id=?",
              [notice.id]
            );

            const pending =
              row === undefined
                ? {
                    notice,
                    sent: false,
                    wire: yield* transport.prepare(notice),
                  }
                : yield* Schema.decodeUnknownEffect(
                    Schema.fromJsonString(Pending)
                  )(row.json).pipe(Effect.mapError(failed));

            if (JSON.stringify(pending.notice) !== JSON.stringify(notice)) {
              return yield* failed();
            }

            if (pending.sent) {
              return yield* Effect.void;
            }

            yield* sql.execute(
              "INSERT OR IGNORE INTO remembers_outbox(id,json) VALUES (?,?)",
              [notice.id, JSON.stringify(pending)]
            );
            yield* transport.send(pending.wire);

            return yield* sql.execute(
              "UPDATE remembers_outbox SET json=? WHERE id=?",
              [JSON.stringify({ ...pending, sent: true }), notice.id]
            );
          })
        ),
    });
  })
);
