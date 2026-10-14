import { isOperator } from "@rat-king/ratking-client/attend";

import { oneLine } from "./text.ts";

export interface MailParty {
  readonly from: string;
  readonly kind: "message" | "ask" | "reply" | "data";
  readonly label?: string | undefined;
  readonly verified?: boolean | undefined;
}

export const mailParty = (value: MailParty): string => {
  if (
    isOperator({
      from: value.from,
      kind: value.kind,
      verified: value.verified === true,
    })
  ) {
    return "Joel";
  }

  const label =
    oneLine(value.label ?? value.from).split(" · ")[0] ?? value.from;

  return /^(?:operator|joel)$/iu.test(label.trim())
    ? oneLine(value.from)
    : label;
};
