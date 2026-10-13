import { Command } from "effect/cli";

import {
  identityCommand,
  provisionCommand,
  retireCommand,
  retiredCommand,
  trafficCommand,
  unretireCommand,
} from "../../mailbox/cli/main.ts";

export const operatorCommands = [
  identityCommand.pipe(
    Command.withDescription(
      "Operator: mint a P-256 identity and print its public document. Needs RAT_KING_* operator configuration."
    )
  ),
  provisionCommand.pipe(
    Command.withDescription(
      "Operator: mint and register an agent, keeping keys in agent-secrets. Needs RAT_KING_OPERATOR_IDENTITY."
    )
  ),
  retireCommand.pipe(
    Command.withDescription(
      "Operator: retire a name, optionally naming its successor."
    )
  ),
  unretireCommand.pipe(
    Command.withDescription("Operator: clear a name's retirement by hand.")
  ),
  retiredCommand.pipe(
    Command.withDescription("Operator: list retired names and successors.")
  ),
  trafficCommand.pipe(
    Command.withDescription("Operator: print mailbox traffic for a name.")
  ),
] as const;
