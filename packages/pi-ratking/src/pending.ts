import { Data, Option, Schema } from "effect";

import { Verdicts } from "./attend.ts";
import type { Verdict } from "./attend.ts";

export const MAIL_MESSAGE = "ratking_message";

export const DIGEST_MESSAGE = "ratking_cc_digest";

export const DEFAULT_DIGEST_MINUTES = 30;

export type DeliverAs = "followUp" | "nextTurn" | "steer";

export type Hold = DeliverAs | "digest";

export type Disposition = Data.TaggedEnum<{
  Inject: { readonly hold: Hold };
  Settle: Record<never, never>;
}>;

export const Dispositions = Data.taggedEnum<Disposition>();

export const verdictToHold = (verdict: Verdict): Disposition =>
  Verdicts.$match(verdict, {
    Later: () => Dispositions.Inject({ hold: "digest" }),
    Never: () => Dispositions.Settle(),
    Next: () => Dispositions.Inject({ hold: "nextTurn" }),
    Now: () => Dispositions.Inject({ hold: "steer" }),
  });

export interface DeliveryHost<A> {
  readonly inject: (hold: Hold) => A;
  readonly settle: () => A;
}

export const applyDelivery = <A>(
  decision: Disposition,
  host: DeliveryHost<A>
): A => {
  if (Dispositions.$is("Inject")(decision)) {
    return host.inject(decision.hold);
  }

  return host.settle();
};

export type DigestVariant = "cc" | "wake";

export interface PendingMail {
  readonly coalesce?: boolean;
  readonly content: string;
  readonly deliverAs?: Hold;
  readonly details: unknown;
  readonly digestMinutes?: number | undefined;
  readonly notBefore?: number | undefined;
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
  readonly digest: (
    mails: readonly PendingMail[],
    variant?: DigestVariant
  ) => void;
  readonly show: (pending: PendingMail, deliverAs: DeliverAs) => void;
}

const held = (mail: PendingMail) => mail.deliverAs === "digest";

const intervalMs = (mails: readonly PendingMail[]) =>
  Math.min(
    ...mails.map((mail) =>
      mail.notBefore === undefined
        ? (mail.digestMinutes ?? DEFAULT_DIGEST_MINUTES)
        : 0
    )
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
    flushNext: () => {
      const due = [...pending.values()].filter(
        (mail) =>
          mail.deliverAs === "nextTurn" &&
          mail.coalesce === true &&
          !digested.has(mail.id)
      );

      if (due.length === 0) {
        return;
      }

      if (due.length === 1 && due[0] !== undefined) {
        host.show(due[0], "nextTurn");
      } else {
        host.digest(due, "wake");
      }

      for (const mail of due) {
        digested.add(mail.id);
      }
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

      if (
        hold !== "digest" &&
        !(hold === "nextTurn" && mail.coalesce === true)
      ) {
        host.show(mail, hold);
      }
    },
    tick: (now: number) => {
      const due = [...pending.values()].filter(
        (mail) =>
          held(mail) &&
          !digested.has(mail.id) &&
          (mail.notBefore === undefined || now >= mail.notBefore)
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
