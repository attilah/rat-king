import { recordType } from "@rat-king/mailbox-client";
import { Option } from "effect";

import { decodeAgentGraphBody } from "./agentgraph.ts";

export const SILENT_RECORD_TYPES: readonly string[] = [
  "sh.mschf.ratking.relay#outbound",
];

export const RENDERS: readonly string[] = [
  "sh.mschf.agentgraph.*",
  "sh.mschf.ratking.relay#message",
  "sh.mschf.ratking.relay#handled",
  ...SILENT_RECORD_TYPES,
];

export const recordNotice = (
  inbound: {
    readonly body: string;
    readonly id: string;
    readonly from: string;
    readonly did: string;
    readonly verified: boolean;
  },
  settled: boolean
): string | undefined => {
  const type = recordType(inbound.body);

  if (
    settled ||
    type === "unknown" ||
    SILENT_RECORD_TYPES.includes(type) ||
    Option.isSome(decodeAgentGraphBody(inbound.body))
  ) {
    return undefined;
  }

  return `📦 record ${type} from ${inbound.verified ? inbound.from : inbound.did} (id ${inbound.id}), not rendered by this reader`;
};
