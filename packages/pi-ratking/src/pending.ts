import { Option, Schema } from "effect";

export const PENDING_ENTRY = "ratking_pending";

export const MAIL_MESSAGE = "ratking_message";

export interface PendingMail {
  readonly content: string;
  readonly deliverAs?: DeliverAs;
  readonly details: unknown;
  readonly id: string;
}

const PendingEntry = Schema.Struct({
  customType: Schema.Literal(PENDING_ENTRY),
  data: Schema.Struct({
    content: Schema.String,
    deliverAs: Schema.optionalKey(
      Schema.Literals(["followUp", "nextTurn", "steer"])
    ),
    details: Schema.Unknown,
    id: Schema.String,
  }),
  type: Schema.Literal("custom"),
});

const ShownEntry = Schema.Struct({
  customType: Schema.Literal(MAIL_MESSAGE),
  details: Schema.Struct({ id: Schema.String }),
  type: Schema.Literal("custom_message"),
});

const ShownMessage = Schema.Struct({
  customType: Schema.Literal(MAIL_MESSAGE),
  details: Schema.Struct({ id: Schema.String }),
  role: Schema.Literal("custom"),
});

export interface SessionMessage {
  readonly customType?: string;
  readonly details?: unknown;
  readonly role: string;
}

export const shownId = (message: SessionMessage): Option.Option<string> =>
  Option.map(
    Schema.decodeUnknownOption(ShownMessage)(message),
    (shown) => shown.details.id
  );

export const unshown = (entries: readonly unknown[]): PendingMail[] => {
  const shown = new Set<string>();
  const pending = new Map<string, PendingMail>();

  for (const entry of entries) {
    const taken = Schema.decodeUnknownOption(PendingEntry)(entry);

    if (Option.isSome(taken)) {
      pending.set(taken.value.data.id, taken.value.data);
    }

    const seen = Schema.decodeUnknownOption(ShownEntry)(entry);

    if (Option.isSome(seen)) {
      shown.add(seen.value.details.id);
    }
  }

  return [...pending.values()].filter((mail) => !shown.has(mail.id));
};

export type DeliverAs = "followUp" | "nextTurn" | "steer";

export interface MailHost {
  readonly appendEntry?: (customType: string, data: PendingMail) => void;
  readonly show: (pending: PendingMail, deliverAs: DeliverAs) => void;
}

const quiet = (mail: PendingMail) => mail.deliverAs === "nextTurn";

export const inbox = (host: MailHost) => {
  const pending = new Map<string, PendingMail>();

  return {
    resend: () => {
      for (const mail of pending.values()) {
        if (!quiet(mail)) {
          host.show(mail, "steer");
        }
      }
    },
    restore: (entries: readonly unknown[]) => {
      pending.clear();

      for (const mail of unshown(entries)) {
        pending.set(mail.id, mail);
        host.show(mail, quiet(mail) ? "nextTurn" : "steer");
      }
    },
    shown: (id: string) => {
      pending.delete(id);
    },
    take: (taken: PendingMail, deliverAs: DeliverAs) => {
      const mail = { ...taken, deliverAs };

      pending.set(mail.id, mail);
      host.appendEntry?.(PENDING_ENTRY, mail);
      host.show(mail, deliverAs);
    },
  };
};
