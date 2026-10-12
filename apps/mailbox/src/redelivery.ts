import { failure } from "./failure.ts";
import type { Transaction } from "./store.ts";

export const redeliver = (tx: Transaction, now: number) => {
  for (const message of tx.delivered()) {
    const { expiresAt } = message.envelope.aad;

    if (expiresAt !== undefined && Date.parse(expiresAt) <= now) {
      continue;
    }

    const seq = tx.watermark() + 1;

    if (!Number.isSafeInteger(seq)) {
      throw failure("MailboxUnavailable", 503, "Sequence exhausted");
    }

    tx.append({
      $type: "sh.mschf.ratking.defs#messageEvent",
      envelope: message.envelope,
      receipt: message.current,
      seq,
    });
  }
};
