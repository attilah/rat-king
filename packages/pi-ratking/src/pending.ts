import { Option, Schema } from "effect";

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

const ShownMail = Schema.Struct({
  customType: Schema.Literals([MAIL_MESSAGE, "ratking_record_notice"]),
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

export interface MailHost {
  readonly digest: (mails: readonly PendingMail[]) => void;
  readonly show: (pending: PendingMail, deliverAs: DeliverAs) => void;
}

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
    clear: () => {
      pending.clear();
      digested.clear();
      last = Option.none();
    },
    shown: (id: string) => {
      pending.delete(id);
      digested.delete(id);
    },
    take: (taken: PendingMail, hold: Hold) => {
      if (pending.has(taken.id)) {
        return;
      }

      const mail = { ...taken, deliverAs: hold };

      pending.set(mail.id, mail);

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
