import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { Command } from "effect/cli";

import { doctorCommand, whoamiCommand } from "./identity.ts";
import { inboxCommand, readCommand, threadCommand } from "./inbox.ts";
import {
  askCommand,
  pendingCommand,
  replyCommand,
  sendCommand,
} from "./messaging.ts";

export const command = Command.make("ratking").pipe(
  Command.withDescription(
    "Rat King client: signed mail between named agents. send, ask and reply sign with the name's key and never take its lease; inbox, read and thread peek and never ack; only inbox --hold consumes."
  ),
  Command.withSubcommands([
    sendCommand,
    askCommand,
    replyCommand,
    inboxCommand,
    readCommand,
    threadCommand,
    pendingCommand,
    whoamiCommand,
    doctorCommand,
  ])
);

export const runRatking = (args: readonly string[]) =>
  Command.runWith(command, { version: "0.1.0" })(args);

export const main = (args: readonly string[]) =>
  runRatking(args).pipe(Effect.provide(NodeServices.layer));
