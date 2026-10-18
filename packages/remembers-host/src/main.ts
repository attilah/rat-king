import { setPriority } from "node:os";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Failure } from "@rat-king/remembers";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";

import { loadPrivate } from "./config.ts";
import { mailboxPorts } from "./mailbox.ts";
import { hostRuntime, supervisor } from "./supervisor.ts";

const main = Effect.gen(function* main() {
  const [root] = process.argv.slice(2);

  if (root === undefined) {
    return yield* new Failure({ code: "instance_root", operation: "startup" });
  }

  yield* Effect.try({
    catch: () => new Failure({ code: "priority", operation: "startup" }),
    try: () => {
      setPriority(0, 10);
    },
  });
  const config = yield* loadPrivate(root);
  const mailbox = yield* mailboxPorts(config.mailbox, config.workerDid);

  yield* supervisor(config, mailbox.authorize).pipe(
    Effect.provide(hostRuntime(config, mailbox.notices))
  );
  yield* Effect.logInfo(
    "Remembers supervisor idle; waiting for owner mode change"
  );

  return yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.provide([NodeServices.layer, FetchHttpClient.layer])
);

if (import.meta.main) {
  NodeRuntime.runMain(main);
}
