import { Option, Schema } from "effect";

export const PENDING_ENTRY = "ratking_pending";

export const MAIL_MESSAGE = "ratking_message";

export const DIGEST_MESSAGE = "ratking_cc_digest";

export const DEFAULT_DIGEST_MINUTES = 30;

export type DeliverAs = "followUp" | "nextTurn" | "steer";

export type Hold = DeliverAs | "digest";

export interface PendingMail {
  readonly content: string;
  readonly deliverAs?: Hold;
  readonly details: unknown;
  readonly digestMinutes?: number | undefined;
  readonly id: string;
  readonly line?: string;
}

const PendingEntry = Schema.Struct({
  customType: Schema.Literal(PENDING_ENTRY),
  data: Schema.Struct({
    content: Schema.String,
    deliverAs: Schema.optionalKey(
      Schema.Literals(["digest", "followUp", "nextTurn", "steer"])
    ),
    details: Schema.Unknown,
    digestMinutes: Schema.optionalKey(Schema.Number),
    id: Schema.String,
    line: Schema.optionalKey(Schema.String),
  }),
  type: Schema.Literal("custom"),
});

const ShownMail = Schema.Struct({
  customType: Schema.Literal(MAIL_MESSAGE),
  details: Schema.Struct({ id: Schema.String }),
});

const ShownDigest = Schema.Struct({
  customType: Schema.Literal(DIGEST_MESSAGE),
  details: Schema.Struct({ ids: Schema.Array(Schema.String) }),
});

export interface SessionMessage {
  readonly customType?: string;
  readonly details?: unknown;
  readonly role: string;
}

interface Carried {
  readonly customType: string;
  readonly details?: unknown;
}

const shownIn = (value: Carried): readonly string[] =>
  Option.match(Schema.decodeUnknownOption(ShownMail)(value), {
    onNone: () =>
      Option.match(Schema.decodeUnknownOption(ShownDigest)(value), {
        onNone: () => [],
        onSome: (digest) => digest.details.ids,
      }),
    onSome: (mail) => [mail.details.id],
  });

export const shownIds = (message: SessionMessage): readonly string[] =>
  message.role === "custom" && message.customType !== undefined
    ? shownIn({ customType: message.customType, details: message.details })
    : [];

const isShownEntry = Schema.is(
  Schema.Struct({
    customType: Schema.String,
    details: Schema.optionalKey(Schema.Unknown),
    type: Schema.Literal("custom_message"),
  })
);

export const unshown = (entries: readonly unknown[]): PendingMail[] => {
  const shown = new Set<string>();
  const pending = new Map<string, PendingMail>();

  for (const entry of entries) {
    const taken = Schema.decodeUnknownOption(PendingEntry)(entry);

    if (Option.isSome(taken)) {
      pending.set(taken.value.data.id, taken.value.data);
    }

    if (isShownEntry(entry)) {
      for (const id of shownIn(entry)) {
        shown.add(id);
      }
    }
  }

  return [...pending.values()].filter((mail) => !shown.has(mail.id));
};

export interface MailHost {
  readonly appendEntry?: (customType: string, data: PendingMail) => void;
  readonly digest: (mails: readonly PendingMail[]) => void;
  readonly show: (pending: PendingMail, deliverAs: DeliverAs) => void;
}

const quiet = (mail: PendingMail) => mail.deliverAs === "nextTurn";

const held = (mail: PendingMail) => mail.deliverAs === "digest";

const intervalMs = (mails: readonly PendingMail[]) =>
  Math.min(
    ...mails.map((mail) => mail.digestMinutes ?? DEFAULT_DIGEST_MINUTES)
  ) * 60_000;

export const inbox = (host: MailHost) => {
  const pending = new Map<string, PendingMail>();
  const digested = new Set<string>();
  let last = Option.none<number>();

  return {
    resend: () => {
      for (const mail of pending.values()) {
        if (!quiet(mail) && !held(mail)) {
          host.show(mail, "steer");
        }
      }
    },
    restore: (entries: readonly unknown[]) => {
      pending.clear();
      digested.clear();
      last = Option.none();

      for (const mail of unshown(entries)) {
        pending.set(mail.id, mail);

        if (!held(mail)) {
          host.show(mail, quiet(mail) ? "nextTurn" : "steer");
        }
      }
    },
    shown: (id: string) => {
      pending.delete(id);
      digested.delete(id);
    },
    take: (taken: PendingMail, hold: Hold) => {
      const mail = { ...taken, deliverAs: hold };

      pending.set(mail.id, mail);
      host.appendEntry?.(PENDING_ENTRY, mail);

      if (hold !== "digest") {
        host.show(mail, hold);
      }
    },
    tick: (now: number) => {
      const due = [...pending.values()].filter(
        (mail) => held(mail) && !digested.has(mail.id)
      );

      if (Option.isNone(last)) {
        last = Option.some(now);

        return;
      }

      if (due.length === 0 || now - last.value < intervalMs(due)) {
        return;
      }

      last = Option.some(now);

      for (const mail of due) {
        digested.add(mail.id);
      }

      host.digest(due.toReversed());
    },
  };
};

export const digestFor = (
  table: Readonly<Record<string, number>>,
  name: string
): Option.Option<number> =>
  Option.orElse(Option.fromNullishOr(table[name]), () =>
    Option.fromNullishOr(table[name.split("/")[0] ?? name])
  );
