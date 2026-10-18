// packages/envelope/src/envelope.ts
import { Aes128Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";

// packages/lexicon/src/defs.ts
import { Schema as Schema2 } from "effect";

// packages/lexicon/src/runtime.ts
import { isCid, parseCid, parseCidSafe } from "@atproto/lex-data";
import { Lexicons } from "@atproto/lexicon";
import { Schema, SchemaGetter } from "effect";
var Cid = Schema.declare(
  (value) => isCid(value, { flavor: "dasl" })
);
var CidText = Schema.String.check(
  Schema.makeFilter(
    (value) => parseCidSafe(value, { flavor: "dasl" }) !== null,
    { expected: "CIDv1, raw or DAG-CBOR, SHA-256" }
  )
);
var Link = Schema.StructWithRest(Schema.Struct({ $link: CidText }), [
  Schema.Record(Schema.String, Schema.String)
]).check(
  Schema.makeFilter((value) => Object.keys(value).length === 1, {
    expected: "one link wrapper key"
  })
).pipe(
  Schema.decodeTo(Cid, {
    decode: SchemaGetter.transform(
      (value) => parseCid(value.$link, { flavor: "dasl" })
    ),
    encode: SchemaGetter.transform((value) => ({ $link: value.toString() }))
  })
);
var Bytes = Schema.StructWithRest(
  Schema.Struct({ $bytes: Schema.String }),
  [Schema.Record(Schema.String, Schema.String)]
).check(
  Schema.makeFilter((value) => Object.keys(value).length === 1, {
    expected: "one byte wrapper key"
  })
).pipe(Schema.decodeTo(Schema.Struct({ $bytes: Schema.Uint8ArrayFromBase64 }))).pipe(
  Schema.decodeTo(Schema.Uint8Array, {
    decode: SchemaGetter.transform((value) => value.$bytes),
    encode: SchemaGetter.transform((value) => ({ $bytes: value }))
  })
);
var Data = Schema.suspend(
  () => Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Int,
    Schema.String,
    Bytes,
    Link,
    Schema.Array(Data),
    Schema.Record(Schema.String, Data).check(
      Schema.makeFilter(
        (value) => !("$bytes" in value) && !("$link" in value),
        { expected: "data map, not a malformed byte or link wrapper" }
      )
    )
  ])
);
var DataMap = Schema.Record(Schema.String, Data).check(
  Schema.makeFilter((value) => !("$bytes" in value) && !("$link" in value), {
    expected: "data-model map"
  })
);
var TaggedMap = Schema.StructWithRest(
  Schema.Struct({ $type: Schema.String }),
  [Schema.Record(Schema.String, Data)]
);
var lexString = (definition) => {
  const validators = new Lexicons([
    {
      defs: {
        main: {
          properties: { value: definition },
          required: ["value"],
          type: "object"
        }
      },
      id: "sh.mschf.ratking.lexgen",
      lexicon: 1
    }
  ]);
  return Schema.String.check(
    Schema.makeFilter(
      (value) => validators.validate("sh.mschf.ratking.lexgen", { value }).success,
      { expected: "Lexicon string constraints" }
    )
  );
};
var Blob = Schema.StructWithRest(
  Schema.Struct({
    $type: Schema.Literal("blob"),
    mimeType: Schema.String,
    ref: Link,
    size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  }),
  [Schema.Record(Schema.String, Data)]
);
var XrpcErrorBody = Schema.StructWithRest(
  Schema.Struct({
    error: Schema.String,
    message: Schema.optionalKey(Schema.String)
  }),
  [Schema.Record(Schema.String, Data)]
);

// packages/lexicon/src/defs.ts
var Aad = Schema2.StructWithRest(
  Schema2.Struct({
    expiresAt: Schema2.optionalKey(
      lexString({
        description: "Absent means no expiry; never infer expiry from the TID.",
        format: "datetime",
        type: "string"
      }).pipe(Schema2.brand("Lexicon:datetime"))
    ),
    messageId: lexString({
      description: "Sender DID plus TID is the immutable idempotency key.",
      format: "tid",
      type: "string"
    }).pipe(Schema2.brand("Lexicon:tid")),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema2.brand("Lexicon:did")
    ),
    recipientKeyId: lexString({
      description: "DID URL of recipient's keyAgreement key; checked against recipientDid.",
      format: "uri",
      type: "string"
    }).pipe(Schema2.brand("Lexicon:uri")),
    senderDid: lexString({ format: "did", type: "string" }).pipe(
      Schema2.brand("Lexicon:did")
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var AppSignature = Schema2.StructWithRest(
  Schema2.Struct({
    algorithm: lexString({
      knownValues: ["ES256", "ES256K"],
      type: "string"
    }),
    keyId: lexString({
      description: "DID URL of sender's authorized signing key at send time.",
      format: "uri",
      type: "string"
    }).pipe(Schema2.brand("Lexicon:uri")),
    publicKeyMultibase: Schema2.optionalKey(
      lexString({
        description: "Optional historical key hint, never authority without verified key history.",
        type: "string"
      })
    ),
    signature: Bytes.check(
      Schema2.makeFilter(
        (value) => value.length >= 0 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var BirthContext = Schema2.StructWithRest(
  Schema2.Struct({
    createdAt: Schema2.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema2.brand("Lexicon:datetime")
      )
    ),
    operator: lexString({
      description: "Public operator namespace label, not a private person name.",
      type: "string"
    }),
    project: lexString({
      description: "Public project namespace at birth, not the current assignment.",
      type: "string"
    })
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var DeliveryState = lexString({
  description: "Open values: accepted = durable admission; queued = awaiting runtime; delivered = injected into leased runtime, not processed; acked = recipient acknowledgment; expired = sender-set expiry reached; failed = terminal failure with a receipt. Unknown values are not success.",
  knownValues: [
    "accepted",
    "queued",
    "delivered",
    "acked",
    "expired",
    "failed"
  ],
  type: "string"
});
var PublicJwk = Schema2.StructWithRest(
  Schema2.Struct({
    crv: lexString({ const: "P-256", type: "string" }).pipe(
      Schema2.decodeTo(Schema2.Literal("P-256"))
    ),
    kty: lexString({ const: "EC", type: "string" }).pipe(
      Schema2.decodeTo(Schema2.Literal("EC"))
    ),
    x: lexString({ type: "string" }),
    y: lexString({ type: "string" })
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var DidVerificationMethod = Schema2.StructWithRest(
  Schema2.Struct({
    controller: lexString({ type: "string" }),
    id: lexString({ type: "string" }),
    publicKeyJwk: PublicJwk
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var DidDocument = Schema2.StructWithRest(
  Schema2.Struct({
    authentication: Schema2.Array(lexString({ type: "string" })).check(
      Schema2.isMinLength(0),
      Schema2.isMaxLength(9007199254740991)
    ),
    id: lexString({ format: "did", type: "string" }).pipe(
      Schema2.brand("Lexicon:did")
    ),
    keyAgreement: Schema2.Array(lexString({ type: "string" })).check(
      Schema2.isMinLength(0),
      Schema2.isMaxLength(9007199254740991)
    ),
    verificationMethod: Schema2.Array(DidVerificationMethod).check(
      Schema2.isMinLength(0),
      Schema2.isMaxLength(9007199254740991)
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var HpkeSuite = Schema2.StructWithRest(
  Schema2.Struct({
    aeadId: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(0),
      Schema2.isLessThanOrEqualTo(65535)
    ),
    kdfId: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(0),
      Schema2.isLessThanOrEqualTo(65535)
    ),
    kemId: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(0),
      Schema2.isLessThanOrEqualTo(65535)
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var EncryptedEnvelope = Schema2.StructWithRest(
  Schema2.Struct({
    aad: Aad,
    ciphertext: Bytes.check(
      Schema2.makeFilter(
        (value) => value.length >= 1 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    ),
    enc: Bytes.check(
      Schema2.makeFilter(
        (value) => value.length >= 1 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    ),
    suite: HpkeSuite,
    version: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(1),
      Schema2.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var MessageRef = Schema2.StructWithRest(
  Schema2.Struct({
    cid: Schema2.optionalKey(
      lexString({
        description: "Optional CID of that exact persisted record, not a hash of JSON.",
        format: "cid",
        type: "string"
      }).pipe(Schema2.brand("Lexicon:cid"))
    ),
    messageId: lexString({ format: "tid", type: "string" }).pipe(
      Schema2.brand("Lexicon:tid")
    ),
    senderDid: lexString({ format: "did", type: "string" }).pipe(
      Schema2.brand("Lexicon:did")
    ),
    uri: Schema2.optionalKey(
      lexString({
        description: "Optional actual persisted record URI; never fabricate a phase-0 record locator.",
        format: "at-uri",
        type: "string"
      }).pipe(Schema2.brand("Lexicon:at-uri"))
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var Receipt = Schema2.StructWithRest(
  Schema2.Struct({
    detail: Schema2.optionalKey(
      lexString({
        description: "Optional public-safe failure or expiry explanation.",
        type: "string"
      })
    ),
    message: MessageRef,
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema2.brand("Lexicon:did")
    ),
    recordedAt: Schema2.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema2.brand("Lexicon:datetime")
      )
    ),
    seq: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(1),
      Schema2.isLessThanOrEqualTo(9007199254740991)
    ),
    state: DeliveryState,
    wakeReason: Schema2.optionalKey(lexString({ type: "string" })),
    woke: Schema2.optionalKey(Schema2.Boolean)
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var MessageEvent = Schema2.StructWithRest(
  Schema2.Struct({
    envelope: EncryptedEnvelope,
    receipt: Receipt,
    seq: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(1),
      Schema2.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var ReceiptEvent = Schema2.StructWithRest(
  Schema2.Struct({
    receipt: Receipt,
    seq: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(1),
      Schema2.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var SignedMessage = Schema2.StructWithRest(
  Schema2.Struct({
    appSignature: AppSignature,
    canonicalSigningBytes: Bytes.check(
      Schema2.makeFilter(
        (value) => value.length >= 0 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);
var SigningPayload = Schema2.StructWithRest(
  Schema2.Struct({
    aad: Aad,
    body: Bytes.check(
      Schema2.makeFilter(
        (value) => value.length >= 0 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    ),
    createdAt: Schema2.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema2.brand("Lexicon:datetime")
      )
    ),
    replyTo: Schema2.optionalKey(MessageRef),
    suite: HpkeSuite,
    urgent: Schema2.optionalKey(Schema2.Literal(true)),
    version: Schema2.Int.check(
      Schema2.isGreaterThanOrEqualTo(1),
      Schema2.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema2.Record(Schema2.String, Data)]
);

// packages/envelope/src/envelope.ts
import { Effect as Effect5, Schema as Schema6 } from "effect";

// packages/envelope/src/canonical.ts
import { decode, encode } from "@ipld/dag-cbor";
import { Effect, Schema as Schema4 } from "effect";

// packages/envelope/src/bytes.ts
var concatenate = (...parts) => {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

// packages/envelope/src/failure.ts
import { Schema as Schema3 } from "effect";
var EnvelopeFailure = class extends Schema3.TaggedError()(
  "EnvelopeFailure",
  { reason: Schema3.String }
) {
};

// packages/envelope/src/canonical.ts
var suite = Object.freeze({ aeadId: 1, kdfId: 1, kemId: 16 });
var plaintextSuite = Object.freeze({
  aeadId: 0,
  kdfId: 0,
  kemId: 0
});
var plaintextEnc = () => Uint8Array.of(0);
var signatureDomain = new TextEncoder().encode(
  "sh.mschf.ratking.signature.v1\0"
);
var aadDomain = new TextEncoder().encode("sh.mschf.ratking.aad.v1\0");
var equalBytes = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);
var canonical = (value) => encode(value);
var canonicalDecode = Effect.fn("Envelope.canonicalDecode")(
  function* canonicalDecode2(bytes) {
    const value = yield* Effect.try({
      catch: () => new EnvelopeFailure({ reason: "Invalid CBOR" }),
      try: () => decode(bytes)
    });
    const parsed = yield* Schema4.decodeUnknownEffect(
      Schema4.toType(Data)
    )(value).pipe(
      Effect.mapError(
        () => new EnvelopeFailure({ reason: "Invalid data model" })
      )
    );
    if (!equalBytes(bytes, canonical(parsed))) {
      return yield* Effect.fail(
        new EnvelopeFailure({ reason: "Noncanonical CBOR" })
      );
    }
    return parsed;
  }
);
var signingBytes = (payload) => concatenate(signatureDomain, canonical(payload));
var aadBytes = (envelope) => concatenate(
  aadDomain,
  canonical({
    aad: envelope.aad,
    enc: envelope.enc,
    suite: envelope.suite,
    version: envelope.version
  })
);
var plaintext = (envelope) => envelope.version === 1 && equalBytes(canonical(envelope.suite), canonical(plaintextSuite));
var supported = (envelope) => plaintext(envelope) || envelope.version === 1 && equalBytes(canonical(envelope.suite), canonical(suite));

// packages/envelope/src/es256.ts
import { Effect as Effect3 } from "effect";

// packages/envelope/src/webcrypto.ts
import { Effect as Effect2 } from "effect";
var cryptoOperation = (operation) => Effect2.tryPromise({
  catch: () => new EnvelopeFailure({ reason: "Cryptographic operation rejected" }),
  try: operation
});

// packages/envelope/src/es256.ts
var p256Order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
var scalar = (bytes) => BigInt(
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
);
var scalarBytes = (value) => Uint8Array.from(
  value.toString(16).padStart(64, "0").match(/../gu) ?? [],
  (pair) => Number.parseInt(pair, 16)
);
var normalizeSignature = (signature) => {
  if (signature.length !== 64) {
    throw new EnvelopeFailure({ reason: "ES256 requires 64 bytes" });
  }
  const s = scalar(signature.subarray(32));
  return concatenate(
    signature.subarray(0, 32),
    scalarBytes(s > p256Order / 2n ? p256Order - s : s)
  );
};
var lowS = (signature) => signature.length === 64 && scalar(signature.subarray(0, 32)) > 0n && scalar(signature.subarray(0, 32)) < p256Order && scalar(signature.subarray(32)) > 0n && scalar(signature.subarray(32)) <= p256Order / 2n;
var sign = Effect3.fn("Envelope.sign")(function* sign2(key, bytes) {
  const signature = yield* cryptoOperation(
    () => crypto.subtle.sign(
      { hash: "SHA-256", name: "ECDSA" },
      key,
      new Uint8Array(bytes)
    )
  );
  return normalizeSignature(new Uint8Array(signature));
});
var verify = Effect3.fn("Envelope.verify")(function* verify2(key, bytes, signature) {
  if (!lowS(signature)) {
    return false;
  }
  return yield* cryptoOperation(
    () => crypto.subtle.verify(
      { hash: "SHA-256", name: "ECDSA" },
      key,
      new Uint8Array(signature),
      new Uint8Array(bytes)
    )
  );
});

// packages/envelope/src/hpke-p256.ts
import { DhkemP256HkdfSha256 } from "@hpke/core";
var spkiPrefix = Uint8Array.from([
  48,
  89,
  48,
  19,
  6,
  7,
  42,
  134,
  72,
  206,
  61,
  2,
  1,
  6,
  8,
  42,
  134,
  72,
  206,
  61,
  3,
  1,
  7,
  3,
  66,
  0
]);
var p256PublicPoint = (raw) => {
  const bytes = new Uint8Array(raw);
  if (bytes.length === 65 && bytes[0] === 4) {
    return raw;
  }
  if (bytes.length === 91 && spkiPrefix.every((byte, index) => bytes[index] === byte) && bytes[26] === 4) {
    return raw.slice(26);
  }
  throw new EnvelopeFailure({ reason: "Invalid raw P-256 public key export" });
};
var p256Prime = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
var p256B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
var coordinate = (bytes) => bytes.reduce((value, byte) => value * 256n + BigInt(byte), 0n);
var base64url = (bytes) => btoa(String.fromCodePoint(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
var p256PublicJwk = (raw) => {
  const bytes = ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : new Uint8Array(raw);
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new EnvelopeFailure({ reason: "Invalid SEC1 P-256 public key" });
  }
  const xBytes = bytes.subarray(1, 33);
  const yBytes = bytes.subarray(33);
  const x = coordinate(xBytes);
  const y = coordinate(yBytes);
  const rhs = ((x * x * x - 3n * x + p256B) % p256Prime + p256Prime) % p256Prime;
  if (x >= p256Prime || y >= p256Prime || y * y % p256Prime !== rhs) {
    throw new EnvelopeFailure({ reason: "Off-curve P-256 public key" });
  }
  return {
    crv: "P-256",
    kty: "EC",
    x: base64url(xBytes),
    y: base64url(yBytes)
  };
};
var CompatibleP256Kem = class extends DhkemP256HkdfSha256 {
  constructor() {
    super();
    const serialize = this._prim.serializePublicKey.bind(this._prim);
    this._prim.deserializePublicKey = async (raw) => await this._prim.importKey("jwk", p256PublicJwk(raw), true);
    this._prim.serializePublicKey = async (key) => {
      const raw = await serialize(key);
      if (key.type === "public" && "namedCurve" in key.algorithm && key.algorithm.namedCurve === "P-256") {
        return p256PublicPoint(raw);
      }
      return raw;
    };
  }
};

// packages/envelope/src/signed.ts
import { Effect as Effect4, Schema as Schema5 } from "effect";
var decodeSigned = Effect4.fn("Envelope.decodeSigned")(function* decodeSigned2(signedBytes) {
  const signed = yield* Schema5.decodeUnknownEffect(
    Schema5.toType(SignedMessage)
  )(yield* canonicalDecode(signedBytes));
  const bytes = signed.canonicalSigningBytes;
  if (!equalBytes(bytes.subarray(0, signatureDomain.length), signatureDomain)) {
    return yield* Effect4.fail(
      new EnvelopeFailure({ reason: "Wrong signature domain" })
    );
  }
  const payload = yield* Schema5.decodeUnknownEffect(
    Schema5.toType(SigningPayload)
  )(yield* canonicalDecode(bytes.subarray(signatureDomain.length)));
  return { bytes, payload, signed };
});
var verifySigned = Effect4.fn("Envelope.verifySigned")(
  function* verifySigned2(envelope, signedBytes, resolveSigningKey) {
    const { bytes, payload, signed } = yield* decodeSigned(signedBytes);
    if (!equalBytes(
      canonical({
        aad: payload.aad,
        suite: payload.suite,
        version: payload.version
      }),
      canonical({
        aad: envelope.aad,
        suite: envelope.suite,
        version: envelope.version
      })
    )) {
      return yield* Effect4.fail(
        new EnvelopeFailure({ reason: "Inner metadata mismatch" })
      );
    }
    const app = signed.appSignature;
    if (app.algorithm !== "ES256" || !app.keyId.startsWith(`${envelope.aad.senderDid}#`)) {
      return yield* Effect4.fail(
        new EnvelopeFailure({ reason: "Unauthorized signing key" })
      );
    }
    const key = yield* resolveSigningKey(envelope.aad.senderDid, app.keyId);
    if (!(yield* verify(key, bytes, app.signature))) {
      return yield* Effect4.fail(
        new EnvelopeFailure({ reason: "Invalid application signature" })
      );
    }
    return payload;
  }
);
var openPlaintext = Effect4.fn("Envelope.openPlaintext")(
  function* openPlaintext2(envelope, resolveSigningKey) {
    if (!plaintext(envelope) || !equalBytes(envelope.enc, plaintextEnc())) {
      return yield* Effect4.fail(
        new EnvelopeFailure({ reason: "Not a signed plaintext envelope" })
      );
    }
    return yield* verifySigned(
      envelope,
      envelope.ciphertext,
      resolveSigningKey
    );
  }
);
var plaintextBody = Effect4.fn("Envelope.plaintextBody")(
  function* plaintextBody2(envelope) {
    if (!plaintext(envelope)) {
      return yield* Effect4.fail(
        new EnvelopeFailure({ reason: "Not a signed plaintext envelope" })
      );
    }
    const { payload } = yield* decodeSigned(envelope.ciphertext);
    return yield* Effect4.try({
      catch: () => new EnvelopeFailure({ reason: "Invalid UTF-8 body" }),
      try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        payload.body
      )
    });
  }
);

// packages/envelope/src/envelope.ts
var hpke = new CipherSuite({
  aead: new Aes128Gcm(),
  kdf: new HkdfSha256(),
  kem: new CompatibleP256Kem()
});
var info = new TextEncoder().encode("sh.mschf.ratking.hpke.v1");
var seal = Effect5.fn("Envelope.seal")(function* seal2(request) {
  const { payload } = request;
  if (!supported(payload) || request.recipientKeyId !== payload.aad.recipientKeyId || !request.recipientKeyId.startsWith(`${payload.aad.recipientDid}#`) || !request.signingKeyId.startsWith(`${payload.aad.senderDid}#`)) {
    return yield* Effect5.fail(
      new EnvelopeFailure({
        reason: "Unsupported envelope or unauthorized key id"
      })
    );
  }
  const validated = yield* Schema6.decodeUnknownEffect(
    Schema6.toType(SigningPayload)
  )(payload);
  const bytes = signingBytes(validated);
  const signature = yield* sign(request.signingKey, bytes);
  const signed = yield* Schema6.decodeUnknownEffect(
    Schema6.toType(SignedMessage)
  )({
    appSignature: {
      algorithm: "ES256",
      keyId: request.signingKeyId,
      signature
    },
    canonicalSigningBytes: bytes
  });
  if (plaintext(payload)) {
    return yield* Schema6.decodeUnknownEffect(
      Schema6.toType(EncryptedEnvelope)
    )({
      aad: payload.aad,
      ciphertext: canonical(signed),
      enc: plaintextEnc(),
      suite: payload.suite,
      version: payload.version
    });
  }
  const context = yield* cryptoOperation(
    () => hpke.createSenderContext({ info, recipientPublicKey: request.recipientKey })
  );
  const header = {
    aad: payload.aad,
    enc: new Uint8Array(context.enc),
    suite: payload.suite,
    version: payload.version
  };
  const ciphertext = yield* cryptoOperation(
    () => context.seal(canonical(signed), aadBytes(header))
  );
  return yield* Schema6.decodeUnknownEffect(
    Schema6.toType(EncryptedEnvelope)
  )({ ...header, ciphertext: new Uint8Array(ciphertext) });
});
var open = Effect5.fn("Envelope.open")(function* open2(request) {
  const envelope = yield* Schema6.decodeUnknownEffect(
    Schema6.toType(EncryptedEnvelope)
  )(request.envelope);
  if (!supported(envelope) || envelope.aad.recipientDid !== request.recipientDid || envelope.aad.recipientKeyId !== request.recipientKeyId || !request.recipientKeyId.startsWith(`${request.recipientDid}#`)) {
    return yield* Effect5.fail(
      new EnvelopeFailure({ reason: "Unsupported envelope or wrong recipient" })
    );
  }
  if (plaintext(envelope)) {
    return yield* openPlaintext(envelope, request.resolveSigningKey);
  }
  const context = yield* cryptoOperation(
    () => hpke.createRecipientContext({
      enc: envelope.enc,
      info,
      recipientKey: request.recipientKey
    })
  );
  const opened = yield* cryptoOperation(
    () => context.open(envelope.ciphertext, aadBytes(envelope))
  );
  return yield* verifySigned(
    envelope,
    new Uint8Array(opened),
    request.resolveSigningKey
  );
});

// packages/lexicon/src/admin.putDidDocument.ts
import { Schema as Schema7 } from "effect";
var Params = Schema7.Undefined;
var Input = Schema7.StructWithRest(
  Schema7.Struct({ document: DidDocument }),
  [Schema7.Record(Schema7.String, Data)]
);
var Output = Schema7.StructWithRest(
  Schema7.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema7.brand("Lexicon:did")
    )
  }),
  [Schema7.Record(Schema7.String, Data)]
);
var ErrorBody = XrpcErrorBody;
var Method = {
  defaults: {},
  error: ErrorBody,
  input: Input,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.admin.putDidDocument",
  output: Output,
  outputEncoding: "application/json",
  params: Params,
  path: "/xrpc/sh.mschf.ratking.admin.putDidDocument"
};

// packages/lexicon/src/mailbox-client.ts
import { Context as Context2, Effect as Effect10, Layer, Result, Schema as Schema25 } from "effect";

// packages/lexicon/src/attention.getPreferences.ts
import { Effect as Effect6, Schema as Schema10 } from "effect";

// packages/lexicon/src/attention.prefs.ts
import { Schema as Schema8 } from "effect";
var Name = lexString({
  maxLength: 128,
  minLength: 1,
  type: "string"
}).check(Schema8.isPattern(/^[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*$/u));
var Digest = Schema8.StructWithRest(
  Schema8.Struct({
    minutes: Schema8.Int.check(
      Schema8.isGreaterThanOrEqualTo(1),
      Schema8.isLessThanOrEqualTo(1440)
    ),
    name: Name
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every((key) => ["minutes", "name"].includes(key)),
    { expected: "only allowed keys: minutes, name" }
  )
);
var Group = Schema8.StructWithRest(
  Schema8.Struct({
    group: lexString({ maxLength: 256, minLength: 1, type: "string" })
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every((key) => ["group"].includes(key)),
    { expected: "only allowed keys: group" }
  )
);
var Jev = Schema8.StructWithRest(
  Schema8.Struct({
    judgment: lexString({
      maxLength: 280,
      minLength: 1,
      type: "string"
    }),
    laterBp: Schema8.Int.check(
      Schema8.isGreaterThanOrEqualTo(0),
      Schema8.isLessThanOrEqualTo(1e4)
    ),
    nowBp: Schema8.Int.check(
      Schema8.isGreaterThanOrEqualTo(0),
      Schema8.isLessThanOrEqualTo(1e4)
    )
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every(
      (key) => ["judgment", "laterBp", "nowBp"].includes(key)
    ),
    { expected: "only allowed keys: judgment, laterBp, nowBp" }
  )
);
var Model = Schema8.StructWithRest(
  Schema8.Struct({
    body: lexString({
      enum: ["never", "summary", "full"],
      type: "string"
    }).pipe(Schema8.decodeTo(Schema8.Literals(["never", "summary", "full"]))),
    jev: Schema8.optionalKey(Jev),
    kind: lexString({
      enum: ["none", "jev", "service"],
      type: "string"
    }).pipe(Schema8.decodeTo(Schema8.Literals(["none", "jev", "service"]))),
    service: Schema8.optionalKey(
      lexString({ maxLength: 256, minLength: 1, type: "string" }).check(
        Schema8.isPattern(
          /^(?:did:[a-z]+:[^\s]+|[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*)$/u
        )
      )
    ),
    timeoutMs: Schema8.Int.check(
      Schema8.isGreaterThanOrEqualTo(1),
      Schema8.isLessThanOrEqualTo(6e5)
    )
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every(
      (key) => ["body", "jev", "kind", "service", "timeoutMs"].includes(key)
    ),
    { expected: "only allowed keys: body, jev, kind, service, timeoutMs" }
  )
).check(
  Schema8.makeFilter(
    (value) => value.kind !== "jev" || value.jev !== void 0,
    { expected: "jev: required when kind is jev" }
  )
);
var Match = Schema8.StructWithRest(
  Schema8.Struct({
    from: Schema8.optionalKey(
      lexString({ maxLength: 129, minLength: 1, type: "string" }).check(
        Schema8.isPattern(
          /^(?:[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)*|[a-z][a-z0-9_/-]*\*|\*)$/u
        )
      )
    ),
    project: Schema8.optionalKey(
      lexString({ maxLength: 128, minLength: 1, type: "string" }).check(
        Schema8.isPattern(/^[a-z][a-z0-9_-]*$/u)
      )
    ),
    type: Schema8.optionalKey(
      lexString({ maxLength: 256, minLength: 1, type: "string" })
    )
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every(
      (key) => ["from", "project", "type"].includes(key)
    ),
    { expected: "only allowed keys: from, project, type" }
  )
);
var Rule = Schema8.StructWithRest(
  Schema8.Struct({
    id: lexString({
      maxLength: 64,
      minLength: 1,
      type: "string"
    }).check(Schema8.isPattern(/^[a-zA-Z0-9_-]+$/u)),
    match: Match,
    minutes: Schema8.optionalKey(
      Schema8.Int.check(
        Schema8.isGreaterThanOrEqualTo(1),
        Schema8.isLessThanOrEqualTo(1440)
      )
    ),
    note: Schema8.optionalKey(
      lexString({ maxLength: 280, type: "string" })
    ),
    route: lexString({
      enum: ["wake", "quiet", "digest", "hide"],
      type: "string"
    }).pipe(
      Schema8.decodeTo(Schema8.Literals(["wake", "quiet", "digest", "hide"]))
    ),
    until: Schema8.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema8.brand("Lexicon:datetime")
      )
    )
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every(
      (key) => ["id", "match", "minutes", "note", "route", "until"].includes(key)
    ),
    { expected: "only allowed keys: id, match, minutes, note, route, until" }
  )
).check(
  Schema8.makeFilter(
    (value) => value.route !== "digest" || value.minutes !== void 0,
    { expected: "minutes: required when route is digest" }
  )
).check(
  Schema8.makeFilter(
    (value) => !("minutes" in value) || value.route === "digest",
    { expected: "minutes: allowed only when route is digest" }
  )
);
var Main = Schema8.StructWithRest(
  Schema8.Struct({
    allow: Schema8.Array(Name).check(
      Schema8.isMinLength(0),
      Schema8.isMaxLength(256)
    ),
    digest: Schema8.optionalKey(
      Schema8.Array(Digest).check(Schema8.isMinLength(0), Schema8.isMaxLength(256))
    ),
    forward: Schema8.Array(Name).check(
      Schema8.isMinLength(0),
      Schema8.isMaxLength(256)
    ),
    log: Schema8.Boolean,
    model: Model,
    mute: Schema8.Array(
      Schema8.Union([
        Schema8.StructWithRest(
          Schema8.Struct({
            $type: Schema8.Literal("sh.mschf.ratking.attention.prefs#thread"),
            thread: lexString({
              maxLength: 256,
              minLength: 1,
              type: "string"
            })
          }),
          [Schema8.Record(Schema8.String, Data)]
        ).check(
          Schema8.makeFilter(
            (value) => Object.keys(value).every(
              (key) => ["$type", "thread"].includes(key)
            ),
            { expected: "only allowed keys: $type, thread" }
          )
        ),
        Schema8.StructWithRest(
          Schema8.Struct({
            $type: Schema8.Literal("sh.mschf.ratking.attention.prefs#group"),
            group: lexString({
              maxLength: 256,
              minLength: 1,
              type: "string"
            })
          }),
          [Schema8.Record(Schema8.String, Data)]
        ).check(
          Schema8.makeFilter(
            (value) => Object.keys(value).every(
              (key) => ["$type", "group"].includes(key)
            ),
            { expected: "only allowed keys: $type, group" }
          )
        )
      ])
    ).check(Schema8.isMinLength(0), Schema8.isMaxLength(256)),
    refuse: Schema8.Array(Name).check(
      Schema8.isMinLength(0),
      Schema8.isMaxLength(256)
    ),
    rules: Schema8.optionalKey(
      Schema8.Array(Rule).check(Schema8.isMinLength(0), Schema8.isMaxLength(32))
    ),
    version: lexString({ const: "0.1", type: "string" }).pipe(
      Schema8.decodeTo(Schema8.Literal("0.1"))
    )
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every(
      (key) => [
        "allow",
        "digest",
        "forward",
        "log",
        "model",
        "mute",
        "refuse",
        "rules",
        "version"
      ].includes(key)
    ),
    {
      expected: "only allowed keys: allow, digest, forward, log, model, mute, refuse, rules, version"
    }
  )
);
var Thread = Schema8.StructWithRest(
  Schema8.Struct({
    thread: lexString({ maxLength: 256, minLength: 1, type: "string" })
  }),
  [Schema8.Record(Schema8.String, Data)]
).check(
  Schema8.makeFilter(
    (value) => Object.keys(value).every((key) => ["thread"].includes(key)),
    { expected: "only allowed keys: thread" }
  )
);

// packages/lexicon/src/query.ts
import { Schema as Schema9, SchemaGetter as SchemaGetter2 } from "effect";
var BooleanFromQuery = Schema9.Literals(["true", "false"]).pipe(
  Schema9.decodeTo(Schema9.Boolean, {
    decode: SchemaGetter2.transform((value) => value === "true"),
    encode: SchemaGetter2.transform((value) => value ? "true" : "false")
  })
);
var Value = Schema9.Union([Schema9.String, Schema9.Array(Schema9.String)]);
var Params2 = Schema9.Record(Schema9.String, Value);
var entries = (params) => [...Object.entries(params)].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, value]) => {
  if (Schema9.is(Schema9.String)(value)) {
    return [[key, value]];
  }
  return value.map(
    (item) => [key, item]
  );
});
var parameters = (pairs) => {
  const grouped = /* @__PURE__ */ new Map();
  for (const [key, value] of pairs) {
    const previous = grouped.get(key);
    if (previous === void 0) {
      grouped.set(key, value);
    } else if (Schema9.is(Schema9.String)(previous)) {
      grouped.set(key, [previous, value]);
    } else {
      grouped.set(key, [...previous, value]);
    }
  }
  return Object.fromEntries(grouped);
};

// packages/lexicon/src/attention.getPreferences.ts
var Params3 = Schema10.StructWithRest(
  Schema10.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema10.brand("Lexicon:did")
    )
  }),
  [Schema10.Record(Schema10.String, Data)]
);
var Input2 = Schema10.Undefined;
var Output2 = Schema10.StructWithRest(
  Schema10.Struct({ prefs: Main }),
  [Schema10.Record(Schema10.String, Data)]
);
var ParamsFromQuery = Schema10.StructWithRest(
  Schema10.Struct({ did: Schema10.String }),
  [Schema10.Record(Schema10.String, Data)]
).pipe(Schema10.decodeTo(Params3));
var encodeParams = Effect6.fn("lexicon.encodeParams")(
  function* encodeParams2(params) {
    return entries(
      yield* Schema10.decodeUnknownEffect(Params2)(
        yield* Schema10.encodeEffect(ParamsFromQuery)(params)
      )
    );
  }
);
var decodeParams = Effect6.fn("lexicon.decodeParams")(
  function* decodeParams2(entries2) {
    return yield* Schema10.decodeUnknownEffect(ParamsFromQuery)(
      parameters(entries2)
    );
  }
);
var ErrorBody2 = XrpcErrorBody;
var Method2 = {
  defaults: {},
  error: ErrorBody2,
  input: Input2,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.attention.getPreferences",
  output: Output2,
  outputEncoding: "application/json",
  params: Params3,
  path: "/xrpc/sh.mschf.ratking.attention.getPreferences"
};

// packages/lexicon/src/attention.getStatus.ts
import { Effect as Effect7, Schema as Schema12 } from "effect";

// packages/lexicon/src/attention.status.ts
import { Schema as Schema11 } from "effect";
var Main2 = Schema11.StructWithRest(
  Schema11.Struct({
    $type: Schema11.Literal("sh.mschf.ratking.attention.status"),
    note: Schema11.optionalKey(
      lexString({ maxLength: 120, type: "string" })
    ),
    state: lexString({
      enum: ["available", "busy", "dnd"],
      type: "string"
    }).pipe(Schema11.decodeTo(Schema11.Literals(["available", "busy", "dnd"]))),
    until: Schema11.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema11.brand("Lexicon:datetime")
      )
    ),
    version: lexString({ const: "0.1", type: "string" }).pipe(
      Schema11.decodeTo(Schema11.Literal("0.1"))
    )
  }),
  [Schema11.Record(Schema11.String, Data)]
);

// packages/lexicon/src/attention.getStatus.ts
var Params4 = Schema12.StructWithRest(
  Schema12.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema12.brand("Lexicon:did")
    )
  }),
  [Schema12.Record(Schema12.String, Data)]
);
var Input3 = Schema12.Undefined;
var Output3 = Schema12.StructWithRest(
  Schema12.Struct({ status: Main2 }),
  [Schema12.Record(Schema12.String, Data)]
);
var ParamsFromQuery2 = Schema12.StructWithRest(
  Schema12.Struct({ did: Schema12.String }),
  [Schema12.Record(Schema12.String, Data)]
).pipe(Schema12.decodeTo(Params4));
var encodeParams3 = Effect7.fn("lexicon.encodeParams")(
  function* encodeParams4(params) {
    return entries(
      yield* Schema12.decodeUnknownEffect(Params2)(
        yield* Schema12.encodeEffect(ParamsFromQuery2)(params)
      )
    );
  }
);
var decodeParams3 = Effect7.fn("lexicon.decodeParams")(
  function* decodeParams4(entries2) {
    return yield* Schema12.decodeUnknownEffect(ParamsFromQuery2)(
      parameters(entries2)
    );
  }
);
var ErrorBody3 = XrpcErrorBody;
var Method3 = {
  defaults: {},
  error: ErrorBody3,
  input: Input3,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.attention.getStatus",
  output: Output3,
  outputEncoding: "application/json",
  params: Params4,
  path: "/xrpc/sh.mschf.ratking.attention.getStatus"
};

// packages/lexicon/src/attention.putPreferences.ts
import { Schema as Schema13 } from "effect";
var Params5 = Schema13.Undefined;
var Input4 = Schema13.StructWithRest(
  Schema13.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema13.brand("Lexicon:did")
    ),
    keyId: lexString({ type: "string" }),
    prefs: Main,
    signature: Bytes.check(
      Schema13.makeFilter(
        (value) => value.length >= 0 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);
var Output4 = Schema13.StructWithRest(
  Schema13.Struct({ prefs: Main }),
  [Schema13.Record(Schema13.String, Data)]
);
var ErrorBody4 = XrpcErrorBody;
var Method4 = {
  defaults: {},
  error: ErrorBody4,
  input: Input4,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.attention.putPreferences",
  output: Output4,
  outputEncoding: "application/json",
  params: Params5,
  path: "/xrpc/sh.mschf.ratking.attention.putPreferences"
};

// packages/lexicon/src/attention.putStatus.ts
import { Schema as Schema14 } from "effect";
var Params6 = Schema14.Undefined;
var Input5 = Schema14.StructWithRest(
  Schema14.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema14.brand("Lexicon:did")
    ),
    keyId: lexString({ type: "string" }),
    signature: Bytes.check(
      Schema14.makeFilter(
        (value) => value.length >= 0 && value.length <= 9007199254740991,
        { expected: "byte length constraints" }
      )
    ),
    status: Main2
  }),
  [Schema14.Record(Schema14.String, Data)]
);
var Output5 = Schema14.StructWithRest(
  Schema14.Struct({ status: Main2 }),
  [Schema14.Record(Schema14.String, Data)]
);
var ErrorBody5 = XrpcErrorBody;
var Method5 = {
  defaults: {},
  error: ErrorBody5,
  input: Input5,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.attention.putStatus",
  output: Output5,
  outputEncoding: "application/json",
  params: Params6,
  path: "/xrpc/sh.mschf.ratking.attention.putStatus"
};

// packages/lexicon/src/mailbox.ack.ts
import { Schema as Schema15 } from "effect";
var Params7 = Schema15.Undefined;
var Input6 = Schema15.StructWithRest(
  Schema15.Struct({
    generation: Schema15.Int.check(
      Schema15.isGreaterThanOrEqualTo(1),
      Schema15.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema15.brand("Lexicon:tid")
    ),
    message: MessageRef,
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema15.brand("Lexicon:did")
    )
  }),
  [Schema15.Record(Schema15.String, Data)]
);
var Output6 = Schema15.StructWithRest(
  Schema15.Struct({ receipt: Receipt }),
  [Schema15.Record(Schema15.String, Data)]
);
var ErrorBody6 = XrpcErrorBody;
var Method6 = {
  defaults: {},
  error: ErrorBody6,
  input: Input6,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.mailbox.ack",
  output: Output6,
  outputEncoding: "application/json",
  params: Params7,
  path: "/xrpc/sh.mschf.ratking.mailbox.ack"
};

// packages/lexicon/src/mailbox.deliver.ts
import { Schema as Schema16 } from "effect";
var Params8 = Schema16.Undefined;
var Input7 = Schema16.StructWithRest(
  Schema16.Struct({
    generation: Schema16.Int.check(
      Schema16.isGreaterThanOrEqualTo(1),
      Schema16.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema16.brand("Lexicon:tid")
    ),
    message: MessageRef,
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema16.brand("Lexicon:did")
    )
  }),
  [Schema16.Record(Schema16.String, Data)]
);
var Output7 = Schema16.StructWithRest(
  Schema16.Struct({ receipt: Receipt }),
  [Schema16.Record(Schema16.String, Data)]
);
var ErrorBody7 = XrpcErrorBody;
var Method7 = {
  defaults: {},
  error: ErrorBody7,
  input: Input7,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.mailbox.deliver",
  output: Output7,
  outputEncoding: "application/json",
  params: Params8,
  path: "/xrpc/sh.mschf.ratking.mailbox.deliver"
};

// packages/lexicon/src/mailbox.list.ts
import { Effect as Effect8, Schema as Schema17 } from "effect";
var Params9 = Schema17.StructWithRest(
  Schema17.Struct({
    afterSeq: Schema17.optionalKey(
      Schema17.Int.check(
        Schema17.isGreaterThanOrEqualTo(0),
        Schema17.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    cursor: Schema17.optionalKey(
      lexString({
        description: "Opaque snapshot cursor; keep all other parameters fixed while paginating.",
        type: "string"
      })
    ),
    limit: Schema17.optionalKey(
      Schema17.Int.check(
        Schema17.isGreaterThanOrEqualTo(1),
        Schema17.isLessThanOrEqualTo(100)
      )
    ),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema17.brand("Lexicon:did")
    )
  }),
  [Schema17.Record(Schema17.String, Data)]
);
var Input8 = Schema17.Undefined;
var Output8 = Schema17.StructWithRest(
  Schema17.Struct({
    cursor: Schema17.optionalKey(
      lexString({
        description: "Present only while more entries remain. Checkpoint throughSeq after processing every page.",
        type: "string"
      })
    ),
    events: Schema17.Array(
      Schema17.Union([
        Schema17.StructWithRest(
          Schema17.Struct({
            $type: Schema17.Literal("sh.mschf.ratking.defs#messageEvent"),
            envelope: EncryptedEnvelope,
            receipt: Receipt,
            seq: Schema17.Int.check(
              Schema17.isGreaterThanOrEqualTo(1),
              Schema17.isLessThanOrEqualTo(9007199254740991)
            )
          }),
          [Schema17.Record(Schema17.String, Data)]
        ),
        Schema17.StructWithRest(
          Schema17.Struct({
            $type: Schema17.Literal("sh.mschf.ratking.defs#receiptEvent"),
            receipt: Receipt,
            seq: Schema17.Int.check(
              Schema17.isGreaterThanOrEqualTo(1),
              Schema17.isLessThanOrEqualTo(9007199254740991)
            )
          }),
          [Schema17.Record(Schema17.String, Data)]
        ),
        Schema17.StructWithRest(
          Schema17.Struct({
            $type: Schema17.Literal("sh.mschf.ratking.attention.receipt"),
            operation: lexString({
              enum: ["putPreferences", "putStatus"],
              type: "string"
            }).pipe(
              Schema17.decodeTo(Schema17.Literals(["putPreferences", "putStatus"]))
            ),
            seq: Schema17.Int.check(
              Schema17.isGreaterThanOrEqualTo(1),
              Schema17.isLessThanOrEqualTo(9007199254740991)
            )
          }),
          [Schema17.Record(Schema17.String, Data)]
        ),
        TaggedMap.check(
          Schema17.makeFilter(
            (value) => ![
              "sh.mschf.ratking.defs#messageEvent",
              "sh.mschf.ratking.defs#receiptEvent",
              "sh.mschf.ratking.attention.receipt"
            ].includes(value.$type),
            { expected: "unknown union tag only" }
          )
        )
      ])
    ).check(Schema17.isMinLength(0), Schema17.isMaxLength(100)),
    throughSeq: Schema17.Int.check(
      Schema17.isGreaterThanOrEqualTo(0),
      Schema17.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema17.Record(Schema17.String, Data)]
);
var ParamsFromQuery3 = Schema17.StructWithRest(
  Schema17.Struct({
    afterSeq: Schema17.optionalKey(Schema17.FiniteFromString),
    cursor: Schema17.optionalKey(Schema17.String),
    limit: Schema17.optionalKey(Schema17.FiniteFromString),
    recipientDid: Schema17.String
  }),
  [Schema17.Record(Schema17.String, Data)]
).pipe(Schema17.decodeTo(Params9));
var encodeParams5 = Effect8.fn("lexicon.encodeParams")(
  function* encodeParams6(params) {
    return entries(
      yield* Schema17.decodeUnknownEffect(Params2)(
        yield* Schema17.encodeEffect(ParamsFromQuery3)(params)
      )
    );
  }
);
var decodeParams5 = Effect8.fn("lexicon.decodeParams")(
  function* decodeParams6(entries2) {
    return yield* Schema17.decodeUnknownEffect(ParamsFromQuery3)(
      parameters(entries2)
    );
  }
);
var ErrorBody8 = XrpcErrorBody;
var Method8 = {
  defaults: { limit: 50 },
  error: ErrorBody8,
  input: Input8,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.list",
  output: Output8,
  outputEncoding: "application/json",
  params: Params9,
  path: "/xrpc/sh.mschf.ratking.mailbox.list"
};

// packages/lexicon/src/mailbox.send.ts
import { Schema as Schema18 } from "effect";
var Params10 = Schema18.Undefined;
var Input9 = Schema18.StructWithRest(
  Schema18.Struct({
    envelope: EncryptedEnvelope,
    generation: Schema18.optionalKey(
      Schema18.Int.check(
        Schema18.isGreaterThanOrEqualTo(1),
        Schema18.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    leaseId: Schema18.optionalKey(
      lexString({ format: "tid", type: "string" }).pipe(
        Schema18.brand("Lexicon:tid")
      )
    ),
    wakeReason: Schema18.optionalKey(
      lexString({
        enum: ["to", "ask", "reply", "cc", "quiet", "data"],
        type: "string"
      }).pipe(
        Schema18.decodeTo(
          Schema18.Literals(["to", "ask", "reply", "cc", "quiet", "data"])
        )
      )
    ),
    woke: Schema18.optionalKey(Schema18.Boolean)
  }),
  [Schema18.Record(Schema18.String, Data)]
);
var Output9 = Schema18.StructWithRest(
  Schema18.Struct({ receipt: Receipt }),
  [Schema18.Record(Schema18.String, Data)]
);
var ErrorBody9 = XrpcErrorBody;
var Method9 = {
  defaults: {},
  error: ErrorBody9,
  input: Input9,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.mailbox.send",
  output: Output9,
  outputEncoding: "application/json",
  params: Params10,
  path: "/xrpc/sh.mschf.ratking.mailbox.send"
};

// packages/lexicon/src/runtime.acquireLease.ts
import { Schema as Schema20 } from "effect";

// packages/lexicon/src/runtime.lease.ts
import { Schema as Schema19 } from "effect";
var Claude = Schema19.StructWithRest(
  Schema19.Struct({
    executionId: Schema19.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema19.Record(Schema19.String, Data)]
);
var Codex = Schema19.StructWithRest(
  Schema19.Struct({
    executionId: Schema19.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema19.Record(Schema19.String, Data)]
);
var Main3 = Schema19.StructWithRest(
  Schema19.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema19.brand("Lexicon:did")
    ),
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema19.brand("Lexicon:datetime")
    ),
    generation: Schema19.Int.check(
      Schema19.isGreaterThanOrEqualTo(1),
      Schema19.isLessThanOrEqualTo(9007199254740991)
    ),
    harness: Schema19.Union([
      Schema19.StructWithRest(
        Schema19.Struct({
          $type: Schema19.Literal("sh.mschf.ratking.runtime.lease#pi"),
          executionId: Schema19.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema19.Record(Schema19.String, Data)]
      ),
      Schema19.StructWithRest(
        Schema19.Struct({
          $type: Schema19.Literal("sh.mschf.ratking.runtime.lease#claude"),
          executionId: Schema19.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema19.Record(Schema19.String, Data)]
      ),
      Schema19.StructWithRest(
        Schema19.Struct({
          $type: Schema19.Literal("sh.mschf.ratking.runtime.lease#codex"),
          executionId: Schema19.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema19.Record(Schema19.String, Data)]
      ),
      Schema19.StructWithRest(
        Schema19.Struct({
          $type: Schema19.Literal("sh.mschf.ratking.runtime.lease#opencode"),
          executionId: Schema19.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema19.Record(Schema19.String, Data)]
      ),
      Schema19.StructWithRest(
        Schema19.Struct({
          $type: Schema19.Literal("sh.mschf.ratking.runtime.lease#other"),
          executionId: Schema19.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          kind: lexString({
            description: "Harness adapter identifier.",
            type: "string"
          }),
          paneId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema19.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema19.Record(Schema19.String, Data)]
      ),
      TaggedMap.check(
        Schema19.makeFilter(
          (value) => ![
            "sh.mschf.ratking.runtime.lease#pi",
            "sh.mschf.ratking.runtime.lease#claude",
            "sh.mschf.ratking.runtime.lease#codex",
            "sh.mschf.ratking.runtime.lease#opencode",
            "sh.mschf.ratking.runtime.lease#other"
          ].includes(value.$type),
          { expected: "unknown union tag only" }
        )
      )
    ]),
    issuedAt: Schema19.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema19.brand("Lexicon:datetime")
      )
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema19.brand("Lexicon:tid")
    ),
    renders: Schema19.optionalKey(
      Schema19.Array(lexString({ type: "string" })).check(
        Schema19.isMinLength(0),
        Schema19.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema19.Record(Schema19.String, Data)]
);
var Opencode = Schema19.StructWithRest(
  Schema19.Struct({
    executionId: Schema19.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema19.Record(Schema19.String, Data)]
);
var Other = Schema19.StructWithRest(
  Schema19.Struct({
    executionId: Schema19.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    kind: lexString({
      description: "Harness adapter identifier.",
      type: "string"
    }),
    paneId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema19.Record(Schema19.String, Data)]
);
var Pi = Schema19.StructWithRest(
  Schema19.Struct({
    executionId: Schema19.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema19.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema19.Record(Schema19.String, Data)]
);

// packages/lexicon/src/runtime.acquireLease.ts
var Params11 = Schema20.Undefined;
var Input10 = Schema20.StructWithRest(
  Schema20.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema20.brand("Lexicon:did")
    ),
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema20.brand("Lexicon:datetime")
    ),
    generation: Schema20.optionalKey(
      Schema20.Int.check(
        Schema20.isGreaterThanOrEqualTo(1),
        Schema20.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    harness: Schema20.Union([
      Schema20.StructWithRest(
        Schema20.Struct({
          $type: Schema20.Literal("sh.mschf.ratking.runtime.lease#pi"),
          executionId: Schema20.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema20.Record(Schema20.String, Data)]
      ),
      Schema20.StructWithRest(
        Schema20.Struct({
          $type: Schema20.Literal("sh.mschf.ratking.runtime.lease#claude"),
          executionId: Schema20.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema20.Record(Schema20.String, Data)]
      ),
      Schema20.StructWithRest(
        Schema20.Struct({
          $type: Schema20.Literal("sh.mschf.ratking.runtime.lease#codex"),
          executionId: Schema20.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema20.Record(Schema20.String, Data)]
      ),
      Schema20.StructWithRest(
        Schema20.Struct({
          $type: Schema20.Literal("sh.mschf.ratking.runtime.lease#opencode"),
          executionId: Schema20.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema20.Record(Schema20.String, Data)]
      ),
      Schema20.StructWithRest(
        Schema20.Struct({
          $type: Schema20.Literal("sh.mschf.ratking.runtime.lease#other"),
          executionId: Schema20.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          kind: lexString({
            description: "Harness adapter identifier.",
            type: "string"
          }),
          paneId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema20.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema20.Record(Schema20.String, Data)]
      ),
      TaggedMap.check(
        Schema20.makeFilter(
          (value) => ![
            "sh.mschf.ratking.runtime.lease#pi",
            "sh.mschf.ratking.runtime.lease#claude",
            "sh.mschf.ratking.runtime.lease#codex",
            "sh.mschf.ratking.runtime.lease#opencode",
            "sh.mschf.ratking.runtime.lease#other"
          ].includes(value.$type),
          { expected: "unknown union tag only" }
        )
      )
    ]),
    leaseId: Schema20.optionalKey(
      lexString({ format: "tid", type: "string" }).pipe(
        Schema20.brand("Lexicon:tid")
      )
    ),
    renders: Schema20.optionalKey(
      Schema20.Array(lexString({ type: "string" })).check(
        Schema20.isMinLength(0),
        Schema20.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema20.Record(Schema20.String, Data)]
);
var Output10 = Schema20.StructWithRest(
  Schema20.Struct({ lease: Main3 }),
  [Schema20.Record(Schema20.String, Data)]
);
var ErrorBody10 = XrpcErrorBody;
var Method10 = {
  defaults: {},
  error: ErrorBody10,
  input: Input10,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.runtime.acquireLease",
  output: Output10,
  outputEncoding: "application/json",
  params: Params11,
  path: "/xrpc/sh.mschf.ratking.runtime.acquireLease"
};

// packages/lexicon/src/runtime.releaseLease.ts
import { Schema as Schema21 } from "effect";
var Params12 = Schema21.Undefined;
var Input11 = Schema21.StructWithRest(
  Schema21.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema21.brand("Lexicon:did")
    ),
    generation: Schema21.Int.check(
      Schema21.isGreaterThanOrEqualTo(1),
      Schema21.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema21.brand("Lexicon:tid")
    )
  }),
  [Schema21.Record(Schema21.String, Data)]
);
var Output11 = Schema21.Undefined;
var ErrorBody11 = XrpcErrorBody;
var Method11 = {
  defaults: {},
  error: ErrorBody11,
  input: Input11,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.runtime.releaseLease",
  output: Output11,
  outputEncoding: "",
  params: Params12,
  path: "/xrpc/sh.mschf.ratking.runtime.releaseLease"
};

// packages/lexicon/src/runtime.renewLease.ts
import { Schema as Schema22 } from "effect";
var Params13 = Schema22.Undefined;
var Input12 = Schema22.StructWithRest(
  Schema22.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema22.brand("Lexicon:did")
    ),
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema22.brand("Lexicon:datetime")
    ),
    generation: Schema22.Int.check(
      Schema22.isGreaterThanOrEqualTo(1),
      Schema22.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema22.brand("Lexicon:tid")
    ),
    renders: Schema22.optionalKey(
      Schema22.Array(lexString({ type: "string" })).check(
        Schema22.isMinLength(0),
        Schema22.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema22.Record(Schema22.String, Data)]
);
var Output12 = Schema22.StructWithRest(
  Schema22.Struct({ lease: Main3 }),
  [Schema22.Record(Schema22.String, Data)]
);
var ErrorBody12 = XrpcErrorBody;
var Method12 = {
  defaults: {},
  error: ErrorBody12,
  input: Input12,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.runtime.renewLease",
  output: Output12,
  outputEncoding: "application/json",
  params: Params13,
  path: "/xrpc/sh.mschf.ratking.runtime.renewLease"
};

// packages/lexicon/src/runtime.resolveLease.ts
import { Effect as Effect9, Schema as Schema23 } from "effect";
var Params14 = Schema23.StructWithRest(
  Schema23.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema23.brand("Lexicon:did")
    )
  }),
  [Schema23.Record(Schema23.String, Data)]
);
var Input13 = Schema23.Undefined;
var Output13 = Schema23.StructWithRest(
  Schema23.Struct({ lease: Main3 }),
  [Schema23.Record(Schema23.String, Data)]
);
var ParamsFromQuery4 = Schema23.StructWithRest(
  Schema23.Struct({ did: Schema23.String }),
  [Schema23.Record(Schema23.String, Data)]
).pipe(Schema23.decodeTo(Params14));
var encodeParams7 = Effect9.fn("lexicon.encodeParams")(
  function* encodeParams8(params) {
    return entries(
      yield* Schema23.decodeUnknownEffect(Params2)(
        yield* Schema23.encodeEffect(ParamsFromQuery4)(params)
      )
    );
  }
);
var decodeParams7 = Effect9.fn("lexicon.decodeParams")(
  function* decodeParams8(entries2) {
    return yield* Schema23.decodeUnknownEffect(ParamsFromQuery4)(
      parameters(entries2)
    );
  }
);
var ErrorBody13 = XrpcErrorBody;
var Method13 = {
  defaults: {},
  error: ErrorBody13,
  input: Input13,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.runtime.resolveLease",
  output: Output13,
  outputEncoding: "application/json",
  params: Params14,
  path: "/xrpc/sh.mschf.ratking.runtime.resolveLease"
};

// packages/lexicon/src/transport.ts
import { Context } from "effect";
var Transport = class extends Context.Service()("@rat-king/lexicon/Transport") {
};

// packages/lexicon/src/xrpc-failure.ts
import { Schema as Schema24 } from "effect";
var XrpcFailure = class extends Schema24.TaggedError()(
  "XrpcFailure",
  {
    error: Schema24.String,
    message: Schema24.optionalKey(Schema24.String),
    response: Schema24.Union([Schema24.String, DataMap]),
    status: Schema24.Int
  }
) {
};

// packages/lexicon/src/mailbox-client.ts
var responseBody = Effect10.fn("lexicon.responseBody")(function* responseBody2(response) {
  if (response.kind !== "json") {
    return yield* new XrpcFailure({
      error: "NonJsonResponse",
      response: response.body,
      status: response.status
    });
  }
  if (response.status < 200 || response.status >= 300) {
    const result = yield* Schema25.decodeUnknownEffect(XrpcErrorBody)(
      response.body
    ).pipe(Effect10.result);
    if (Result.isSuccess(result)) {
      return yield* new XrpcFailure({
        error: result.success.error,
        status: response.status,
        ...result.success.message === void 0 ? { response: result.success } : { message: result.success.message, response: result.success }
      });
    }
    return yield* new XrpcFailure({
      error: "InvalidErrorResponse",
      response: { body: response.body },
      status: response.status
    });
  }
  return response.body;
});
var MailboxClient = class extends Context2.Service()("@rat-king/lexicon/MailboxClient") {
};
var clientLayer = Layer.effect(
  MailboxClient,
  Effect10.gen(function* clientLayer2() {
    const transport = yield* Transport;
    return MailboxClient.of({
      ack: Effect10.fn("lexicon.ack")(function* invoke(input) {
        const body = yield* Schema25.encodeEffect(Input6)(input);
        const response = yield* transport.request({
          input: body,
          method: Method6.method,
          nsid: Method6.nsid,
          params: void 0
        });
        return yield* Schema25.decodeUnknownEffect(Output6)(
          yield* responseBody(response)
        );
      }),
      acquireLease: Effect10.fn("lexicon.acquireLease")(function* invoke(input) {
        const encoded = yield* Schema25.encodeEffect(Input10)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method10.method,
          nsid: Method10.nsid,
          params: void 0
        });
        return yield* Schema25.decodeUnknownEffect(Output10)(
          yield* responseBody(response)
        );
      }),
      deliver: Effect10.fn("lexicon.deliver")(function* invoke(input) {
        const encoded = yield* Schema25.encodeEffect(Input7)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method7.method,
          nsid: Method7.nsid,
          params: void 0
        });
        return yield* Schema25.decodeUnknownEffect(Output7)(
          yield* responseBody(response)
        );
      }),
      getPreferences: Effect10.fn("lexicon.getPreferences")(
        function* invoke(params) {
          const encoded = yield* Schema25.encodeEffect(Params3)(
            params
          );
          const response = yield* transport.request({
            input: void 0,
            method: Method2.method,
            nsid: Method2.nsid,
            params: encoded
          });
          return yield* Schema25.decodeUnknownEffect(Output2)(
            yield* responseBody(response)
          );
        }
      ),
      getStatus: Effect10.fn("lexicon.getStatus")(function* invoke(params) {
        const encoded = yield* Schema25.encodeEffect(Params4)(params);
        const response = yield* transport.request({
          input: void 0,
          method: Method3.method,
          nsid: Method3.nsid,
          params: encoded
        });
        return yield* Schema25.decodeUnknownEffect(Output3)(
          yield* responseBody(response)
        );
      }),
      list: Effect10.fn("lexicon.list")(function* invoke(params) {
        const encoded = yield* Schema25.encodeEffect(Params9)({
          ...Method8.defaults,
          ...params
        });
        const response = yield* transport.request({
          input: void 0,
          method: Method8.method,
          nsid: Method8.nsid,
          params: encoded
        });
        return yield* Schema25.decodeUnknownEffect(Output8)(
          yield* responseBody(response)
        );
      }),
      putDidDocument: Effect10.fn("lexicon.putDidDocument")(
        function* invoke(input) {
          const encoded = yield* Schema25.encodeEffect(Input)(
            input
          );
          const response = yield* transport.request({
            input: encoded,
            method: Method.method,
            nsid: Method.nsid,
            params: void 0
          });
          return yield* Schema25.decodeUnknownEffect(Output)(
            yield* responseBody(response)
          );
        }
      ),
      putPreferences: Effect10.fn("lexicon.putPreferences")(
        function* invoke(input) {
          const encoded = yield* Schema25.encodeEffect(Input4)(
            input
          );
          const response = yield* transport.request({
            input: encoded,
            method: Method4.method,
            nsid: Method4.nsid,
            params: void 0
          });
          return yield* Schema25.decodeUnknownEffect(Output4)(
            yield* responseBody(response)
          );
        }
      ),
      putStatus: Effect10.fn("lexicon.putStatus")(function* invoke(input) {
        const encoded = yield* Schema25.encodeEffect(Input5)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method5.method,
          nsid: Method5.nsid,
          params: void 0
        });
        return yield* Schema25.decodeUnknownEffect(Output5)(
          yield* responseBody(response)
        );
      }),
      releaseLease: Effect10.fn("lexicon.releaseLease")(function* invoke(input) {
        const encoded = yield* Schema25.encodeEffect(Input11)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method11.method,
          nsid: Method11.nsid,
          params: void 0
        });
        if (response.status === 204 && response.kind === "text" && response.body === "") {
          const output = void 0;
          return yield* Schema25.decodeEffect(Output11)(output);
        }
        return yield* Schema25.decodeUnknownEffect(Output11)(
          yield* responseBody(response)
        );
      }),
      renewLease: Effect10.fn("lexicon.renewLease")(function* invoke(input) {
        const encoded = yield* Schema25.encodeEffect(Input12)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method12.method,
          nsid: Method12.nsid,
          params: void 0
        });
        return yield* Schema25.decodeUnknownEffect(Output12)(
          yield* responseBody(response)
        );
      }),
      resolveLease: Effect10.fn("lexicon.resolveLease")(function* invoke(params) {
        const encoded = yield* Schema25.encodeEffect(Params14)({
          ...Method13.defaults,
          ...params
        });
        const response = yield* transport.request({
          input: void 0,
          method: Method13.method,
          nsid: Method13.nsid,
          params: encoded
        });
        return yield* Schema25.decodeUnknownEffect(Output13)(
          yield* responseBody(response)
        );
      }),
      send: Effect10.fn("lexicon.send")(function* invoke(input) {
        const body = yield* Schema25.encodeEffect(Input9)(input);
        const response = yield* transport.request({
          input: body,
          method: Method9.method,
          nsid: Method9.nsid,
          params: void 0
        });
        return yield* Schema25.decodeUnknownEffect(Output9)(
          yield* responseBody(response)
        );
      })
    });
  })
);

// packages/mailbox-client/src/mailbox.ts
import { Clock as Clock3, Context as Context6, Effect as Effect18, Layer as Layer4, Option as Option3, Schema as Schema37 } from "effect";

// packages/mailbox-client/src/attention.ts
import { Effect as Effect11, Schema as Schema28 } from "effect";

// packages/mailbox-client/src/error.ts
import { Schema as Schema26 } from "effect";
var MailboxClientError = class extends Schema26.TaggedError()(
  "MailboxClientError",
  {
    error: Schema26.optionalKey(Schema26.String),
    reason: Schema26.String,
    status: Schema26.optionalKey(Schema26.Finite)
  }
) {
};
var clientError = (failure3) => {
  if (Schema26.is(MailboxClientError)(failure3)) {
    return failure3;
  }
  if (Schema26.is(XrpcFailure)(failure3)) {
    return new MailboxClientError({
      error: failure3.error,
      reason: failure3.message ?? "Mailbox XRPC call failed",
      status: failure3.status
    });
  }
  return new MailboxClientError({ reason: "Mailbox operation failed" });
};

// packages/mailbox-client/src/identity.ts
import { Schema as Schema27 } from "effect";
var PrivateJwk = Schema27.Struct({
  crv: Schema27.Literal("P-256"),
  d: Schema27.String,
  kty: Schema27.Literal("EC"),
  x: Schema27.String,
  y: Schema27.String
});
var Identity = Schema27.Struct({
  agreement: PrivateJwk,
  did: Schema27.String.check(Schema27.isPattern(/^did:web:/u)),
  signing: PrivateJwk
});
var importSigning = (identity) => cryptoOperation(
  () => crypto.subtle.importKey(
    "jwk",
    identity.signing,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  )
);
var importAgreement = (identity) => cryptoOperation(
  () => crypto.subtle.importKey(
    "jwk",
    identity.agreement,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )
);

// packages/mailbox-client/src/attention.ts
var attentionBytes = (did, nsid, value) => canonical({ did, nsid, value });
var attentionClient = (client, identity) => ({
  getPreferences: Effect11.fn("AttentionClient.getPreferences")(
    () => Schema28.decodeUnknownEffect(Params3)({
      did: identity.did
    }).pipe(
      Effect11.flatMap(client.getPreferences),
      Effect11.map((output) => output.prefs),
      Effect11.mapError(clientError)
    )
  ),
  getStatus: Effect11.fn("AttentionClient.getStatus")(
    (did = identity.did) => Schema28.decodeUnknownEffect(Params4)({ did }).pipe(
      Effect11.flatMap(client.getStatus),
      Effect11.map((output) => output.status),
      Effect11.mapError(clientError)
    )
  ),
  putPreferences: Effect11.fn("AttentionClient.putPreferences")(
    function* putPreferences(prefs) {
      const validated = yield* Schema28.decodeUnknownEffect(Main)(prefs);
      const key = yield* importSigning(identity);
      const signature = yield* sign(
        key,
        attentionBytes(identity.did, Method4.nsid, validated)
      );
      const input = yield* Schema28.decodeUnknownEffect(
        Schema28.toType(Input4)
      )({
        did: identity.did,
        keyId: `${identity.did}#atproto`,
        prefs: validated,
        signature
      });
      return (yield* client.putPreferences(input)).prefs;
    },
    Effect11.mapError(clientError)
  ),
  putStatus: Effect11.fn("AttentionClient.putStatus")(function* putStatus(status) {
    const validated = yield* Schema28.decodeUnknownEffect(Main2)(status);
    const key = yield* importSigning(identity);
    const signature = yield* sign(
      key,
      attentionBytes(identity.did, Method5.nsid, validated)
    );
    const input = yield* Schema28.decodeUnknownEffect(
      Schema28.toType(Input5)
    )({
      did: identity.did,
      keyId: `${identity.did}#atproto`,
      signature,
      status: validated
    });
    return (yield* client.putStatus(input)).status;
  }, Effect11.mapError(clientError))
});
var defaultPreferences = () => Schema28.decodeUnknownSync(Main)({
  allow: [],
  forward: [],
  log: false,
  model: { body: "summary", kind: "none", timeoutMs: 2e3 },
  mute: [],
  refuse: [],
  version: "0.1"
});
var defaultStatus = () => Schema28.decodeUnknownSync(Main2)({
  $type: "sh.mschf.ratking.attention.status",
  state: "available",
  version: "0.1"
});
var toBasisPoints = (decimal) => Math.round(decimal * 1e4);
var fromBasisPoints = (points) => points / 1e4;

// packages/mailbox-client/src/auth.ts
import { Context as Context4, Effect as Effect12, Layer as Layer2, Schema as Schema30 } from "effect";

// packages/mailbox-client/src/auth-failure.ts
import { Schema as Schema29 } from "effect";
var ServiceAuthFailure = class extends Schema29.TaggedError()(
  "XrpcFailure",
  {
    error: Schema29.String,
    message: Schema29.optionalKey(Schema29.String),
    response: Schema29.Record(Schema29.String, Schema29.Json),
    status: Schema29.Int
  }
) {
};

// packages/mailbox-client/src/replay.ts
import { Context as Context3 } from "effect";
var ReplayAuthority = class extends Context3.Service()("mailbox/ReplayAuthority") {
};

// packages/mailbox-client/src/auth.ts
var failure = (error, status, message) => {
  if (message === void 0) {
    return new ServiceAuthFailure({ error, response: {}, status });
  }
  return new ServiceAuthFailure({ error, message, response: {}, status });
};
var base64url2 = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
var unbase64url = (text) => Uint8Array.from(
  atob(text.replaceAll("-", "+").replaceAll("_", "/")),
  (character) => character.codePointAt(0) ?? 0
);
var Claims = Schema30.Struct({
  aud: Schema30.String,
  exp: Schema30.Int,
  iat: Schema30.Int,
  iss: Schema30.String,
  jti: Schema30.String.check(Schema30.isMinLength(16)),
  lxm: Schema30.String
});
var authFailure = (error, status = 400, message = error) => new ServiceAuthFailure({
  error,
  message,
  response: { error, message },
  status
});
var PublicJwk2 = Schema30.Struct({
  crv: Schema30.Literal("P-256"),
  d: Schema30.optionalKey(Schema30.Never),
  kty: Schema30.Literal("EC"),
  x: Schema30.String,
  y: Schema30.String
});
var Document = Schema30.Struct({
  authentication: Schema30.Array(Schema30.String),
  id: Schema30.String,
  keyAgreement: Schema30.Array(Schema30.String),
  verificationMethod: Schema30.Array(
    Schema30.Struct({
      controller: Schema30.String,
      id: Schema30.String,
      publicKeyJwk: PublicJwk2
    })
  )
});
var Documents = Schema30.Array(Document);
var DidResolver = class extends Context4.Service()("mailbox/DidResolver") {
};
var documentResolver = (lookup) => Layer2.succeed(
  DidResolver,
  DidResolver.of({
    resolve: Effect12.fn("DidResolver.resolve")(
      function* resolve(did, keyId, purpose) {
        const document = yield* lookup(did);
        const method = document?.verificationMethod.find(
          (candidate) => candidate.id === keyId && candidate.controller === did
        );
        if (!did.startsWith("did:web:") || !method || document?.[purpose].includes(keyId) !== true) {
          return yield* Effect12.fail(
            failure("Forbidden", 403, "Unauthorized DID key")
          );
        }
        const algorithm = purpose === "authentication" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "ECDH", namedCurve: "P-256" };
        return yield* cryptoOperation(
          () => crypto.subtle.importKey(
            "jwk",
            method.publicKeyJwk,
            algorithm,
            true,
            purpose === "authentication" ? ["verify"] : []
          )
        ).pipe(Effect12.mapError(() => failure("AuthRequired", 401)));
      }
    )
  })
);
var staticResolver = (documents) => documentResolver(
  (did) => Effect12.succeed(documents.find((candidate) => candidate.id === did))
);
var Header = Schema30.Struct({
  alg: Schema30.Literal("ES256"),
  kid: Schema30.optionalKey(Schema30.String),
  typ: Schema30.optionalKey(Schema30.Literal("JWT"))
});
var json = (text) => Effect12.try({
  catch: () => authFailure("AuthRequired", 401),
  try: () => new TextDecoder().decode(unbase64url(text))
});
var authenticateClaims = Effect12.fn("ServiceAuth.authenticateClaims")(
  function* authenticateClaims2(request) {
    const token = request.authorization?.match(
      /^Bearer (?<token>[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u
    )?.groups?.token;
    if (token === void 0 || token === "") {
      return yield* Effect12.fail(authFailure("AuthRequired", 401));
    }
    const [headerText = "", claimsText = "", signatureText = ""] = token.split(".");
    const header = yield* Schema30.decodeUnknownEffect(
      Schema30.fromJsonString(Header)
    )(yield* json(headerText)).pipe(
      Effect12.mapError(() => authFailure("AuthRequired", 401))
    );
    const claims = yield* Schema30.decodeUnknownEffect(
      Schema30.fromJsonString(Claims)
    )(yield* json(claimsText)).pipe(
      Effect12.mapError(() => authFailure("AuthRequired", 401))
    );
    const now = Math.floor(request.now / 1e3);
    if (claims.aud !== request.audience || claims.lxm !== request.nsid || claims.iat > now + (request.skewSeconds ?? 0) || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > 60 || now - claims.iat > 60) {
      return yield* Effect12.fail(
        authFailure("AuthRequired", 401, "Invalid service-auth claims")
      );
    }
    const kid = header.kid ?? "#atproto";
    const keyId = kid.startsWith("#") ? `${claims.iss}${kid}` : kid;
    const resolver = yield* DidResolver;
    const key = yield* resolver.resolve(claims.iss, keyId, "authentication");
    const signature = yield* Effect12.try({
      catch: () => authFailure("AuthRequired", 401),
      try: () => unbase64url(signatureText)
    });
    const valid = yield* verify(
      key,
      new TextEncoder().encode(`${headerText}.${claimsText}`),
      signature
    ).pipe(Effect12.mapError(() => authFailure("AuthRequired", 401)));
    if (!valid) {
      return yield* Effect12.fail(authFailure("AuthRequired", 401));
    }
    const replay = yield* ReplayAuthority;
    yield* replay.consume(claims, request.now);
    return claims;
  }
);
var serviceToken = Effect12.fn("ServiceAuth.sign")(
  function* serviceToken2(claims, key, kid) {
    const header = base64url2(
      new TextEncoder().encode(
        JSON.stringify({ alg: "ES256", kid: kid ?? "#atproto", typ: "JWT" })
      )
    );
    const payload = base64url2(new TextEncoder().encode(JSON.stringify(claims)));
    const bytes = new TextEncoder().encode(`${header}.${payload}`);
    return `${header}.${payload}.${base64url2(yield* sign(key, bytes))}`;
  }
);

// packages/lexicon/src/mailbox.getPresence.ts
import { Effect as Effect13, Schema as Schema31 } from "effect";
var Params15 = Schema31.StructWithRest(
  Schema31.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema31.brand("Lexicon:did")
    )
  }),
  [Schema31.Record(Schema31.String, Data)]
);
var Input14 = Schema31.Undefined;
var Output14 = Schema31.StructWithRest(
  Schema31.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema31.brand("Lexicon:did")
    ),
    held: Schema31.Boolean,
    lastHeldAt: Schema31.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema31.brand("Lexicon:datetime")
      )
    ),
    renders: Schema31.optionalKey(
      Schema31.Array(lexString({ type: "string" })).check(
        Schema31.isMinLength(0),
        Schema31.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema31.Record(Schema31.String, Data)]
);
var ParamsFromQuery5 = Schema31.StructWithRest(
  Schema31.Struct({ did: Schema31.String }),
  [Schema31.Record(Schema31.String, Data)]
).pipe(Schema31.decodeTo(Params15));
var encodeParams9 = Effect13.fn("lexicon.encodeParams")(
  function* encodeParams10(params) {
    return entries(
      yield* Schema31.decodeUnknownEffect(Params2)(
        yield* Schema31.encodeEffect(ParamsFromQuery5)(params)
      )
    );
  }
);
var decodeParams9 = Effect13.fn("lexicon.decodeParams")(
  function* decodeParams10(entries2) {
    return yield* Schema31.decodeUnknownEffect(ParamsFromQuery5)(
      parameters(entries2)
    );
  }
);
var ErrorBody14 = XrpcErrorBody;
var Method14 = {
  defaults: {},
  error: ErrorBody14,
  input: Input14,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.getPresence",
  output: Output14,
  outputEncoding: "application/json",
  params: Params15,
  path: "/xrpc/sh.mschf.ratking.mailbox.getPresence"
};

// packages/mailbox-client/src/record-visibility.ts
import { Effect as Effect14, Option, Schema as Schema32 } from "effect";
var readerCannotRender = (name, type, presence) => type !== "unknown" && presence?.held === true && presence.renders !== void 0 && !presence.renders.some(
  (render) => render.endsWith(".*") ? type.startsWith(render.slice(0, -1)) : type === render
) ? `NOT SENT: ReaderCannotRender. ${name}'s reader doesn't render ${type} (it predates typed records or doesn't declare it). Send prose instead, or ask them to restart.` : void 0;
var recordType = (body) => {
  const result = Schema32.decodeUnknownOption(
    Schema32.fromJsonString(Schema32.Struct({ $type: Schema32.String }))
  )(body);
  return Option.match(result, {
    onNone: () => "unknown",
    onSome: (record) => record.$type
  });
};
var lookupPresence = Effect14.fn("Mailbox.lookupPresence")(
  function* lookupPresence2(did) {
    const transport = yield* Transport;
    const params = yield* Schema32.decodeUnknownEffect(Params15)({
      did
    }).pipe(Effect14.mapError(clientError));
    const response = yield* transport.request({
      input: void 0,
      method: "GET",
      nsid: Method14.nsid,
      params: yield* Schema32.encodeEffect(Params15)(params).pipe(
        Effect14.mapError(clientError)
      )
    }).pipe(Effect14.mapError(clientError));
    if (response.kind !== "json" || response.status !== 200) {
      return yield* new MailboxClientError({
        reason: "Presence request refused"
      });
    }
    return yield* Schema32.decodeUnknownEffect(Output14)(
      response.body
    ).pipe(Effect14.mapError(clientError));
  }
);

// packages/mailbox-client/src/tid.ts
var tid = (millis, clockId, micros = 0) => {
  let number = (BigInt(millis) * 1000n + BigInt(Math.abs(micros) % 1e3)) * 1024n + BigInt(clockId % 1024);
  const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
  let text = "";
  for (let index = 0; index < 13; index += 1) {
    text = (alphabet[Number(number % 32n)] ?? "2") + text;
    number /= 32n;
  }
  return text;
};
var randomTid = (millis) => {
  const words = crypto.getRandomValues(new Uint16Array(2));
  return tid(millis, words[0] ?? 0, words[1] ?? 0);
};

// packages/lexicon/src/transport-failure.ts
import { Schema as Schema33 } from "effect";
var TransportFailure = class extends Schema33.TaggedError()(
  "TransportFailure",
  { cause: Schema33.Defect(), reason: Schema33.String }
) {
};

// packages/mailbox-client/src/transport.ts
import { Clock, Effect as Effect15, Layer as Layer3, Result as Result2, Schema as Schema34 } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
var transportLayer = (endpoint, audience, identity) => Layer3.effect(
  Transport,
  Effect15.gen(function* makeTransport() {
    const http = yield* HttpClient.HttpClient;
    return Transport.of({
      request: Effect15.fn("MailboxCli.request")(
        function* requestCall(request) {
          const now = Math.floor((yield* Clock.currentTimeMillis) / 1e3);
          const nonce = yield* Effect15.sync(
            () => base64url2(crypto.getRandomValues(new Uint8Array(16)))
          );
          const token = yield* serviceToken(
            {
              aud: audience,
              exp: now + 60,
              iat: now,
              iss: identity.did,
              jti: nonce,
              lxm: request.nsid
            },
            yield* importSigning(identity)
          );
          const url = new URL(
            request.nsid.startsWith("/") ? request.nsid : `/xrpc/${request.nsid}`,
            endpoint
          );
          if (request.params !== void 0) {
            for (const [name, value] of Object.entries(request.params)) {
              if (Schema34.is(Schema34.String)(value) || Schema34.is(Schema34.Finite)(value) || Schema34.is(Schema34.Boolean)(value)) {
                url.searchParams.set(name, String(value));
              }
            }
          }
          let outgoing = HttpClientRequest.make(request.method)(
            url.href
          ).pipe(HttpClientRequest.bearerToken(token));
          if (request.input !== void 0) {
            outgoing = yield* HttpClientRequest.bodyJson(
              outgoing,
              request.input
            );
          }
          const response = yield* http.execute(outgoing);
          const body = yield* response.text;
          const json2 = yield* Schema34.decodeUnknownEffect(
            Schema34.fromJsonString(Schema34.toEncoded(Data))
          )(body).pipe(Effect15.result);
          if (Result2.isFailure(json2)) {
            return { body, kind: "text", status: response.status };
          }
          return {
            body: json2.success,
            kind: "json",
            status: response.status
          };
        },
        Effect15.mapError(
          () => new TransportFailure({
            cause: null,
            reason: "Service-auth HTTP call failed"
          })
        )
      )
    });
  })
);

// packages/lexicon/src/mailbox.subscribe.ts
import { Effect as Effect16, Schema as Schema35 } from "effect";
var Auth = Schema35.StructWithRest(
  Schema35.Struct({ token: lexString({ type: "string" }) }),
  [Schema35.Record(Schema35.String, Data)]
);
var Params16 = Schema35.StructWithRest(
  Schema35.Struct({
    generation: Schema35.Int.check(
      Schema35.isGreaterThanOrEqualTo(1),
      Schema35.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema35.brand("Lexicon:tid")
    ),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema35.brand("Lexicon:did")
    )
  }),
  [Schema35.Record(Schema35.String, Data)]
);
var Message = Schema35.Union([
  Schema35.StructWithRest(
    Schema35.Struct({
      $type: Schema35.Literal("sh.mschf.ratking.mailbox.subscribe#notice"),
      seq: Schema35.Int.check(
        Schema35.isGreaterThanOrEqualTo(0),
        Schema35.isLessThanOrEqualTo(9007199254740991)
      )
    }),
    [Schema35.Record(Schema35.String, Data)]
  ),
  TaggedMap.check(
    Schema35.makeFilter(
      (value) => !["sh.mschf.ratking.mailbox.subscribe#notice"].includes(value.$type),
      { expected: "unknown union tag only" }
    )
  )
]);
var ParamsFromQuery6 = Schema35.StructWithRest(
  Schema35.Struct({
    generation: Schema35.FiniteFromString,
    leaseId: Schema35.String,
    recipientDid: Schema35.String
  }),
  [Schema35.Record(Schema35.String, Data)]
).pipe(Schema35.decodeTo(Params16));
var encodeParams11 = Effect16.fn("lexicon.encodeParams")(
  function* encodeParams12(params) {
    return entries(
      yield* Schema35.decodeUnknownEffect(Params2)(
        yield* Schema35.encodeEffect(ParamsFromQuery6)(params)
      )
    );
  }
);
var decodeParams11 = Effect16.fn("lexicon.decodeParams")(
  function* decodeParams12(entries2) {
    return yield* Schema35.decodeUnknownEffect(ParamsFromQuery6)(
      parameters(entries2)
    );
  }
);
var Method15 = {
  nsid: "sh.mschf.ratking.mailbox.subscribe",
  params: Params16,
  path: "/xrpc/sh.mschf.ratking.mailbox.subscribe"
};
var Notice = Schema35.StructWithRest(
  Schema35.Struct({
    seq: Schema35.Int.check(
      Schema35.isGreaterThanOrEqualTo(0),
      Schema35.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema35.Record(Schema35.String, Data)]
);

// packages/mailbox-client/src/watch.ts
import {
  Clock as Clock2,
  Context as Context5,
  Duration,
  Effect as Effect17,
  Option as Option2,
  Predicate,
  Schedule,
  Schema as Schema36,
  Stream
} from "effect";
import { Socket } from "effect/socket";
var WebSocketPort = class extends Context5.Service()("@rat-king/mailbox-client/WebSocketPort") {
};
var socketError = (error) => {
  if (Predicate.isTagged(error.reason, "SocketCloseError")) {
    if (error.reason.code === 4409) {
      return new MailboxClientError({
        error: "LeaseMismatch",
        reason: "Mailbox subscription lease changed"
      });
    }
    if (error.reason.code === 4401) {
      return new MailboxClientError({
        error: "AuthRequired",
        reason: "Mailbox subscription authentication refused"
      });
    }
  }
  return new MailboxClientError({
    error: "SocketDisconnected",
    reason: "Mailbox subscription disconnected"
  });
};
var watch = (config, poll, afterSeq, fence) => Stream.suspend(() => {
  let checkpoint = afterSeq;
  const connection = Stream.unwrap(
    Effect17.gen(function* connect() {
      if (fence.did !== config.identity.did) {
        return yield* new MailboxClientError({
          reason: "Watch fence DID differs from recipient"
        });
      }
      const params = yield* Schema36.decodeUnknownEffect(
        Schema36.toType(Params16)
      )({
        generation: fence.generation,
        leaseId: fence.leaseId,
        recipientDid: config.identity.did
      }).pipe(Effect17.mapError(clientError));
      const url = new URL(Method15.path, config.endpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      for (const [name, value] of yield* encodeParams11(params).pipe(
        Effect17.mapError(clientError)
      )) {
        url.searchParams.set(name, value);
      }
      const port = yield* Effect17.serviceOption(WebSocketPort);
      const socket = yield* Socket.fromWebSocket(
        Effect17.acquireRelease(
          Effect17.try({
            catch: (cause) => new Socket.SocketError({
              reason: new Socket.SocketOpenError({
                cause,
                kind: "Unknown"
              })
            }),
            try: () => Option2.isSome(port) ? port.value.connect(url.href) : new globalThis.WebSocket(url.href)
          }),
          (ws) => Effect17.sync(() => {
            ws.close(1e3);
          })
        ),
        { highWaterMark: 65536 }
      );
      const reader = yield* socket.reader.pipe(Effect17.mapError(socketError));
      const writer = yield* socket.writer;
      const now = Math.floor((yield* Clock2.currentTimeMillis) / 1e3);
      const token = yield* serviceToken(
        {
          aud: config.serviceDid.replace(/(?:#mailbox)?$/u, "#mailbox"),
          exp: now + 60,
          iat: now,
          iss: config.identity.did,
          jti: base64url2(crypto.getRandomValues(new Uint8Array(16))),
          lxm: Method15.nsid
        },
        yield* importSigning(config.identity).pipe(
          Effect17.mapError(clientError)
        )
      ).pipe(Effect17.mapError(clientError));
      const auth = yield* Schema36.encodeEffect(Auth)({
        $type: "sh.mschf.ratking.mailbox.subscribe#auth",
        token
      }).pipe(Effect17.mapError(clientError));
      yield* writer.write(JSON.stringify(auth)).pipe(Effect17.mapError(socketError));
      const receiveNotice = Effect17.gen(function* receiveNotice2() {
        const frames = yield* reader.pull.pipe(Effect17.mapError(socketError));
        for (const frame of frames) {
          yield* Schema36.decodeUnknownEffect(
            Schema36.fromJsonString(Notice)
          )(
            Schema36.is(Schema36.String)(frame) ? frame : new TextDecoder().decode(frame)
          ).pipe(Effect17.mapError(clientError));
        }
      });
      yield* receiveNotice;
      const notices = Stream.fromEffectRepeat(
        receiveNotice.pipe(Effect17.flatMap(() => poll(checkpoint)))
      );
      return Stream.fromEffect(Effect17.suspend(() => poll(checkpoint))).pipe(
        Stream.concat(notices)
      );
    })
  );
  return connection.pipe(
    Stream.filter((batch) => batch.events.length > 0),
    Stream.tap(
      (batch) => Effect17.sync(() => {
        checkpoint = batch.throughSeq;
      })
    ),
    Stream.retry(
      Schedule.exponential("100 millis").pipe(
        Schedule.jittered,
        Schedule.modifyDelay(
          ({ duration }) => Effect17.succeed(Math.min(5e3, Duration.toMillis(duration)))
        ),
        Schedule.while(
          ({ input }) => input.error === "SocketDisconnected"
        )
      )
    )
  );
});

// packages/mailbox-client/src/mailbox.ts
var sendIntent = (opts) => ({
  wakeReason: opts?.wakeReason ?? "to",
  woke: opts?.woke ?? true
});
var RatKingMailbox = class extends Context6.Service()("@rat-king/mailbox-client/RatKingMailbox") {
};
var layer = (config, resolverLayer = staticResolver(config.documents)) => Layer4.effect(
  RatKingMailbox,
  Effect18.gen(function* makeMailbox() {
    const client = yield* MailboxClient;
    const transport = yield* Transport;
    const resolver = yield* DidResolver;
    const { identity } = config;
    const list = Effect18.fn("RatKingMailbox.list")(
      (params) => Schema37.decodeUnknownEffect(Schema37.toType(Params9))({
        ...params,
        recipientDid: identity.did
      }).pipe(Effect18.flatMap(client.list), Effect18.mapError(clientError))
    );
    const poll = Effect18.fn("RatKingMailbox.poll")(function* poll2(afterSeq) {
      const first = yield* list({ afterSeq });
      const events = [...first.events];
      let { cursor } = first;
      while (cursor !== void 0) {
        const page = yield* list({ afterSeq, cursor });
        if (page.throughSeq !== first.throughSeq) {
          return yield* new MailboxClientError({
            reason: "Snapshot watermark changed during pagination"
          });
        }
        events.push(...page.events);
        ({ cursor } = page);
      }
      return { events, throughSeq: first.throughSeq };
    });
    return RatKingMailbox.of({
      ...attentionClient(client, identity),
      ack: Effect18.fn("RatKingMailbox.ack")(
        (input) => Schema37.decodeUnknownEffect(Schema37.toType(Input6))({
          ...input,
          recipientDid: identity.did
        }).pipe(Effect18.flatMap(client.ack), Effect18.mapError(clientError))
      ),
      deliver: Effect18.fn("RatKingMailbox.deliver")(
        (input) => Schema37.decodeUnknownEffect(Schema37.toType(Input7))({
          ...input,
          recipientDid: identity.did
        }).pipe(Effect18.flatMap(client.deliver), Effect18.mapError(clientError))
      ),
      lease: {
        acquire: Effect18.fn("RatKingMailbox.lease.acquire")(
          (input) => Schema37.decodeUnknownEffect(Schema37.toType(Input10))(
            input
          ).pipe(
            Effect18.flatMap(client.acquireLease),
            Effect18.map((output) => output.lease),
            Effect18.mapError(clientError)
          )
        ),
        release: Effect18.fn("RatKingMailbox.lease.release")(
          (input) => Schema37.decodeUnknownEffect(Schema37.toType(Input11))(
            input
          ).pipe(
            Effect18.flatMap(client.releaseLease),
            Effect18.mapError(clientError)
          )
        ),
        renew: Effect18.fn("RatKingMailbox.lease.renew")(
          (input) => Schema37.decodeUnknownEffect(Schema37.toType(Input12))(input).pipe(
            Effect18.flatMap(client.renewLease),
            Effect18.map((output) => output.lease),
            Effect18.mapError(clientError)
          )
        ),
        resolve: Effect18.fn("RatKingMailbox.lease.resolve")(
          (did) => Schema37.decodeUnknownEffect(Schema37.toType(Params14))({
            did
          }).pipe(
            Effect18.flatMap(client.resolveLease),
            Effect18.map((output) => output.lease),
            Effect18.mapError(clientError)
          )
        )
      },
      list,
      open: Effect18.fn("RatKingMailbox.open")(function* open3(input) {
        const envelope = yield* Schema37.decodeUnknownEffect(
          Schema37.toType(EncryptedEnvelope)
        )(input);
        const payload = yield* open({
          envelope,
          recipientDid: identity.did,
          recipientKey: yield* importAgreement(identity),
          recipientKeyId: `${identity.did}#encryption`,
          resolveSigningKey: (did, keyId) => resolver.resolve(did, keyId, "authentication").pipe(
            Effect18.mapError(
              () => new EnvelopeFailure({
                reason: "Unauthorized sender signing key"
              })
            )
          )
        });
        const body = yield* Effect18.try({
          catch: () => new MailboxClientError({ reason: "Invalid UTF-8 body" }),
          try: () => new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: false
          }).decode(payload.body)
        });
        const carbonCopy = yield* Schema37.decodeUnknownEffect(
          Schema37.fromJsonString(
            Schema37.Struct({
              $type: Schema37.Literal("sh.mschf.ratking.mailbox.cc"),
              body: Schema37.String,
              primary: Schema37.Struct({
                messageId: Schema37.String,
                recipientDid: Schema37.String,
                senderDid: Schema37.String
              })
            })
          )
        )(body).pipe(Effect18.option);
        const result = {
          body,
          encrypted: !plaintext(envelope),
          senderDid: payload.aad.senderDid,
          tid: payload.aad.messageId,
          verified: true
        };
        if (Option3.isSome(carbonCopy)) {
          if (carbonCopy.value.primary.senderDid !== payload.aad.senderDid || carbonCopy.value.primary.messageId !== payload.replyTo?.messageId || payload.replyTo.senderDid !== payload.aad.senderDid) {
            return yield* new MailboxClientError({
              reason: "Invalid CC primary link"
            });
          }
          result.cc = carbonCopy.value.primary;
          result.body = carbonCopy.value.body;
        }
        if (payload.replyTo !== void 0) {
          result.replyTo = payload.replyTo;
        }
        if (payload.urgent !== void 0) {
          result.urgent = payload.urgent;
        }
        return result;
      }, Effect18.mapError(clientError)),
      poll,
      putDidDocument: Effect18.fn("RatKingMailbox.putDidDocument")(
        (document) => Schema37.decodeUnknownEffect(Schema37.toType(Input))({
          document
        }).pipe(
          Effect18.flatMap(client.putDidDocument),
          Effect18.mapError(clientError)
        )
      ),
      send: Effect18.fn("RatKingMailbox.send")(function* send(to, body, opts) {
        if (opts?.recordType !== void 0) {
          const presence = yield* lookupPresence(to).pipe(
            Effect18.provideService(Transport, transport),
            Effect18.timeoutOption("2 seconds"),
            Effect18.orElseSucceed(() => Option3.none())
          );
          const reason = readerCannotRender(
            to,
            opts.recordType,
            Option3.getOrUndefined(presence)
          );
          if (reason !== void 0) {
            return yield* new MailboxClientError({ reason });
          }
        }
        if (opts?.fence !== void 0 && opts.fence.did !== identity.did) {
          return yield* new MailboxClientError({
            reason: "Send fence DID differs from sender"
          });
        }
        const now = yield* Clock3.currentTimeMillis;
        const messageId = yield* Effect18.sync(() => randomTid(now));
        const aad = {
          messageId,
          recipientDid: to,
          recipientKeyId: `${to}#encryption`,
          senderDid: identity.did
        };
        if (opts?.expiresAt !== void 0) {
          aad.expiresAt = opts.expiresAt;
        }
        const raw = {
          aad,
          body: new TextEncoder().encode(body),
          suite: opts?.encrypt === false ? plaintextSuite : suite,
          version: 1
        };
        if (opts?.replyTo !== void 0) {
          raw.replyTo = opts.replyTo;
        }
        if (opts?.urgent !== void 0) {
          raw.urgent = opts.urgent;
        }
        const payload = yield* Schema37.decodeUnknownEffect(
          Schema37.toType(SigningPayload)
        )(raw);
        const envelope = yield* seal({
          payload,
          recipientKey: yield* resolver.resolve(
            to,
            payload.aad.recipientKeyId,
            "keyAgreement"
          ),
          recipientKeyId: payload.aad.recipientKeyId,
          signingKey: yield* importSigning(identity),
          signingKeyId: `${identity.did}#atproto`
        });
        const input = {
          envelope,
          ...sendIntent(opts)
        };
        if (opts?.fence !== void 0) {
          input.generation = opts.fence.generation;
          input.leaseId = opts.fence.leaseId;
        }
        return yield* client.send(
          yield* Schema37.decodeUnknownEffect(Schema37.toType(Input9))(input)
        );
      }, Effect18.mapError(clientError)),
      watch: (afterSeq, fence) => watch(config, poll, afterSeq, fence)
    });
  })
).pipe(
  Layer4.provide([
    resolverLayer,
    clientLayer.pipe(
      Layer4.provideMerge(
        transportLayer(
          config.endpoint,
          config.serviceDid.replace(/(?:#mailbox)?$/u, "#mailbox"),
          config.identity
        )
      )
    )
  ])
);

// packages/mailbox-client/src/payload.ts
import { Effect as Effect19, Schema as Schema38 } from "effect";
var AgentName = Schema38.String.check(
  Schema38.isPattern(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u)
);
var SUMMARY_MAX = 280;
var SUMMARY_HARD_MAX = 400;
var SUMMARY_WIRE_MAX = SUMMARY_MAX;
var Kind = Schema38.Literals(["message", "ask", "reply", "data"]);
var ReplyRef = Schema38.Struct({
  parent: Schema38.String,
  root: Schema38.String
});
var Payload = Schema38.Struct({
  body: Schema38.String,
  cc: Schema38.optionalKey(Schema38.Array(AgentName)),
  from: AgentName,
  kind: Schema38.optionalKey(Kind),
  label: Schema38.optionalKey(Schema38.String.check(Schema38.isMaxLength(256))),
  quiet: Schema38.optionalKey(Schema38.Literal(true)),
  reply: Schema38.optionalKey(ReplyRef),
  replyTo: Schema38.optionalKey(Schema38.String),
  summary: Schema38.optionalKey(
    Schema38.String.check(Schema38.isMaxLength(SUMMARY_HARD_MAX))
  ),
  thread: Schema38.optionalKey(Schema38.String),
  to: Schema38.optionalKey(AgentName)
});
var PayloadJson = Schema38.fromJsonString(Payload);
var encodePayload = Effect19.fn("RatKing.encodePayload")(
  function* encodePayload2(payload) {
    return yield* Schema38.encodeEffect(PayloadJson)(payload);
  }
);

// packages/lexicon/src/mailbox.getPeerDocument.ts
import { Effect as Effect20, Schema as Schema39 } from "effect";
var Params17 = Schema39.StructWithRest(
  Schema39.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema39.brand("Lexicon:did")
    )
  }),
  [Schema39.Record(Schema39.String, Data)]
);
var Input15 = Schema39.Undefined;
var Output15 = Schema39.StructWithRest(
  Schema39.Struct({ document: DidDocument }),
  [Schema39.Record(Schema39.String, Data)]
);
var ParamsFromQuery7 = Schema39.StructWithRest(
  Schema39.Struct({ did: Schema39.String }),
  [Schema39.Record(Schema39.String, Data)]
).pipe(Schema39.decodeTo(Params17));
var encodeParams13 = Effect20.fn("lexicon.encodeParams")(
  function* encodeParams14(params) {
    return entries(
      yield* Schema39.decodeUnknownEffect(Params2)(
        yield* Schema39.encodeEffect(ParamsFromQuery7)(params)
      )
    );
  }
);
var decodeParams13 = Effect20.fn("lexicon.decodeParams")(
  function* decodeParams14(entries2) {
    return yield* Schema39.decodeUnknownEffect(ParamsFromQuery7)(
      parameters(entries2)
    );
  }
);
var ErrorBody15 = XrpcErrorBody;
var Method16 = {
  defaults: {},
  error: ErrorBody15,
  input: Input15,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.getPeerDocument",
  output: Output15,
  outputEncoding: "application/json",
  params: Params17,
  path: "/xrpc/sh.mschf.ratking.mailbox.getPeerDocument"
};

// packages/mailbox-client/src/prepare.ts
import {
  Clock as Clock5,
  Context as Context7,
  Data as Data2,
  Effect as Effect26,
  Layer as Layer5,
  Match as Match3,
  Predicate as Predicate2,
  Result as Result3,
  Schema as Schema48
} from "effect";

// packages/lexicon/src/attention.receipt.ts
import { Schema as Schema40 } from "effect";
var Main4 = Schema40.StructWithRest(
  Schema40.Struct({
    $type: Schema40.Literal("sh.mschf.ratking.attention.receipt"),
    operation: lexString({
      enum: ["putPreferences", "putStatus"],
      type: "string"
    }).pipe(Schema40.decodeTo(Schema40.Literals(["putPreferences", "putStatus"]))),
    seq: Schema40.Int.check(
      Schema40.isGreaterThanOrEqualTo(1),
      Schema40.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema40.Record(Schema40.String, Data)]
);

// packages/mailbox-client/src/consume.ts
import {
  Clock as Clock4,
  DateTime,
  Duration as Duration2,
  Effect as Effect21,
  Match as Match2,
  Option as Option4,
  Schedule as Schedule2,
  Schema as Schema41,
  Stream as Stream2
} from "effect";
import { createMachine, initialTransition, transition } from "xstate";
var consumerMachine = createMachine({
  context: {},
  id: "mailbox-consumer",
  initial: "acquiring",
  states: {
    acquiring: {
      on: {
        ACQUIRED: { target: "consuming" },
        HELD: { target: "waiting" },
        REFUSED: { target: "closed" }
      }
    },
    closed: { type: "final" },
    consuming: {
      on: { LOST: { target: "releasing" }, STOP: { target: "releasing" } }
    },
    releasing: { on: { RELEASED: { target: "closed" } } },
    waiting: { on: { RETRY: { target: "acquiring" } } }
  }
});
var ATTEMPT_MS = 3e3;
var attemptTimedOut = (reason) => new MailboxClientError({ error: "MailboxUnavailable", reason });
var TIMED_OUT = "Renewal attempt timed out";
var unavailable = (error) => error.status === void 0 ? error.error === void 0 || error.error === "MailboxUnavailable" : error.status >= 500 || error.status === 429;
var expiredRefusal = (error) => error.error === "InvalidTransition" && error.reason === "Expired message";
var settledRefusal = (error) => error.error === "InvalidTransition";
var releasedRefusal = (error) => error.error === "LeaseMismatch";
var consume = (mailbox, did, handler, options) => Effect21.scoped(
  Effect21.gen(function* runConsumer() {
    let [state] = initialTransition(consumerMachine);
    const step = (event) => Effect21.sync(() => {
      [state] = transition(consumerMachine, state, { type: event });
    });
    const acquire = Effect21.gen(function* acquire2() {
      const now = yield* Clock4.currentTimeMillis;
      const input = {
        did,
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(now + 3e5)),
        harness: options.harness
      };
      if (options.renders !== void 0) {
        Object.assign(input, { renders: options.renders });
      }
      if (options.resume !== void 0) {
        if (options.resume.did !== did) {
          return yield* new MailboxClientError({
            reason: "Resume fence identity mismatch"
          });
        }
        Object.assign(input, {
          generation: options.resume.generation,
          leaseId: options.resume.leaseId
        });
      }
      yield* Effect21.logInfo(
        `lease acquire-attempt name=${options.leaseName ?? did} generation=${input.generation ?? "new"} expiresAt=${input.expiresAt} reason=acquire requested`
      );
      return yield* mailbox.lease.acquire(input).pipe(
        Effect21.timeoutOrElse({
          duration: ATTEMPT_MS,
          orElse: () => Effect21.fail(attemptTimedOut("Acquire attempt timed out"))
        }),
        Effect21.tapError(
          (error) => Effect21.logInfo(
            `lease acquire-failed name=${options.leaseName ?? did} generation=${input.generation ?? "new"} expiresAt=${input.expiresAt} reason=${JSON.stringify(error.error ?? error.reason)}`
          )
        ),
        Effect21.catchIf(
          (error) => error.error === "LeaseHeld",
          (error) => Effect21.gen(function* waitHolder() {
            if (options.failOnHeld === true) {
              yield* step("REFUSED");
              return yield* Effect21.fail(error);
            }
            yield* step("HELD");
            const holder = yield* mailbox.lease.resolve(did).pipe(
              Effect21.catchIf(
                (failure3) => failure3.error === "LeaseNotFound",
                () => Effect21.void
              )
            );
            const current2 = yield* Clock4.currentTimeMillis;
            if (holder !== void 0) {
              yield* Effect21.interruptible(
                Effect21.sleep(
                  Math.max(1, Date.parse(holder.expiresAt) - current2)
                )
              );
            }
            yield* step("RETRY");
            return yield* Effect21.fail(error);
          })
        )
      );
    }).pipe(
      Effect21.retry(
        Schedule2.spaced("1 millis").pipe(
          Schedule2.while(
            ({ input }) => input.error === "LeaseHeld" && options.failOnHeld !== true
          )
        )
      )
    );
    const logLease = (event, lease, reason) => Effect21.logInfo(
      `lease ${event} name=${options.leaseName ?? did} generation=${lease.generation} expiresAt=${lease.expiresAt} reason=${JSON.stringify(reason)}`
    );
    let current = yield* Effect21.acquireRelease(
      acquire.pipe(
        Effect21.tap((lease) => logLease("acquire", lease, "acquired"))
      ),
      () => Effect21.gen(function* release() {
        yield* step("STOP");
        yield* mailbox.lease.release({
          did,
          generation: current.generation,
          leaseId: current.leaseId
        }).pipe(
          Effect21.timeoutOrElse({
            duration: ATTEMPT_MS,
            orElse: () => Effect21.fail(attemptTimedOut("Release attempt timed out"))
          }),
          Effect21.tap(() => logLease("release", current, "scope closed")),
          Effect21.catchIf(
            releasedRefusal,
            () => logLease("loss", current, "release fence mismatch")
          ),
          Effect21.tapError(
            (error) => logLease("release-failed", current, error.reason).pipe(
              Effect21.andThen(
                Effect21.logWarning(
                  "Mailbox lease release not confirmed",
                  error
                )
              )
            )
          ),
          Effect21.ignore
        );
        yield* step("RELEASED");
      })
    );
    yield* step("ACQUIRED");
    if (options.onLease !== void 0) {
      yield* options.onLease(current);
    }
    const fence = () => ({
      did,
      generation: current.generation,
      leaseId: current.leaseId
    });
    const lost = (error) => Effect21.gen(function* classifyLoss() {
      yield* step("LOST");
      const actual = yield* mailbox.lease.resolve(did).pipe(
        Effect21.timeout("2 seconds"),
        Effect21.option,
        Effect21.map(Option4.getOrUndefined)
      );
      const now = yield* Clock4.currentTimeMillis;
      let reason = "LeaseRenewalFailed";
      if (Date.parse(current.expiresAt) <= now) {
        reason = "LeaseExpired";
      }
      if (actual !== void 0 && (actual.leaseId !== current.leaseId || actual.generation !== current.generation)) {
        reason = "LeaseTakenOver";
      }
      yield* logLease(
        reason === "LeaseExpired" ? "lapse" : "loss",
        current,
        `${reason}: ${error.reason}`
      );
      return yield* Effect21.fail(
        new MailboxClientError({ error: reason, reason: error.reason })
      );
    });
    let timedOut = false;
    const renew = Effect21.gen(function* renew2() {
      const now = yield* Clock4.currentTimeMillis;
      const remaining = Date.parse(current.expiresAt) - now;
      if (remaining <= 0) {
        return yield* new MailboxClientError({
          error: "LeaseExpired",
          reason: "Lease expired before renewal"
        });
      }
      yield* Effect21.sleep(Math.max(1, Math.floor(remaining / 2)));
      const renewedAt = yield* Clock4.currentTimeMillis;
      const renewal = {
        ...fence(),
        expiresAt: DateTime.formatIso(
          DateTime.makeUnsafe(renewedAt + 3e5)
        )
      };
      if (options.renders !== void 0) {
        Object.assign(renewal, { renders: options.renders });
      }
      current = yield* Effect21.suspend(
        () => Clock4.currentTimeMillis.pipe(
          Effect21.flatMap((time) => {
            const left = Date.parse(current.expiresAt) - time;
            if (left <= 0) {
              return Effect21.fail(
                new MailboxClientError({
                  error: "LeaseExpired",
                  reason: "Lease expired during renewal retries"
                })
              );
            }
            return logLease("renew-attempt", current, "renew requested").pipe(
              Effect21.andThen(mailbox.lease.renew(renewal)),
              Effect21.timeoutOrElse({
                duration: Math.min(left, ATTEMPT_MS),
                orElse: () => Effect21.fail(
                  left > ATTEMPT_MS ? attemptTimedOut(TIMED_OUT) : new MailboxClientError({
                    error: "LeaseExpired",
                    reason: "Renewal exceeded lease expiry"
                  })
                )
              })
            );
          })
        )
      ).pipe(
        Effect21.tapError(
          (error) => Effect21.sync(() => {
            timedOut = error.reason === TIMED_OUT;
          }).pipe(
            Effect21.andThen(logLease("renew-failed", current, error.reason))
          )
        ),
        Effect21.retry(
          Schedule2.spaced("1 second").pipe(
            Schedule2.modifyDelay(
              () => Clock4.currentTimeMillis.pipe(
                Effect21.map(
                  (time) => Duration2.millis(
                    timedOut ? 0 : Math.max(
                      1,
                      Math.min(1e3, Date.parse(current.expiresAt) - time)
                    )
                  )
                )
              )
            ),
            Schedule2.while(
              ({ input }) => Clock4.currentTimeMillis.pipe(
                Effect21.map(
                  (time) => unavailable(input) && Date.parse(current.expiresAt) > time
                )
              )
            )
          )
        )
      );
      yield* logLease("renew", current, "renewed");
      if (options.onLease !== void 0) {
        yield* options.onLease(current);
      }
      return yield* Effect21.void;
    }).pipe(Effect21.repeat(Schedule2.spaced("0 millis")), Effect21.catch(lost));
    const handed = /* @__PURE__ */ new Set();
    const intake = mailbox.watch(options.afterSeq ?? 0, fence()).pipe(
      Stream2.runForEach(
        (batch) => Effect21.forEach(
          batch.events,
          (event) => Effect21.gen(function* accept() {
            if (Schema41.is(Main4)(event) && options.onAttentionReceipt !== void 0) {
              yield* options.onAttentionReceipt(event);
            }
            if (!Schema41.is(MessageEvent)(event)) {
              return;
            }
            const key = JSON.stringify([
              event.receipt.message.senderDid,
              event.receipt.message.messageId
            ]);
            if (options.ackOnReturn === false && handed.has(key)) {
              return;
            }
            const { onSkip, unopenable } = options;
            const skip = (reason) => onSkip === void 0 ? Effect21.void : onSkip({
              messageId: event.receipt.message.messageId,
              reason,
              senderDid: event.receipt.message.senderDid,
              seq: event.seq
            });
            const opened = yield* mailbox.open(event.envelope).pipe(
              Effect21.map(Option4.some),
              Effect21.catch(
                (error) => unopenable === void 0 ? Effect21.fail(error) : unopenable(event, error)
              )
            );
            if (Option4.isNone(opened)) {
              yield* skip("unopenable");
              return;
            }
            const message = opened.value;
            const input = { ...fence(), message: event.receipt.message };
            const delivered = yield* mailbox.deliver(input).pipe(
              Effect21.map(
                ({ receipt }) => Match2.value(receipt.state).pipe(
                  Match2.when(
                    "expired",
                    () => Option4.some("expired")
                  ),
                  Match2.when(
                    "acked",
                    () => Option4.some("settled")
                  ),
                  Match2.orElse(() => Option4.none())
                )
              ),
              Effect21.catchIf(
                expiredRefusal,
                () => Effect21.succeed(Option4.some("expired"))
              ),
              Effect21.catchIf(
                settledRefusal,
                () => Effect21.succeed(Option4.some("settled"))
              )
            );
            if (Option4.isSome(delivered)) {
              yield* skip(delivered.value);
              return;
            }
            const ack = mailbox.ack(input).pipe(
              Effect21.catchIf(settledRefusal, () => Effect21.void),
              Effect21.asVoid
            );
            yield* handler(message, {
              ack,
              redelivered: event.receipt.state === "delivered",
              seq: event.seq
            });
            handed.add(key);
            if (options.ackOnReturn !== false) {
              yield* ack;
            }
          }),
          { discard: true }
        )
      ),
      Effect21.catch((error) => {
        if (Schema41.is(MailboxClientError)(error) && error.error === "LeaseMismatch") {
          return lost(error);
        }
        return Effect21.fail(error);
      })
    );
    yield* Effect21.raceFirst(intake, renew);
  })
);

// packages/lexicon/src/mailbox.nameHealth.ts
import { Effect as Effect22, Schema as Schema42 } from "effect";
var Lease = Schema42.StructWithRest(
  Schema42.Struct({
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema42.brand("Lexicon:datetime")
    ),
    generation: Schema42.Int.check(
      Schema42.isGreaterThanOrEqualTo(1),
      Schema42.isLessThanOrEqualTo(9007199254740991)
    ),
    holder: lexString({ type: "string" }),
    pane: Schema42.optionalKey(lexString({ type: "string" }))
  }),
  [Schema42.Record(Schema42.String, Data)]
);
var Wake = Schema42.StructWithRest(
  Schema42.Struct({
    id: lexString({ format: "tid", type: "string" }).pipe(
      Schema42.brand("Lexicon:tid")
    ),
    recordedAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema42.brand("Lexicon:datetime")
    ),
    sender: lexString({ format: "did", type: "string" }).pipe(
      Schema42.brand("Lexicon:did")
    ),
    woke: Schema42.Boolean
  }),
  [Schema42.Record(Schema42.String, Data)]
);
var Params18 = Schema42.StructWithRest(
  Schema42.Struct({
    name: lexString({ maxLength: 128, type: "string" }),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema42.brand("Lexicon:did")
    )
  }),
  [Schema42.Record(Schema42.String, Data)]
);
var Input16 = Schema42.Undefined;
var Output16 = Schema42.StructWithRest(
  Schema42.Struct({
    complete: Schema42.Boolean,
    lastAck: Schema42.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema42.brand("Lexicon:datetime")
      )
    ),
    lease: Schema42.optionalKey(Lease),
    oldestWake: Schema42.optionalKey(Wake),
    quietUnacked: Schema42.Int.check(
      Schema42.isGreaterThanOrEqualTo(0),
      Schema42.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema42.Record(Schema42.String, Data)]
);
var ParamsFromQuery8 = Schema42.StructWithRest(
  Schema42.Struct({ name: Schema42.String, recipientDid: Schema42.String }),
  [Schema42.Record(Schema42.String, Data)]
).pipe(Schema42.decodeTo(Params18));
var encodeParams15 = Effect22.fn("lexicon.encodeParams")(
  function* encodeParams16(params) {
    return entries(
      yield* Schema42.decodeUnknownEffect(Params2)(
        yield* Schema42.encodeEffect(ParamsFromQuery8)(params)
      )
    );
  }
);
var decodeParams15 = Effect22.fn("lexicon.decodeParams")(
  function* decodeParams16(entries2) {
    return yield* Schema42.decodeUnknownEffect(ParamsFromQuery8)(
      parameters(entries2)
    );
  }
);
var ErrorBody16 = XrpcErrorBody;
var Method17 = {
  defaults: {},
  error: ErrorBody16,
  input: Input16,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.nameHealth",
  output: Output16,
  outputEncoding: "application/json",
  params: Params18,
  path: "/xrpc/sh.mschf.ratking.mailbox.nameHealth"
};

// packages/mailbox-client/src/health.ts
import { Effect as Effect23, Schema as Schema43 } from "effect";
var Wake2 = Schema43.Struct({
  at: Schema43.Finite,
  id: Schema43.String,
  sender: Schema43.String
});
var MailboxHealth = Schema43.Struct({
  complete: Schema43.Boolean,
  lastAck: Schema43.NullOr(Schema43.Finite),
  lease: Schema43.NullOr(
    Schema43.Struct({
      expiresAt: Schema43.Finite,
      generation: Schema43.Int,
      holder: Schema43.String,
      pane: Schema43.NullOr(Schema43.String)
    })
  ),
  oldestWake: Schema43.NullOr(Wake2),
  quietUnacked: Schema43.Int.check(Schema43.isGreaterThanOrEqualTo(0))
});
var readMailboxHealth = Effect23.fn("Mailbox.readHealth")(
  function* readMailboxHealth2(transport, did, name) {
    const params = yield* Schema43.decodeUnknownEffect(
      Schema43.toType(Params18)
    )({ name, recipientDid: did });
    const response = yield* transport.request({
      input: void 0,
      method: "GET",
      nsid: Method17.nsid,
      params: yield* Schema43.encodeEffect(Params18)(params)
    });
    if (response.status !== 200 || response.kind !== "json") {
      return yield* new MailboxClientError({
        reason: "Health projection unavailable (operator credentials required)"
      });
    }
    const value = yield* Schema43.decodeUnknownEffect(Output16)(
      response.body
    );
    return yield* Schema43.decodeEffect(MailboxHealth)({
      complete: value.complete,
      lastAck: value.lastAck === void 0 ? null : Date.parse(value.lastAck),
      lease: value.lease === void 0 ? null : {
        expiresAt: Date.parse(value.lease.expiresAt),
        generation: value.lease.generation,
        holder: value.lease.holder,
        pane: value.lease.pane ?? null
      },
      oldestWake: value.oldestWake === void 0 ? null : {
        at: Date.parse(value.oldestWake.recordedAt),
        id: value.oldestWake.id,
        sender: value.oldestWake.sender
      },
      quietUnacked: value.quietUnacked
    });
  },
  (effect) => effect.pipe(Effect23.timeout("10 seconds"), Effect23.mapError(clientError))
);

// packages/lexicon/src/mailbox.listTraffic.ts
import { Effect as Effect24, Schema as Schema44 } from "effect";
var Entry = Schema44.StructWithRest(
  Schema44.Struct({
    body: Schema44.optionalKey(
      lexString({
        description: "UTF-8 body of a signed plaintext message, verified at admission. Absent for encrypted messages.",
        type: "string"
      })
    ),
    ciphertextSize: Schema44.Int.check(
      Schema44.isGreaterThanOrEqualTo(0),
      Schema44.isLessThanOrEqualTo(9007199254740991)
    ),
    messageId: lexString({ format: "tid", type: "string" }).pipe(
      Schema44.brand("Lexicon:tid")
    ),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema44.brand("Lexicon:did")
    ),
    recipientSeq: Schema44.Int.check(
      Schema44.isGreaterThanOrEqualTo(1),
      Schema44.isLessThanOrEqualTo(9007199254740991)
    ),
    senderDid: lexString({ format: "did", type: "string" }).pipe(
      Schema44.brand("Lexicon:did")
    ),
    seq: Schema44.Int.check(
      Schema44.isGreaterThanOrEqualTo(1),
      Schema44.isLessThanOrEqualTo(9007199254740991)
    ),
    state: lexString({
      knownValues: [
        "accepted",
        "queued",
        "delivered",
        "acked",
        "expired",
        "failed"
      ],
      type: "string"
    }),
    time: lexString({ format: "datetime", type: "string" }).pipe(
      Schema44.brand("Lexicon:datetime")
    )
  }),
  [Schema44.Record(Schema44.String, Data)]
);
var Params19 = Schema44.StructWithRest(
  Schema44.Struct({
    cursor: Schema44.optionalKey(lexString({ type: "string" })),
    limit: Schema44.optionalKey(
      Schema44.Int.check(
        Schema44.isGreaterThanOrEqualTo(1),
        Schema44.isLessThanOrEqualTo(100)
      )
    )
  }),
  [Schema44.Record(Schema44.String, Data)]
);
var Input17 = Schema44.Undefined;
var Output17 = Schema44.StructWithRest(
  Schema44.Struct({
    cursor: lexString({ type: "string" }),
    events: Schema44.Array(Entry).check(
      Schema44.isMinLength(0),
      Schema44.isMaxLength(100)
    )
  }),
  [Schema44.Record(Schema44.String, Data)]
);
var ParamsFromQuery9 = Schema44.StructWithRest(
  Schema44.Struct({
    cursor: Schema44.optionalKey(Schema44.String),
    limit: Schema44.optionalKey(Schema44.FiniteFromString)
  }),
  [Schema44.Record(Schema44.String, Data)]
).pipe(Schema44.decodeTo(Params19));
var encodeParams17 = Effect24.fn("lexicon.encodeParams")(
  function* encodeParams18(params) {
    return entries(
      yield* Schema44.decodeUnknownEffect(Params2)(
        yield* Schema44.encodeEffect(ParamsFromQuery9)(params)
      )
    );
  }
);
var decodeParams17 = Effect24.fn("lexicon.decodeParams")(
  function* decodeParams18(entries2) {
    return yield* Schema44.decodeUnknownEffect(ParamsFromQuery9)(
      parameters(entries2)
    );
  }
);
var ErrorBody17 = XrpcErrorBody;
var Method18 = {
  defaults: { limit: 50 },
  error: ErrorBody17,
  input: Input17,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.listTraffic",
  output: Output17,
  outputEncoding: "application/json",
  params: Params19,
  path: "/xrpc/sh.mschf.ratking.mailbox.listTraffic"
};

// packages/lexicon/turns.ts
import { Array as Arr, Schema as Schema46 } from "effect";

// packages/lexicon/src/agentgraph.turn.ts
import { Schema as Schema45 } from "effect";
var Main5 = Schema45.StructWithRest(
  Schema45.Struct({
    $type: Schema45.Literal("sh.mschf.agentgraph.turn"),
    agent: lexString({ type: "string" }).check(
      Schema45.isPattern(
        /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u
      )
    ),
    at: lexString({ format: "datetime", type: "string" }).pipe(
      Schema45.brand("Lexicon:datetime")
    ),
    generation: Schema45.optionalKey(
      Schema45.Int.check(
        Schema45.isGreaterThanOrEqualTo(0),
        Schema45.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    reason: Schema45.optionalKey(
      lexString({ type: "string" }).check(Schema45.isMaxLength(280))
    ),
    session: lexString({ type: "string" }).check(
      Schema45.isMinLength(1),
      Schema45.isMaxLength(128)
    ),
    state: lexString({
      enum: ["working", "done", "blocked", "idle", "crashed"],
      type: "string"
    }).pipe(
      Schema45.decodeTo(
        Schema45.Literals(["working", "done", "blocked", "idle", "crashed"])
      )
    ),
    stopReason: Schema45.optionalKey(
      lexString({
        enum: ["stop", "aborted", "error", "length"],
        type: "string"
      }).pipe(
        Schema45.decodeTo(Schema45.Literals(["stop", "aborted", "error", "length"]))
      )
    ),
    turnId: lexString({ type: "string" }).check(
      Schema45.isPattern(/^.+:[0-9]+$/u),
      Schema45.isMaxLength(128)
    ),
    version: lexString({ enum: ["0.1"], type: "string" }).pipe(
      Schema45.decodeTo(Schema45.Literals(["0.1"]))
    )
  }),
  [Schema45.Record(Schema45.String, Data)]
).check(
  Schema45.makeFilter(
    (value) => Object.keys(value).every(
      (key) => [
        "$type",
        "agent",
        "at",
        "generation",
        "reason",
        "session",
        "state",
        "stopReason",
        "turnId",
        "version"
      ].includes(key)
    ),
    {
      expected: "only allowed keys: $type, agent, at, generation, reason, session, state, stopReason, turnId, version"
    }
  )
).check(
  Schema45.makeFilter(
    (value) => !("generation" in value) || value.state === "crashed",
    { expected: "generation: allowed only when state is crashed" }
  )
);

// packages/lexicon/turns.ts
var Turn = Main5.check(
  Schema46.makeFilter(
    (value) => value.turnId.startsWith(`${value.session}:`) && Number.isSafeInteger(
      Number(value.turnId.slice(value.session.length + 1))
    ) && (value.stopReason === void 0 || value.state === "done") && (value.reason === void 0 || value.state === "blocked" || value.state === "crashed"),
    {
      expected: "session:n turnId; stopReason only on done; reason only on blocked or crashed"
    }
  )
);

// packages/mailbox-client/src/turn-health.ts
import { Effect as Effect25, Option as Option5, Schema as Schema47 } from "effect";
var readTurnHealth = Effect25.fn("Mailbox.readTurnHealth")(
  function* readTurnHealth2(transport, did, name, session) {
    let cursor = "0";
    let last = null;
    for (let page = 0; page < 100; page += 1) {
      const response = yield* transport.request({
        input: void 0,
        method: "GET",
        nsid: Method18.nsid,
        params: { cursor, limit: 100 }
      });
      if (response.status !== 200 || response.kind !== "json") {
        return yield* new MailboxClientError({
          reason: "Turn record observations unavailable"
        });
      }
      const output = yield* Schema47.decodeUnknownEffect(Output17)(
        response.body
      );
      for (const event of output.events) {
        if (event.senderDid !== did) {
          continue;
        }
        const text = event.body ?? "";
        const payload = Schema47.decodeOption(PayloadJson)(text);
        const body = Option5.match(payload, {
          onNone: () => text,
          onSome: (value) => value.body
        });
        const record = Schema47.decodeOption(Schema47.fromJsonString(Turn))(body);
        if (Option5.isSome(record) && record.value.agent === name && record.value.session === session && (last === null || record.value.at > last.at)) {
          last = {
            at: record.value.at,
            state: record.value.state,
            turnId: record.value.turnId
          };
        }
      }
      ({ cursor } = output);
      if (output.events.length < 100) {
        return last;
      }
    }
    return yield* new MailboxClientError({
      reason: "Turn record scan exceeded 100 pages"
    });
  },
  (effect) => effect.pipe(Effect25.timeout("10 seconds"), Effect25.mapError(clientError))
);

// packages/mailbox-client/src/prepare.ts
var ownBrand = /* @__PURE__ */ Symbol("OwnIdentity");
var identities = /* @__PURE__ */ new WeakMap();
var ownIdentity = Effect26.fn("Mailbox.ownIdentity")(
  function* ownIdentity2(value) {
    const identity = yield* Schema48.decodeUnknownEffect(Identity)(value).pipe(
      Effect26.mapError(clientError)
    );
    yield* importSigning(identity).pipe(Effect26.mapError(clientError));
    const handle = Object.freeze({
      [ownBrand]: true
    });
    identities.set(handle, identity);
    return handle;
  }
);
var SendOutcomes = Data2.taggedEnum();
var PreparedMailbox = class extends Context7.Service()("mailbox/PreparedMailbox") {
};
var seal3 = Effect26.fn("Mailbox.sealPayload")(function* seal4(to, body, opts) {
  const client = yield* PreparedMailbox;
  return yield* client.sealPayload(to, body, opts);
});
var sendSealed = Effect26.fn("Mailbox.sendSealed")(function* sendSealed2(envelope, fence) {
  const client = yield* PreparedMailbox;
  return yield* client.sendSealed(envelope, fence);
});
var failure2 = (reason) => new MailboxClientError({ reason });
var directIntent = { wakeReason: "to", woke: true };
var sameDocument = (a, b) => base64url2(canonical(a)) === base64url2(canonical(b));
var prepare = Effect26.fn("Mailbox.prepare")(function* prepare2(options) {
  const identity = identities.get(options.own);
  if (identity === void 0) {
    return yield* failure2("Unknown own identity handle");
  }
  const peers = /* @__PURE__ */ new Map();
  for (const value of options.peers) {
    const peer = yield* Schema48.decodeUnknownEffect(Document)(value).pipe(
      Effect26.mapError(clientError)
    );
    const existing = peers.get(peer.id);
    if (existing !== void 0 && !sameDocument(existing, peer)) {
      return yield* failure2("Conflicting peer documents");
    }
    peers.set(peer.id, peer);
  }
  const resolverLayer = documentResolver(
    (did) => Effect26.sync(() => peers.get(did))
  );
  const config = {
    documents: yield* Schema48.decodeUnknownEffect(
      Schema48.Array(Schema48.toType(DidDocument))
    )(options.peers).pipe(Effect26.mapError(clientError)),
    endpoint: options.endpoint,
    identity,
    serviceDid: options.serviceDid
  };
  const authLayer = transportLayer(
    options.endpoint,
    `${options.serviceDid.replace(/#mailbox$/u, "")}#mailbox`,
    identity
  );
  const context = yield* Layer5.build(
    clientLayer.pipe(Layer5.provide(authLayer))
  );
  const client = Context7.get(context, MailboxClient);
  const transportContext = yield* Layer5.build(authLayer);
  const transport = Context7.get(transportContext, Transport);
  const resolverContext = yield* Layer5.build(resolverLayer);
  const resolver = Context7.get(resolverContext, DidResolver);
  const mailboxContext = yield* Layer5.build(layer(config, resolverLayer));
  const mailbox = Context7.get(mailboxContext, RatKingMailbox);
  const signingKey = yield* importSigning(identity).pipe(
    Effect26.mapError(clientError)
  );
  const payloads = /* @__PURE__ */ new WeakMap();
  const copies = /* @__PURE__ */ new WeakMap();
  let consuming = false;
  const sealEnvelopeForPeer = Effect26.fn("Mailbox.seal")(
    function* sealEnvelopeForPeer2(to, body, opts) {
      const now = yield* Clock5.currentTimeMillis;
      const messageId = randomTid(now);
      const text = yield* Effect26.try({
        catch: () => new MailboxClientError({ reason: "Invalid message body factory" }),
        try: () => Match3.value(body).pipe(
          Match3.when(Match3.string, (value) => value),
          Match3.orElse((factory) => factory(messageId))
        )
      });
      const raw = {
        aad: {
          messageId,
          recipientDid: to,
          recipientKeyId: `${to}#encryption`,
          senderDid: identity.did
        },
        body: new TextEncoder().encode(text),
        suite: opts?.encrypt === false ? plaintextSuite : suite,
        version: 1
      };
      if (opts?.expiresAt !== void 0) {
        Object.assign(raw.aad, { expiresAt: opts.expiresAt });
      }
      if (opts?.replyTo !== void 0) {
        Object.assign(raw, { replyTo: opts.replyTo });
      }
      if (opts?.urgent !== void 0) {
        Object.assign(raw, { urgent: opts.urgent });
      }
      const payload = yield* Schema48.decodeUnknownEffect(
        Schema48.toType(SigningPayload)
      )(raw).pipe(Effect26.mapError(clientError));
      const envelope = yield* seal({
        payload,
        recipientKey: yield* resolver.resolve(
          to,
          `${to}#encryption`,
          "keyAgreement"
        ),
        recipientKeyId: `${to}#encryption`,
        signingKey,
        signingKeyId: `${identity.did}#atproto`
      }).pipe(Effect26.mapError(clientError));
      payloads.set(envelope, payload);
      return envelope;
    }
  );
  const submit = Effect26.fn("Mailbox.sendSealed")(function* submit2(envelope, fence, intent = directIntent) {
    if (envelope.aad.senderDid !== identity.did || fence !== void 0 && fence.did !== identity.did) {
      return SendOutcomes.NotAttempted({
        reason: "Sender identity or fence mismatch"
      });
    }
    const raw = { envelope, ...intent };
    if (fence !== void 0) {
      Object.assign(raw, {
        generation: fence.generation,
        leaseId: fence.leaseId
      });
    }
    const decoded = yield* Schema48.decodeUnknownEffect(
      Schema48.toType(Input9)
    )(raw).pipe(Effect26.mapError(clientError), Effect26.result);
    if (Result3.isFailure(decoded)) {
      return SendOutcomes.NotAttempted({ reason: decoded.failure.reason });
    }
    const result = yield* client.send(decoded.success).pipe(Effect26.mapError(clientError), Effect26.result);
    if (Result3.isSuccess(result)) {
      return SendOutcomes.Accepted({ receipt: result.success.receipt });
    }
    const error = result.failure;
    return error.status !== void 0 && error.status >= 400 && error.status < 500 ? SendOutcomes.Rejected({ error }) : SendOutcomes.Uncertain({ error });
  });
  const send = Effect26.fn("Mailbox.send")(function* send2(envelope, opts) {
    if (!peers.has(envelope.aad.recipientDid)) {
      return SendOutcomes.NotAttempted({ reason: "Unknown primary peer" });
    }
    const primary = yield* submit(envelope, opts?.fence, {
      wakeReason: opts?.wakeReason ?? "to",
      woke: opts?.woke ?? true
    });
    if (opts?.cc === void 0) {
      return primary;
    }
    if (plaintext(envelope)) {
      return {
        ...primary,
        cc: SendOutcomes.NotAttempted({
          reason: "Plaintext primary is readable by observers without a CC"
        })
      };
    }
    const payload = payloads.get(envelope);
    const did = opts.cc;
    if (payload === void 0 || !peers.has(did) || did === envelope.aad.recipientDid || !Predicate2.isTagged(primary, "Accepted")) {
      return {
        ...primary,
        cc: SendOutcomes.NotAttempted({
          reason: "CC requires an accepted locally sealed primary and a distinct known peer"
        })
      };
    }
    const ccResult = yield* Effect26.gen(function* carbonCopy() {
      const cached = copies.get(envelope) ?? /* @__PURE__ */ new Map();
      let copy = cached.get(did);
      if (copy === void 0) {
        const body = JSON.stringify({
          $type: "sh.mschf.ratking.mailbox.cc",
          body: new TextDecoder().decode(payload.body),
          primary: {
            messageId: envelope.aad.messageId,
            recipientDid: envelope.aad.recipientDid,
            senderDid: identity.did
          }
        });
        const replyTo = yield* Schema48.decodeUnknownEffect(
          Schema48.toType(MessageRef)
        )({ messageId: envelope.aad.messageId, senderDid: identity.did }).pipe(
          Effect26.mapError(clientError)
        );
        copy = yield* sealEnvelopeForPeer(did, body, { replyTo });
        cached.set(did, copy);
        copies.set(envelope, cached);
      }
      return yield* submit(copy, opts?.fence, {
        wakeReason: "cc",
        woke: false
      });
    }).pipe(
      Effect26.mapError(clientError),
      Effect26.catch(
        (error) => Effect26.succeed(SendOutcomes.NotAttempted({ reason: error.reason }))
      )
    );
    return { ...primary, cc: ccResult };
  });
  const sealPayload = Effect26.fn("Mailbox.sealPayload")(function* sealPayload2(to, body, opts) {
    const from = options.names?.from;
    const recipient = options.names?.peers[to];
    if (from === void 0 || recipient === void 0) {
      return yield* failure2(
        "Payload sealing requires sender and recipient names"
      );
    }
    const envelope = yield* sealEnvelopeForPeer(
      to,
      (id) => {
        const payload = {
          body,
          cc: [],
          from,
          kind: opts?.replyTo === void 0 ? "message" : "reply",
          thread: opts?.thread ?? id,
          to: recipient
        };
        if (opts?.summary !== void 0) {
          Object.assign(payload, { summary: opts.summary });
        }
        if (opts?.replyTo !== void 0) {
          Object.assign(payload, { replyTo: opts.replyTo.messageId });
        }
        return Schema48.encodeSync(PayloadJson)(payload);
      },
      opts
    ).pipe(Effect26.mapError(clientError));
    return { envelope, messageId: envelope.aad.messageId };
  });
  const refresh = Effect26.fn("Mailbox.refresh")(function* refresh2(did) {
    const params = yield* Schema48.decodeUnknownEffect(Params17)({ did }).pipe(
      Effect26.mapError(clientError)
    );
    const response = yield* transport.request({
      input: void 0,
      method: "GET",
      nsid: Method16.nsid,
      params: yield* Schema48.encodeEffect(Params17)(params).pipe(
        Effect26.mapError(clientError)
      )
    }).pipe(Effect26.mapError(clientError));
    if (response.kind !== "json" || response.status !== 200) {
      return yield* new MailboxClientError({
        reason: "Peer directory request refused",
        status: response.status
      });
    }
    const output = yield* Schema48.decodeUnknownEffect(Output15)(
      response.body
    ).pipe(Effect26.mapError(clientError));
    const peer = yield* Schema48.decodeUnknownEffect(Document)(
      output.document
    ).pipe(Effect26.mapError(clientError));
    const existing = peers.get(did);
    if (peer.id !== did || existing !== void 0 && !sameDocument(existing, peer)) {
      return yield* failure2(
        "Peer directory conflict; retained trusted document"
      );
    }
    peers.set(did, peer);
    return peer;
  });
  const presence = (did) => lookupPresence(did).pipe(Effect26.provideService(Transport, transport));
  return {
    consume: (handler, opts) => Effect26.suspend(() => {
      if (consuming) {
        return Effect26.fail(failure2("Consumer already active"));
      }
      consuming = true;
      return consume(mailbox, identity.did, handler, opts).pipe(
        Effect26.ensuring(
          Effect26.sync(() => {
            consuming = false;
          })
        )
      );
    }),
    head: mailbox.list({ afterSeq: 0, limit: 1 }).pipe(Effect26.map(({ throughSeq }) => throughSeq)),
    health: (did, name) => readMailboxHealth(transport, did, name),
    mailbox,
    open: mailbox.open,
    presence,
    refresh,
    resolveLease: mailbox.lease.resolve,
    seal: sealEnvelopeForPeer,
    sealPayload,
    send,
    sendSealed: submit,
    turnHealth: (did, name, session) => readTurnHealth(transport, did, name, session)
  };
});
export {
  AgentName,
  Claims,
  DidResolver,
  Document,
  Documents,
  Identity,
  Kind,
  MailboxClientError,
  Payload,
  PayloadJson,
  PreparedMailbox,
  PrivateJwk,
  RatKingMailbox,
  ReplayAuthority,
  SUMMARY_HARD_MAX,
  SUMMARY_MAX,
  SUMMARY_WIRE_MAX,
  SendOutcomes,
  WebSocketPort,
  attentionBytes,
  authenticateClaims,
  base64url2 as base64url,
  consumerMachine,
  defaultPreferences,
  defaultStatus,
  documentResolver,
  encodePayload,
  fromBasisPoints,
  importAgreement,
  importSigning,
  layer,
  lookupPresence,
  ownIdentity,
  prepare,
  readerCannotRender,
  recordType,
  seal3 as seal,
  sendSealed,
  serviceToken,
  staticResolver,
  tid,
  toBasisPoints,
  transportLayer,
  unbase64url
};
