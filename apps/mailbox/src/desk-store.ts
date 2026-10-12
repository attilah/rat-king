import * as DeskDefs from "@rat-king/lexicon/desk.defs";
import type { XrpcFailure } from "@rat-king/lexicon/xrpc-failure";
import { Context, Layer, Schema } from "effect";
import type { Effect } from "effect";

import { failure } from "./failure.ts";
import type { Sql } from "./sqlite.ts";
import { storageOperation } from "./store.ts";

const Seq = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);

const SnapshotItem = Schema.Struct({
  createdAt: Schema.Int,
  seq: Seq,
  value: Schema.String,
});

export const DeskSnapshot = Schema.Struct({
  delivered: Schema.Array(Schema.Struct({ seq: Seq, uri: Schema.String })),
  deliveredThrough: Seq,
  head: Seq,
  items: Schema.Array(SnapshotItem),
  project: Schema.optionalKey(Schema.String),
  replies: Schema.Array(
    Schema.Struct({ messageId: Schema.String, uri: Schema.String })
  ),
});

export type DeskSnapshotValue = typeof DeskSnapshot.Type;

export interface DeskTransaction {
  readonly head: () => number;
  readonly deliveredThrough: () => number;
  readonly project: () => string | undefined;
  readonly bindProject: (project: string) => void;
  readonly held: (
    uri: string
  ) => { readonly seq: number; readonly cid: string } | undefined;
  readonly insert: (item: DeskDefs.OwnerItemValue, createdAt: number) => number;
  readonly undelivered: (limit: number) => readonly DeskDefs.QueuedValue[];
  readonly since: (
    createdAt: number,
    limit: number
  ) => readonly DeskDefs.QueuedValue[];
  readonly ack: (uris: readonly string[]) => number;
  readonly reply: (uri: string) => string | undefined;
  readonly remember: (uri: string, messageId: string) => string;
  readonly snapshot: (atSeq: number) => DeskSnapshotValue;
  readonly empty: () => boolean;
  readonly seed: (snapshot: DeskSnapshotValue) => void;
}

export class DeskStore extends Context.Service<
  DeskStore,
  {
    readonly transaction: <A>(
      operation: (tx: DeskTransaction) => A
    ) => Effect.Effect<A, XrpcFailure>;
  }
>()("mailbox/DeskStore") {}

const ItemRow = Schema.Struct({
  seq: Seq,
  value: Schema.fromJsonString(DeskDefs.OwnerItem),
});

const HeldRow = Schema.Struct({ cid: Schema.String, seq: Seq });

const ValueRow = Schema.Struct({ value: Schema.String });

const SeqRow = Schema.Struct({ seq: Seq });

const encodeItem = Schema.encodeSync(Schema.fromJsonString(DeskDefs.OwnerItem));

export const deskStore = (sql: Sql) => {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS desk_items (seq INTEGER PRIMARY KEY CHECK(seq > 0 AND seq <= 9007199254740991), uri TEXT NOT NULL UNIQUE, cid TEXT NOT NULL, created_at INTEGER NOT NULL, value TEXT NOT NULL)"
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS desk_delivered (uri TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE)"
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS desk_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  sql.exec(
    "CREATE TABLE IF NOT EXISTS desk_replies (uri TEXT PRIMARY KEY, message_id TEXT NOT NULL)"
  );

  const metadata = (key: string) => {
    const [row] = [
      ...sql.exec("SELECT value FROM desk_metadata WHERE key=?", key),
    ];

    return row === undefined
      ? undefined
      : Schema.decodeUnknownSync(ValueRow)(row).value;
  };

  const setMetadata = (key: string, value: string) => {
    sql.exec(
      "INSERT INTO desk_metadata (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      value
    );
  };

  const counter = (key: string) =>
    Schema.decodeUnknownSync(Seq)(Number(metadata(key) ?? "0"));

  const queued = (rows: Iterable<unknown>) =>
    Array.from(rows, (row) => {
      const { seq, value } = Schema.decodeUnknownSync(ItemRow)(row);

      return { item: value, seq };
    });

  const deliveredThrough = () => counter("deliveredThrough");

  const compact = () => {
    let through = deliveredThrough();

    for (;;) {
      const [row] = [
        ...sql.exec(
          "SELECT i.seq AS seq FROM desk_items i JOIN desk_delivered d ON d.seq = i.seq WHERE i.seq = (SELECT MIN(seq) FROM desk_items WHERE seq > ?)",
          through
        ),
      ];

      if (row === undefined) {
        break;
      }

      through = Schema.decodeUnknownSync(SeqRow)(row).seq;
      sql.exec("DELETE FROM desk_delivered WHERE seq=?", through);
    }

    setMetadata("deliveredThrough", String(through));
  };

  const transaction: DeskTransaction = {
    ack: (uris) => {
      let acked = 0;

      for (const uri of new Set(uris)) {
        const held = transaction.held(uri);

        if (
          held !== undefined &&
          held.seq > deliveredThrough() &&
          [...sql.exec("SELECT seq FROM desk_delivered WHERE uri=?", uri)]
            .length === 0
        ) {
          sql.exec(
            "INSERT INTO desk_delivered (uri,seq) VALUES (?,?)",
            uri,
            held.seq
          );
          acked += 1;
        }
      }

      compact();

      return acked;
    },
    bindProject: (project) => {
      setMetadata("project", project);
    },
    deliveredThrough,
    empty: () =>
      counter("head") === 0 &&
      metadata("project") === undefined &&
      [...sql.exec("SELECT uri FROM desk_replies LIMIT 1")].length === 0,
    head: () => counter("head"),
    held: (uri) => {
      const [row] = [
        ...sql.exec("SELECT seq,cid FROM desk_items WHERE uri=?", uri),
      ];

      return row === undefined
        ? undefined
        : Schema.decodeUnknownSync(HeldRow)(row);
    },
    insert: (item, createdAt) => {
      const seq = counter("head") + 1;
      sql.exec(
        "INSERT INTO desk_items (seq,uri,cid,created_at,value) VALUES (?,?,?,?,?)",
        Schema.decodeUnknownSync(Seq)(seq),
        item.uri,
        item.cid,
        createdAt,
        encodeItem(item)
      );
      setMetadata("head", String(seq));

      return seq;
    },
    project: () => metadata("project"),
    remember: (uri, messageId) => {
      sql.exec(
        "INSERT OR IGNORE INTO desk_replies (uri,message_id) VALUES (?,?)",
        uri,
        messageId
      );

      return transaction.reply(uri) ?? messageId;
    },
    reply: (uri) => {
      const [row] = [
        ...sql.exec(
          "SELECT message_id AS value FROM desk_replies WHERE uri=?",
          uri
        ),
      ];

      return row === undefined
        ? undefined
        : Schema.decodeUnknownSync(ValueRow)(row).value;
    },
    seed: (snapshot) => {
      for (const { createdAt, seq, value } of snapshot.items) {
        const item = Schema.decodeUnknownSync(
          Schema.fromJsonString(DeskDefs.OwnerItem)
        )(value);

        sql.exec(
          "INSERT INTO desk_items (seq,uri,cid,created_at,value) VALUES (?,?,?,?,?)",
          seq,
          item.uri,
          item.cid,
          createdAt,
          value
        );
      }

      for (const { seq, uri } of snapshot.delivered) {
        sql.exec("INSERT INTO desk_delivered (uri,seq) VALUES (?,?)", uri, seq);
      }

      for (const { messageId, uri } of snapshot.replies) {
        sql.exec(
          "INSERT INTO desk_replies (uri,message_id) VALUES (?,?)",
          uri,
          messageId
        );
      }

      if (snapshot.project !== undefined) {
        setMetadata("project", snapshot.project);
      }

      setMetadata("head", String(snapshot.head));
      setMetadata("deliveredThrough", String(snapshot.deliveredThrough));
    },
    since: (createdAt, limit) =>
      queued(
        sql.exec(
          "SELECT seq,value FROM desk_items WHERE created_at >= ? ORDER BY seq ASC LIMIT ?",
          createdAt,
          limit
        )
      ),
    snapshot: (atSeq) => {
      if (atSeq > counter("head")) {
        throw failure("InvalidRequest", 400, "atSeq is beyond the desk's head");
      }

      const project = metadata("project");

      const snapshot = {
        delivered: Array.from(
          sql.exec(
            "SELECT uri,seq FROM desk_delivered WHERE seq <= ? ORDER BY seq ASC",
            atSeq
          ),
          (row) =>
            Schema.decodeUnknownSync(
              Schema.Struct({ seq: Seq, uri: Schema.String })
            )(row)
        ),
        deliveredThrough: Math.min(deliveredThrough(), atSeq),
        head: atSeq,
        items: Array.from(
          sql.exec(
            "SELECT seq,created_at AS createdAt,value FROM desk_items WHERE seq <= ? ORDER BY seq ASC",
            atSeq
          ),
          (row) => Schema.decodeUnknownSync(SnapshotItem)(row)
        ),
        replies: Array.from(
          sql.exec(
            "SELECT r.uri AS uri, r.message_id AS messageId FROM desk_replies r JOIN desk_items i ON i.uri = r.uri WHERE i.seq <= ? ORDER BY i.seq ASC",
            atSeq
          ),
          (row) =>
            Schema.decodeUnknownSync(
              Schema.Struct({ messageId: Schema.String, uri: Schema.String })
            )(row)
        ),
      };

      return project === undefined ? snapshot : { ...snapshot, project };
    },
    undelivered: (limit) =>
      queued(
        sql.exec(
          "SELECT seq,value FROM desk_items WHERE seq > ? AND seq NOT IN (SELECT seq FROM desk_delivered) ORDER BY seq ASC LIMIT ?",
          deliveredThrough(),
          limit
        )
      ),
  };

  return Layer.succeed(
    DeskStore,
    DeskStore.of({
      transaction: (operation) =>
        storageOperation(() => sql.transaction(() => operation(transaction))),
    })
  );
};
