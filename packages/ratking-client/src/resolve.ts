import { Document } from "@rat-king/mailbox-client";
import type { PeerDocument } from "@rat-king/mailbox-client";
import { Effect, Option, Schema } from "effect";

import { AgentName, canonicalName, didFor } from "./name.ts";
import type { ReservedValue } from "./name.ts";

export type UnresolvedReason =
  | "unknown-name"
  | "refresh-failed"
  | "invalid-document"
  | "did-mismatch";

export interface Resolution {
  readonly did: string;
  readonly document: PeerDocument;
}

export interface ResolveOptions<E, R> {
  readonly didTemplate: string;
  readonly reserved: ReservedValue;
  readonly resolveLocal: (
    name: string
  ) => Effect.Effect<
    { readonly did: string; readonly document: unknown },
    E,
    R
  >;
  readonly refresh: (
    did: string
  ) => Effect.Effect<unknown, UnresolvedReason, R>;
}

const validate = Effect.fn("RatKing.validateResolution")(function* validate(
  did: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This decoder is the untrusted public-document boundary for both resolution sources.
  value: unknown
) {
  const document = yield* Schema.decodeUnknownEffect(Document)(value).pipe(
    Effect.mapError((): UnresolvedReason => "invalid-document")
  );

  if (document.id !== did) {
    return yield* Effect.fail<UnresolvedReason>("did-mismatch");
  }

  return { did, document };
});

export const resolveName = Effect.fn("RatKing.resolveName")(
  function* resolveName<E, R>(
    requested: string,
    options: ResolveOptions<E, R>
  ) {
    const name = canonicalName(options.reserved, requested);

    if (!Schema.is(AgentName)(name)) {
      return yield* Effect.fail<UnresolvedReason>("unknown-name");
    }

    const local = yield* options.resolveLocal(name).pipe(Effect.option);

    if (Option.isSome(local)) {
      return yield* validate(local.value.did, local.value.document);
    }

    const did = didFor(options.didTemplate, options.reserved, name);
    const document = yield* options.refresh(did);

    return yield* validate(did, document);
  }
);
