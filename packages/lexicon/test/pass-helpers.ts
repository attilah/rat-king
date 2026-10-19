import { Effect, Schema } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

import { signingKey } from "../adapters/pass-webcrypto.ts";
import { refusal } from "../pass-failure.ts";
import { decodeDidKey, signTicket, signPass } from "../passes.ts";
import * as Pass from "../src/edge.pass.ts";
import * as Ticket from "../src/edge.ticket.ts";
import { fingerprintBytes, PublicKey, Signatures } from "../trust.ts";

const failed = () =>
  refusal(
    "Test failed",
    "cryptographic fixture failed",
    "check the WebCrypto runtime"
  );

export const didForBytes = (bytes: Uint8Array) => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let value = BigInt(
    `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  );

  let result = "";

  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }

  return `did:key:z${result}`;
};

export const keypair = Effect.gen(function* makeKeypair() {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };

  const keys = yield* Effect.tryPromise({
    catch: failed,
    try: crypto.subtle.generateKey.bind(crypto.subtle, algorithm, true, [
      "sign",
      "verify",
    ]),
  });

  if (!("publicKey" in keys)) {
    return yield* failed();
  }

  const exported = yield* Effect.tryPromise({
    catch: failed,
    try: crypto.subtle.exportKey.bind(crypto.subtle, "raw", keys.publicKey),
  });

  const raw = new Uint8Array(
    yield* Schema.decodeUnknownEffect(Schema.instanceOf(ArrayBuffer))(exported)
  );

  const publicKey = yield* Schema.decodeUnknownEffect(PublicKey)({
    crv: "P-256",
    kty: "EC",
    x: Base64Url.encode(raw.slice(1, 33)),
    y: Base64Url.encode(raw.slice(33)),
  });

  const compressed = Uint8Array.from([
    0x80,
    0x24,
    2 + ((raw.at(-1) ?? 0) % 2),
    ...raw.slice(1, 33),
  ]);

  const did = didForBytes(compressed);
  const decoded = yield* decodeDidKey(did);

  return {
    decoded,
    did,
    publicKey,
    signer: signingKey(publicKey, keys.privateKey),
  };
});

export const Variation = Schema.Struct({
  credential: Schema.Int.check(
    Schema.isBetween({ maximum: 999_999, minimum: 1 })
  ),
  method: Schema.Literals([
    "rk.send.plain",
    "sh.secretcell.fetch",
    "sh.secretcell.describe",
    "sh.secretcell.broker.example",
    "sh.secretcell.broker.github-app",
    "com.example.fetchCredential",
  ]),
  now: Schema.Int.check(
    Schema.isBetween({ maximum: 2_000_000_000, minimum: 1000 })
  ),
  skew: Schema.Int.check(Schema.isBetween({ maximum: 60, minimum: -60 })),
  ttl: Schema.Int.check(Schema.isBetween({ maximum: 600, minimum: 1 })),
  wildcard: Schema.Boolean,
});

export type VariationValue = typeof Variation.Type;

export const fixture = Effect.fn("Test.passFixture")(function* makeFixture(
  input: VariationValue
) {
  const host = yield* keypair;
  const desk = yield* keypair;
  const worker = yield* keypair;
  const crypto = yield* Signatures;
  const prefix = `project${input.credential}`;
  const scope = `${input.method}:${prefix}/${input.wildcard ? "*" : "secret"}`;
  const grantable = new Set([input.method]);
  const issuerScope = [`${input.method}:${prefix}/*`];

  const ticketRecord = yield* Schema.decodeUnknownEffect(Ticket.Main)({
    $type: "sh.ratking.ticket",
    did: input.wildcard
      ? `did:web:desk${input.credential}.example.invalid`
      : desk.did,
    exp: input.now + 900,
    fingerprint: yield* crypto.digest(fingerprintBytes(desk.publicKey)),
    iat: input.now,
    issuer: "issuer.example.invalid",
    name: `${prefix}/desk`,
    namespace: `${prefix}/`,
  });

  const passRecord = yield* Schema.decodeUnknownEffect(Pass.Main)({
    $type: "sh.ratking.pass",
    desk: ticketRecord.name,
    deskDid: ticketRecord.did,
    exp: input.now + input.ttl,
    iat: input.now,
    nonce: `nonce-${input.credential}`,
    run: `run-${input.credential}`,
    scope: [scope],
    v: 1,
    worker: worker.did,
  });

  const ticket = input.wildcard
    ? yield* signTicket(host.signer, ticketRecord, desk.publicKey)
    : yield* signTicket(host.signer, ticketRecord);

  const pass = yield* signPass(desk.signer, passRecord);

  const pins = new Map([
    [
      ticketRecord.issuer,
      { key: host.publicKey, namespaces: [ticketRecord.namespace] },
    ],
  ]);

  return {
    authority: { grantable, issuerScope, pinnedIssuers: pins, ticket },
    desk,
    host,
    known: {
      grantable,
      issuerScope,
      knownDesk: {
        did: ticketRecord.did,
        key: desk.publicKey,
        name: ticketRecord.name,
      },
    },
    pass,
    pins,
    ticket,
    worker,
  };
});
