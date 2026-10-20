import { encode } from "@ipld/dag-cbor";
import { Effect, Schema } from "effect";

import { decodeDidKey } from "./did-key.ts";
import { NonceBinding } from "./pass-bindings.ts";
import { refusal } from "./pass-failure.ts";
import { grantableScope, scopeWithin } from "./pass-scope.ts";
import * as Pass from "./src/edge.pass.ts";
import * as Ticket from "./src/edge.ticket.ts";
import type { LexValue } from "./src/runtime.ts";
import type { Issuer } from "./trust-authority.ts";
import type { TrustFailure } from "./trust-failure.ts";
import { Signatures } from "./trust-signatures.ts";
import { fingerprintBytes, PublicKey } from "./trust.ts";
import type { PublicKeyValue } from "./trust.ts";

export { decodeDidKey, encodeDidKey } from "./did-key.ts";

export {
  makeMemoryNonceBinding,
  makeMemoryRunBinding,
  NonceBinding,
  RunBinding,
} from "./pass-bindings.ts";

export type { NonceIdentity, RunToken } from "./pass-bindings.ts";

export { scopeWithin } from "./pass-scope.ts";

export type TicketValue = typeof Ticket.Main.Type;

export type PassValue = typeof Pass.Main.Type;

export interface SigningKey {
  readonly publicKey: PublicKeyValue;
  readonly sign: (bytes: Uint8Array) => Effect.Effect<string, TrustFailure>;
}

const signature = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{86}$/u));

export const SignedTicket = Schema.Struct({
  publicKey: PublicKey,
  record: Ticket.Main,
  signature,
});

export const SignedPass = Schema.Struct({ record: Pass.Main, signature });

const decode = <A, I>(schema: Schema.Codec<A, I>, input: LexValue) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() =>
      refusal(
        "Record refused",
        "record does not match its schema",
        "provide a valid signed ticket or pass"
      )
    )
  );

const bytes = (record: LexValue) =>
  Effect.try({
    catch: () =>
      refusal(
        "Record refused",
        "record cannot be encoded as DAG-CBOR",
        "provide a canonical lexicon record"
      ),
    try: () => encode({ domain: "sh.ratking.delegation.v1", record }),
  });

const lifetime = (iat: number, exp: number, now: number, cap: number) => {
  if (
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(exp) ||
    !Number.isFinite(now) ||
    exp <= iat ||
    exp - iat > cap ||
    now < iat - 60 ||
    now > exp + 60
  ) {
    return Effect.fail(
      refusal(
        "Lifetime refused",
        "record is outside its lifetime or exceeds its cap",
        "obtain a fresh short-lived ticket or pass"
      )
    );
  }

  return Effect.void;
};

const verify = Effect.fn("Passes.verifySignature")(function* verifySignature(
  key: PublicKeyValue,
  record: LexValue,
  signed: string
) {
  const crypto = yield* Signatures;

  if (!(yield* crypto.verify(key, yield* bytes(record), signed))) {
    return yield* refusal(
      "Signature refused",
      "signature does not match the authorized key",
      "sign with the correct issuer or desk key"
    );
  }

  return yield* Effect.void;
});

const cryptoErrors = <A, R>(effect: Effect.Effect<A, TrustFailure, R>) =>
  effect.pipe(
    Effect.mapError((failure) =>
      failure.reason.split(";").length === 3
        ? failure
        : refusal(
            "Cryptography refused",
            "key or signature operation failed",
            "check the P-256 key and signed bytes"
          )
    )
  );

export const signTicket = Effect.fn("Passes.signTicket")(
  function* signTicketRecord(
    issuerKey: SigningKey,
    input: LexValue,
    deskKey?: PublicKeyValue
  ) {
    const record = yield* decode(Ticket.Main, input);

    const publicKey =
      deskKey === undefined
        ? yield* decodeDidKey(record.did)
        : yield* decode(PublicKey, deskKey);

    return {
      publicKey,
      record,
      signature: yield* issuerKey.sign(yield* bytes(record)),
    };
  },
  cryptoErrors
);

export const signPass = Effect.fn("Passes.signPass")(function* signPassRecord(
  deskKey: SigningKey,
  input: LexValue
) {
  const record = yield* decode(Pass.Main, input);

  return { record, signature: yield* deskKey.sign(yield* bytes(record)) };
}, cryptoErrors);

export const signRequest = (workerKey: SigningKey, request: Uint8Array) =>
  cryptoErrors(workerKey.sign(request));

const checkDidKey = Effect.fn("Passes.checkDidKey")(function* checkDidKey(
  did: string,
  key: PublicKeyValue
) {
  if (
    !/^[AEIMQUYcgkosw048]$/u.test(key.x.slice(-1)) ||
    !/^[AEIMQUYcgkosw048]$/u.test(key.y.slice(-1))
  ) {
    return yield* refusal(
      "Desk refused",
      "public key coordinates are not canonical base64url",
      "use the canonical P-256 public key"
    );
  }

  if (did.startsWith("did:key:")) {
    const decoded = yield* decodeDidKey(did);

    if (decoded.x !== key.x || decoded.y !== key.y) {
      return yield* refusal(
        "Desk refused",
        "public key does not match the desk DID",
        "provide the desk's matching key"
      );
    }
  }

  return yield* Effect.void;
});

export const verifyTicket = Effect.fn("Passes.verifyTicket")(
  function* verifyTicketRecord(
    pinnedIssuers: ReadonlyMap<string, Issuer>,
    input: LexValue,
    now: number
  ) {
    const signed = yield* decode(SignedTicket, input);
    const { record } = signed;
    const issuer = pinnedIssuers.get(record.issuer);

    if (issuer === undefined) {
      return yield* refusal(
        "Ticket refused",
        "issuer is not pinned",
        "obtain a ticket from a trusted host issuer"
      );
    }

    yield* lifetime(record.iat, record.exp, now, 900);

    if (
      !new Set(issuer.namespaces).has(record.namespace) ||
      !record.name.startsWith(
        record.namespace.endsWith("/")
          ? record.namespace
          : `${record.namespace}/`
      )
    ) {
      return yield* refusal(
        "Ticket refused",
        "name is outside the issuer namespaces",
        "request a name within the pinned namespace"
      );
    }

    yield* verify(issuer.key, record, signed.signature);
    const key = signed.publicKey;
    yield* checkDidKey(record.did, key);
    const crypto = yield* Signatures;

    if ((yield* crypto.digest(fingerprintBytes(key))) !== record.fingerprint) {
      return yield* refusal(
        "Ticket refused",
        "fingerprint does not match the desk DID",
        "issue a ticket for the desk's actual public key"
      );
    }

    return { key, record };
  },
  cryptoErrors
);

export interface KnownDesk {
  readonly did: string;
  readonly key: PublicKeyValue;
  readonly name: string;
}

export type DeskAuthority =
  | { readonly knownDesk: KnownDesk }
  | {
      readonly pinnedIssuers: ReadonlyMap<string, Issuer>;
      readonly ticket: LexValue;
    };

export type PassAuthority = DeskAuthority & {
  readonly grantable: ReadonlySet<string>;
  readonly issuerScope: readonly string[];
};

const verified = Symbol("VerifiedPass");

export interface VerifiedPass {
  readonly [verified]: true;
  readonly record: PassValue;
  readonly workerKey: PublicKeyValue;
}

const deskAuthority = Effect.fn("Passes.deskAuthority")(function* resolveDesk(
  authority: DeskAuthority,
  now: number
) {
  if ("ticket" in authority) {
    const ticket = yield* verifyTicket(
      authority.pinnedIssuers,
      authority.ticket,
      now
    );

    return {
      did: ticket.record.did,
      key: ticket.key,
      name: ticket.record.name,
    };
  }

  const { knownDesk } = authority;
  const key = yield* decode(PublicKey, knownDesk.key);
  yield* checkDidKey(knownDesk.did, key);

  return { ...knownDesk, key };
});

export const verifyPass = Effect.fn("Passes.verifyPass")(
  function* verifyPassRecord(
    authority: PassAuthority,
    input: LexValue,
    now: number
  ): Effect.fn.Return<VerifiedPass, TrustFailure, Signatures | NonceBinding> {
    const signed = yield* decode(SignedPass, input);
    const { record } = signed;
    const desk = yield* deskAuthority(authority, now);
    yield* lifetime(record.iat, record.exp, now, 600);

    if (
      record.desk !== desk.name ||
      record.deskDid !== desk.did ||
      record.worker === record.deskDid
    ) {
      return yield* refusal(
        "Pass refused",
        "desk binding is wrong or the worker borrowed the desk key",
        "issue a pass for a separate worker key from the correct desk"
      );
    }

    const workerKey = yield* decodeDidKey(record.worker);

    if (workerKey.x === desk.key.x && workerKey.y === desk.key.y) {
      return yield* refusal(
        "Pass refused",
        "worker key is the desk key under another DID",
        "generate a separate throwaway worker key"
      );
    }

    yield* grantableScope(record.scope, authority.grantable);
    yield* scopeWithin(record.scope, authority.issuerScope);
    yield* verify(desk.key, record, signed.signature);
    const crypto = yield* Signatures;
    const nonces = yield* NonceBinding;

    const result = yield* nonces.bind(
      record.deskDid,
      record.nonce,
      {
        run: record.run,
        workerThumbprint: yield* crypto.digest(fingerprintBytes(workerKey)),
      },
      record.exp + 60
    );

    if (result === "conflict") {
      return yield* refusal(
        "Pass refused",
        "nonce is already bound to a different worker or run",
        "request a fresh nonce from the desk"
      );
    }

    return Object.freeze({
      [verified]: true as const,
      record: Object.freeze({
        ...record,
        scope: Object.freeze([...record.scope]),
      }),
      workerKey: Object.freeze(workerKey),
    });
  },
  cryptoErrors
);

export const verifyRequest = Effect.fn("Passes.verifyRequest")(
  function* verifyWorkerRequest(
    pass: VerifiedPass,
    request: Uint8Array,
    signed: string
  ) {
    const crypto = yield* Signatures;

    if (
      !pass[verified] ||
      !(yield* crypto.verify(pass.workerKey, request, signed))
    ) {
      return yield* refusal(
        "Request refused",
        "signature is not from the verified worker key",
        "sign the request with the worker's private key"
      );
    }

    return yield* Effect.void;
  },
  cryptoErrors
);
