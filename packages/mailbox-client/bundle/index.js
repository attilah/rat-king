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
import { Context as Context2, Effect as Effect8, Layer, Result, Schema as Schema19 } from "effect";

// packages/lexicon/src/mailbox.ack.ts
import { Schema as Schema8 } from "effect";
var Params2 = Schema8.Undefined;
var Input2 = Schema8.StructWithRest(
  Schema8.Struct({
    generation: Schema8.Int.check(
      Schema8.isGreaterThanOrEqualTo(1),
      Schema8.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema8.brand("Lexicon:tid")
    ),
    message: MessageRef,
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema8.brand("Lexicon:did")
    )
  }),
  [Schema8.Record(Schema8.String, Data)]
);
var Output2 = Schema8.StructWithRest(
  Schema8.Struct({ receipt: Receipt }),
  [Schema8.Record(Schema8.String, Data)]
);
var ErrorBody2 = XrpcErrorBody;
var Method2 = {
  defaults: {},
  error: ErrorBody2,
  input: Input2,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.mailbox.ack",
  output: Output2,
  outputEncoding: "application/json",
  params: Params2,
  path: "/xrpc/sh.mschf.ratking.mailbox.ack"
};

// packages/lexicon/src/mailbox.deliver.ts
import { Schema as Schema9 } from "effect";
var Params3 = Schema9.Undefined;
var Input3 = Schema9.StructWithRest(
  Schema9.Struct({
    generation: Schema9.Int.check(
      Schema9.isGreaterThanOrEqualTo(1),
      Schema9.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema9.brand("Lexicon:tid")
    ),
    message: MessageRef,
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema9.brand("Lexicon:did")
    )
  }),
  [Schema9.Record(Schema9.String, Data)]
);
var Output3 = Schema9.StructWithRest(
  Schema9.Struct({ receipt: Receipt }),
  [Schema9.Record(Schema9.String, Data)]
);
var ErrorBody3 = XrpcErrorBody;
var Method3 = {
  defaults: {},
  error: ErrorBody3,
  input: Input3,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.mailbox.deliver",
  output: Output3,
  outputEncoding: "application/json",
  params: Params3,
  path: "/xrpc/sh.mschf.ratking.mailbox.deliver"
};

// packages/lexicon/src/mailbox.list.ts
import { Effect as Effect6, Schema as Schema11 } from "effect";

// packages/lexicon/src/query.ts
import { Schema as Schema10, SchemaGetter as SchemaGetter2 } from "effect";
var BooleanFromQuery = Schema10.Literals(["true", "false"]).pipe(
  Schema10.decodeTo(Schema10.Boolean, {
    decode: SchemaGetter2.transform((value) => value === "true"),
    encode: SchemaGetter2.transform((value) => value ? "true" : "false")
  })
);
var Value = Schema10.Union([Schema10.String, Schema10.Array(Schema10.String)]);
var Params4 = Schema10.Record(Schema10.String, Value);
var entries = (params) => [...Object.entries(params)].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, value]) => {
  if (Schema10.is(Schema10.String)(value)) {
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
    } else if (Schema10.is(Schema10.String)(previous)) {
      grouped.set(key, [previous, value]);
    } else {
      grouped.set(key, [...previous, value]);
    }
  }
  return Object.fromEntries(grouped);
};

// packages/lexicon/src/mailbox.list.ts
var Params5 = Schema11.StructWithRest(
  Schema11.Struct({
    afterSeq: Schema11.optionalKey(
      Schema11.Int.check(
        Schema11.isGreaterThanOrEqualTo(0),
        Schema11.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    cursor: Schema11.optionalKey(
      lexString({
        description: "Opaque snapshot cursor; keep all other parameters fixed while paginating.",
        type: "string"
      })
    ),
    limit: Schema11.optionalKey(
      Schema11.Int.check(
        Schema11.isGreaterThanOrEqualTo(1),
        Schema11.isLessThanOrEqualTo(100)
      )
    ),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema11.brand("Lexicon:did")
    )
  }),
  [Schema11.Record(Schema11.String, Data)]
);
var Input4 = Schema11.Undefined;
var Output4 = Schema11.StructWithRest(
  Schema11.Struct({
    cursor: Schema11.optionalKey(
      lexString({
        description: "Present only while more entries remain. Checkpoint throughSeq after processing every page.",
        type: "string"
      })
    ),
    events: Schema11.Array(
      Schema11.Union([
        Schema11.StructWithRest(
          Schema11.Struct({
            $type: Schema11.Literal("sh.mschf.ratking.defs#messageEvent"),
            envelope: EncryptedEnvelope,
            receipt: Receipt,
            seq: Schema11.Int.check(
              Schema11.isGreaterThanOrEqualTo(1),
              Schema11.isLessThanOrEqualTo(9007199254740991)
            )
          }),
          [Schema11.Record(Schema11.String, Data)]
        ),
        Schema11.StructWithRest(
          Schema11.Struct({
            $type: Schema11.Literal("sh.mschf.ratking.defs#receiptEvent"),
            receipt: Receipt,
            seq: Schema11.Int.check(
              Schema11.isGreaterThanOrEqualTo(1),
              Schema11.isLessThanOrEqualTo(9007199254740991)
            )
          }),
          [Schema11.Record(Schema11.String, Data)]
        ),
        TaggedMap.check(
          Schema11.makeFilter(
            (value) => ![
              "sh.mschf.ratking.defs#messageEvent",
              "sh.mschf.ratking.defs#receiptEvent"
            ].includes(value.$type),
            { expected: "unknown union tag only" }
          )
        )
      ])
    ).check(Schema11.isMinLength(0), Schema11.isMaxLength(100)),
    throughSeq: Schema11.Int.check(
      Schema11.isGreaterThanOrEqualTo(0),
      Schema11.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema11.Record(Schema11.String, Data)]
);
var ParamsFromQuery = Schema11.StructWithRest(
  Schema11.Struct({
    afterSeq: Schema11.optionalKey(Schema11.FiniteFromString),
    cursor: Schema11.optionalKey(Schema11.String),
    limit: Schema11.optionalKey(Schema11.FiniteFromString),
    recipientDid: Schema11.String
  }),
  [Schema11.Record(Schema11.String, Data)]
).pipe(Schema11.decodeTo(Params5));
var encodeParams = Effect6.fn("lexicon.encodeParams")(
  function* encodeParams2(params) {
    return entries(
      yield* Schema11.decodeUnknownEffect(Params4)(
        yield* Schema11.encodeEffect(ParamsFromQuery)(params)
      )
    );
  }
);
var decodeParams = Effect6.fn("lexicon.decodeParams")(
  function* decodeParams2(entries2) {
    return yield* Schema11.decodeUnknownEffect(ParamsFromQuery)(
      parameters(entries2)
    );
  }
);
var ErrorBody4 = XrpcErrorBody;
var Method4 = {
  defaults: { limit: 50 },
  error: ErrorBody4,
  input: Input4,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.list",
  output: Output4,
  outputEncoding: "application/json",
  params: Params5,
  path: "/xrpc/sh.mschf.ratking.mailbox.list"
};

// packages/lexicon/src/mailbox.send.ts
import { Schema as Schema12 } from "effect";
var Params6 = Schema12.Undefined;
var Input5 = Schema12.StructWithRest(
  Schema12.Struct({
    envelope: EncryptedEnvelope,
    generation: Schema12.optionalKey(
      Schema12.Int.check(
        Schema12.isGreaterThanOrEqualTo(1),
        Schema12.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    leaseId: Schema12.optionalKey(
      lexString({ format: "tid", type: "string" }).pipe(
        Schema12.brand("Lexicon:tid")
      )
    )
  }),
  [Schema12.Record(Schema12.String, Data)]
);
var Output5 = Schema12.StructWithRest(
  Schema12.Struct({ receipt: Receipt }),
  [Schema12.Record(Schema12.String, Data)]
);
var ErrorBody5 = XrpcErrorBody;
var Method5 = {
  defaults: {},
  error: ErrorBody5,
  input: Input5,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.mailbox.send",
  output: Output5,
  outputEncoding: "application/json",
  params: Params6,
  path: "/xrpc/sh.mschf.ratking.mailbox.send"
};

// packages/lexicon/src/runtime.acquireLease.ts
import { Schema as Schema14 } from "effect";

// packages/lexicon/src/runtime.lease.ts
import { Schema as Schema13 } from "effect";
var Claude = Schema13.StructWithRest(
  Schema13.Struct({
    executionId: Schema13.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);
var Codex = Schema13.StructWithRest(
  Schema13.Struct({
    executionId: Schema13.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);
var Main = Schema13.StructWithRest(
  Schema13.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema13.brand("Lexicon:did")
    ),
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema13.brand("Lexicon:datetime")
    ),
    generation: Schema13.Int.check(
      Schema13.isGreaterThanOrEqualTo(1),
      Schema13.isLessThanOrEqualTo(9007199254740991)
    ),
    harness: Schema13.Union([
      Schema13.StructWithRest(
        Schema13.Struct({
          $type: Schema13.Literal("sh.mschf.ratking.runtime.lease#pi"),
          executionId: Schema13.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema13.Record(Schema13.String, Data)]
      ),
      Schema13.StructWithRest(
        Schema13.Struct({
          $type: Schema13.Literal("sh.mschf.ratking.runtime.lease#claude"),
          executionId: Schema13.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema13.Record(Schema13.String, Data)]
      ),
      Schema13.StructWithRest(
        Schema13.Struct({
          $type: Schema13.Literal("sh.mschf.ratking.runtime.lease#codex"),
          executionId: Schema13.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema13.Record(Schema13.String, Data)]
      ),
      Schema13.StructWithRest(
        Schema13.Struct({
          $type: Schema13.Literal("sh.mschf.ratking.runtime.lease#opencode"),
          executionId: Schema13.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema13.Record(Schema13.String, Data)]
      ),
      Schema13.StructWithRest(
        Schema13.Struct({
          $type: Schema13.Literal("sh.mschf.ratking.runtime.lease#other"),
          executionId: Schema13.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          kind: lexString({
            description: "Harness adapter identifier.",
            type: "string"
          }),
          paneId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema13.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema13.Record(Schema13.String, Data)]
      ),
      TaggedMap.check(
        Schema13.makeFilter(
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
    issuedAt: Schema13.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema13.brand("Lexicon:datetime")
      )
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema13.brand("Lexicon:tid")
    ),
    renders: Schema13.optionalKey(
      Schema13.Array(lexString({ type: "string" })).check(
        Schema13.isMinLength(0),
        Schema13.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);
var Opencode = Schema13.StructWithRest(
  Schema13.Struct({
    executionId: Schema13.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);
var Other = Schema13.StructWithRest(
  Schema13.Struct({
    executionId: Schema13.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    kind: lexString({
      description: "Harness adapter identifier.",
      type: "string"
    }),
    paneId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);
var Pi = Schema13.StructWithRest(
  Schema13.Struct({
    executionId: Schema13.optionalKey(
      lexString({
        description: "Optional run inside the bound session.",
        type: "string"
      })
    ),
    paneId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local pane identifier, never a host address.",
        type: "string"
      })
    ),
    sessionId: Schema13.optionalKey(
      lexString({
        description: "Opaque adapter-local session identifier, never identity.",
        type: "string"
      })
    )
  }),
  [Schema13.Record(Schema13.String, Data)]
);

// packages/lexicon/src/runtime.acquireLease.ts
var Params7 = Schema14.Undefined;
var Input6 = Schema14.StructWithRest(
  Schema14.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema14.brand("Lexicon:did")
    ),
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema14.brand("Lexicon:datetime")
    ),
    generation: Schema14.optionalKey(
      Schema14.Int.check(
        Schema14.isGreaterThanOrEqualTo(1),
        Schema14.isLessThanOrEqualTo(9007199254740991)
      )
    ),
    harness: Schema14.Union([
      Schema14.StructWithRest(
        Schema14.Struct({
          $type: Schema14.Literal("sh.mschf.ratking.runtime.lease#pi"),
          executionId: Schema14.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema14.Record(Schema14.String, Data)]
      ),
      Schema14.StructWithRest(
        Schema14.Struct({
          $type: Schema14.Literal("sh.mschf.ratking.runtime.lease#claude"),
          executionId: Schema14.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema14.Record(Schema14.String, Data)]
      ),
      Schema14.StructWithRest(
        Schema14.Struct({
          $type: Schema14.Literal("sh.mschf.ratking.runtime.lease#codex"),
          executionId: Schema14.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema14.Record(Schema14.String, Data)]
      ),
      Schema14.StructWithRest(
        Schema14.Struct({
          $type: Schema14.Literal("sh.mschf.ratking.runtime.lease#opencode"),
          executionId: Schema14.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          paneId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema14.Record(Schema14.String, Data)]
      ),
      Schema14.StructWithRest(
        Schema14.Struct({
          $type: Schema14.Literal("sh.mschf.ratking.runtime.lease#other"),
          executionId: Schema14.optionalKey(
            lexString({
              description: "Optional run inside the bound session.",
              type: "string"
            })
          ),
          kind: lexString({
            description: "Harness adapter identifier.",
            type: "string"
          }),
          paneId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local pane identifier, never a host address.",
              type: "string"
            })
          ),
          sessionId: Schema14.optionalKey(
            lexString({
              description: "Opaque adapter-local session identifier, never identity.",
              type: "string"
            })
          )
        }),
        [Schema14.Record(Schema14.String, Data)]
      ),
      TaggedMap.check(
        Schema14.makeFilter(
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
    leaseId: Schema14.optionalKey(
      lexString({ format: "tid", type: "string" }).pipe(
        Schema14.brand("Lexicon:tid")
      )
    ),
    renders: Schema14.optionalKey(
      Schema14.Array(lexString({ type: "string" })).check(
        Schema14.isMinLength(0),
        Schema14.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema14.Record(Schema14.String, Data)]
);
var Output6 = Schema14.StructWithRest(
  Schema14.Struct({ lease: Main }),
  [Schema14.Record(Schema14.String, Data)]
);
var ErrorBody6 = XrpcErrorBody;
var Method6 = {
  defaults: {},
  error: ErrorBody6,
  input: Input6,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.runtime.acquireLease",
  output: Output6,
  outputEncoding: "application/json",
  params: Params7,
  path: "/xrpc/sh.mschf.ratking.runtime.acquireLease"
};

// packages/lexicon/src/runtime.releaseLease.ts
import { Schema as Schema15 } from "effect";
var Params8 = Schema15.Undefined;
var Input7 = Schema15.StructWithRest(
  Schema15.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema15.brand("Lexicon:did")
    ),
    generation: Schema15.Int.check(
      Schema15.isGreaterThanOrEqualTo(1),
      Schema15.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema15.brand("Lexicon:tid")
    )
  }),
  [Schema15.Record(Schema15.String, Data)]
);
var Output7 = Schema15.Undefined;
var ErrorBody7 = XrpcErrorBody;
var Method7 = {
  defaults: {},
  error: ErrorBody7,
  input: Input7,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.runtime.releaseLease",
  output: Output7,
  outputEncoding: "",
  params: Params8,
  path: "/xrpc/sh.mschf.ratking.runtime.releaseLease"
};

// packages/lexicon/src/runtime.renewLease.ts
import { Schema as Schema16 } from "effect";
var Params9 = Schema16.Undefined;
var Input8 = Schema16.StructWithRest(
  Schema16.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema16.brand("Lexicon:did")
    ),
    expiresAt: lexString({ format: "datetime", type: "string" }).pipe(
      Schema16.brand("Lexicon:datetime")
    ),
    generation: Schema16.Int.check(
      Schema16.isGreaterThanOrEqualTo(1),
      Schema16.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema16.brand("Lexicon:tid")
    ),
    renders: Schema16.optionalKey(
      Schema16.Array(lexString({ type: "string" })).check(
        Schema16.isMinLength(0),
        Schema16.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema16.Record(Schema16.String, Data)]
);
var Output8 = Schema16.StructWithRest(
  Schema16.Struct({ lease: Main }),
  [Schema16.Record(Schema16.String, Data)]
);
var ErrorBody8 = XrpcErrorBody;
var Method8 = {
  defaults: {},
  error: ErrorBody8,
  input: Input8,
  inputEncoding: "application/json",
  method: "POST",
  nsid: "sh.mschf.ratking.runtime.renewLease",
  output: Output8,
  outputEncoding: "application/json",
  params: Params9,
  path: "/xrpc/sh.mschf.ratking.runtime.renewLease"
};

// packages/lexicon/src/runtime.resolveLease.ts
import { Effect as Effect7, Schema as Schema17 } from "effect";
var Params10 = Schema17.StructWithRest(
  Schema17.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema17.brand("Lexicon:did")
    )
  }),
  [Schema17.Record(Schema17.String, Data)]
);
var Input9 = Schema17.Undefined;
var Output9 = Schema17.StructWithRest(
  Schema17.Struct({ lease: Main }),
  [Schema17.Record(Schema17.String, Data)]
);
var ParamsFromQuery2 = Schema17.StructWithRest(
  Schema17.Struct({ did: Schema17.String }),
  [Schema17.Record(Schema17.String, Data)]
).pipe(Schema17.decodeTo(Params10));
var encodeParams3 = Effect7.fn("lexicon.encodeParams")(
  function* encodeParams4(params) {
    return entries(
      yield* Schema17.decodeUnknownEffect(Params4)(
        yield* Schema17.encodeEffect(ParamsFromQuery2)(params)
      )
    );
  }
);
var decodeParams3 = Effect7.fn("lexicon.decodeParams")(
  function* decodeParams4(entries2) {
    return yield* Schema17.decodeUnknownEffect(ParamsFromQuery2)(
      parameters(entries2)
    );
  }
);
var ErrorBody9 = XrpcErrorBody;
var Method9 = {
  defaults: {},
  error: ErrorBody9,
  input: Input9,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.runtime.resolveLease",
  output: Output9,
  outputEncoding: "application/json",
  params: Params10,
  path: "/xrpc/sh.mschf.ratking.runtime.resolveLease"
};

// packages/lexicon/src/transport.ts
import { Context } from "effect";
var Transport = class extends Context.Service()("@rat-king/lexicon/Transport") {
};

// packages/lexicon/src/xrpc-failure.ts
import { Schema as Schema18 } from "effect";
var XrpcFailure = class extends Schema18.TaggedError()(
  "XrpcFailure",
  {
    error: Schema18.String,
    message: Schema18.optionalKey(Schema18.String),
    response: Schema18.Union([Schema18.String, DataMap]),
    status: Schema18.Int
  }
) {
};

// packages/lexicon/src/mailbox-client.ts
var responseBody = Effect8.fn("lexicon.responseBody")(function* responseBody2(response) {
  if (response.kind !== "json") {
    return yield* new XrpcFailure({
      error: "NonJsonResponse",
      response: response.body,
      status: response.status
    });
  }
  if (response.status < 200 || response.status >= 300) {
    const result = yield* Schema19.decodeUnknownEffect(XrpcErrorBody)(
      response.body
    ).pipe(Effect8.result);
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
  Effect8.gen(function* clientLayer2() {
    const transport = yield* Transport;
    return MailboxClient.of({
      ack: Effect8.fn("lexicon.ack")(function* invoke(input) {
        const body = yield* Schema19.encodeEffect(Input2)(input);
        const response = yield* transport.request({
          input: body,
          method: Method2.method,
          nsid: Method2.nsid,
          params: void 0
        });
        return yield* Schema19.decodeUnknownEffect(Output2)(
          yield* responseBody(response)
        );
      }),
      acquireLease: Effect8.fn("lexicon.acquireLease")(function* invoke(input) {
        const encoded = yield* Schema19.encodeEffect(Input6)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method6.method,
          nsid: Method6.nsid,
          params: void 0
        });
        return yield* Schema19.decodeUnknownEffect(Output6)(
          yield* responseBody(response)
        );
      }),
      deliver: Effect8.fn("lexicon.deliver")(function* invoke(input) {
        const encoded = yield* Schema19.encodeEffect(Input3)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method3.method,
          nsid: Method3.nsid,
          params: void 0
        });
        return yield* Schema19.decodeUnknownEffect(Output3)(
          yield* responseBody(response)
        );
      }),
      list: Effect8.fn("lexicon.list")(function* invoke(params) {
        const encoded = yield* Schema19.encodeEffect(Params5)({
          ...Method4.defaults,
          ...params
        });
        const response = yield* transport.request({
          input: void 0,
          method: Method4.method,
          nsid: Method4.nsid,
          params: encoded
        });
        return yield* Schema19.decodeUnknownEffect(Output4)(
          yield* responseBody(response)
        );
      }),
      putDidDocument: Effect8.fn("lexicon.putDidDocument")(
        function* invoke(input) {
          const encoded = yield* Schema19.encodeEffect(Input)(
            input
          );
          const response = yield* transport.request({
            input: encoded,
            method: Method.method,
            nsid: Method.nsid,
            params: void 0
          });
          return yield* Schema19.decodeUnknownEffect(Output)(
            yield* responseBody(response)
          );
        }
      ),
      releaseLease: Effect8.fn("lexicon.releaseLease")(function* invoke(input) {
        const encoded = yield* Schema19.encodeEffect(Input7)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method7.method,
          nsid: Method7.nsid,
          params: void 0
        });
        if (response.status === 204 && response.kind === "text" && response.body === "") {
          const output = void 0;
          return yield* Schema19.decodeEffect(Output7)(output);
        }
        return yield* Schema19.decodeUnknownEffect(Output7)(
          yield* responseBody(response)
        );
      }),
      renewLease: Effect8.fn("lexicon.renewLease")(function* invoke(input) {
        const encoded = yield* Schema19.encodeEffect(Input8)(input);
        const response = yield* transport.request({
          input: encoded,
          method: Method8.method,
          nsid: Method8.nsid,
          params: void 0
        });
        return yield* Schema19.decodeUnknownEffect(Output8)(
          yield* responseBody(response)
        );
      }),
      resolveLease: Effect8.fn("lexicon.resolveLease")(function* invoke(params) {
        const encoded = yield* Schema19.encodeEffect(Params10)({
          ...Method9.defaults,
          ...params
        });
        const response = yield* transport.request({
          input: void 0,
          method: Method9.method,
          nsid: Method9.nsid,
          params: encoded
        });
        return yield* Schema19.decodeUnknownEffect(Output9)(
          yield* responseBody(response)
        );
      }),
      send: Effect8.fn("lexicon.send")(function* invoke(input) {
        const body = yield* Schema19.encodeEffect(Input5)(input);
        const response = yield* transport.request({
          input: body,
          method: Method5.method,
          nsid: Method5.nsid,
          params: void 0
        });
        return yield* Schema19.decodeUnknownEffect(Output5)(
          yield* responseBody(response)
        );
      })
    });
  })
);

// packages/mailbox-client/src/mailbox.ts
import { Clock as Clock3, Context as Context6, Effect as Effect15, Layer as Layer4, Option as Option3, Schema as Schema30 } from "effect";

// packages/mailbox-client/src/auth.ts
import { Context as Context4, Effect as Effect9, Layer as Layer2, Schema as Schema21 } from "effect";

// packages/mailbox-client/src/auth-failure.ts
import { Schema as Schema20 } from "effect";
var ServiceAuthFailure = class extends Schema20.TaggedError()(
  "XrpcFailure",
  {
    error: Schema20.String,
    message: Schema20.optionalKey(Schema20.String),
    response: Schema20.Record(Schema20.String, Schema20.Json),
    status: Schema20.Int
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
var Claims = Schema21.Struct({
  aud: Schema21.String,
  exp: Schema21.Int,
  iat: Schema21.Int,
  iss: Schema21.String,
  jti: Schema21.String.check(Schema21.isMinLength(16)),
  lxm: Schema21.String
});
var authFailure = (error, status = 400, message = error) => new ServiceAuthFailure({
  error,
  message,
  response: { error, message },
  status
});
var PublicJwk2 = Schema21.Struct({
  crv: Schema21.Literal("P-256"),
  d: Schema21.optionalKey(Schema21.Never),
  kty: Schema21.Literal("EC"),
  x: Schema21.String,
  y: Schema21.String
});
var Document = Schema21.Struct({
  authentication: Schema21.Array(Schema21.String),
  id: Schema21.String,
  keyAgreement: Schema21.Array(Schema21.String),
  verificationMethod: Schema21.Array(
    Schema21.Struct({
      controller: Schema21.String,
      id: Schema21.String,
      publicKeyJwk: PublicJwk2
    })
  )
});
var Documents = Schema21.Array(Document);
var DidResolver = class extends Context4.Service()("mailbox/DidResolver") {
};
var documentResolver = (lookup) => Layer2.succeed(
  DidResolver,
  DidResolver.of({
    resolve: Effect9.fn("DidResolver.resolve")(
      function* resolve(did, keyId, purpose) {
        const document = yield* lookup(did);
        const method = document?.verificationMethod.find(
          (candidate) => candidate.id === keyId && candidate.controller === did
        );
        if (!did.startsWith("did:web:") || !method || document?.[purpose].includes(keyId) !== true) {
          return yield* Effect9.fail(
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
        ).pipe(Effect9.mapError(() => failure("AuthRequired", 401)));
      }
    )
  })
);
var staticResolver = (documents) => documentResolver(
  (did) => Effect9.succeed(documents.find((candidate) => candidate.id === did))
);
var Header = Schema21.Struct({
  alg: Schema21.Literal("ES256"),
  kid: Schema21.optionalKey(Schema21.String),
  typ: Schema21.optionalKey(Schema21.Literal("JWT"))
});
var json = (text) => Effect9.try({
  catch: () => authFailure("AuthRequired", 401),
  try: () => new TextDecoder().decode(unbase64url(text))
});
var authenticateClaims = Effect9.fn("ServiceAuth.authenticateClaims")(
  function* authenticateClaims2(request) {
    const token = request.authorization?.match(
      /^Bearer (?<token>[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u
    )?.groups?.token;
    if (token === void 0 || token === "") {
      return yield* Effect9.fail(authFailure("AuthRequired", 401));
    }
    const [headerText = "", claimsText = "", signatureText = ""] = token.split(".");
    const header = yield* Schema21.decodeUnknownEffect(
      Schema21.fromJsonString(Header)
    )(yield* json(headerText)).pipe(
      Effect9.mapError(() => authFailure("AuthRequired", 401))
    );
    const claims = yield* Schema21.decodeUnknownEffect(
      Schema21.fromJsonString(Claims)
    )(yield* json(claimsText)).pipe(
      Effect9.mapError(() => authFailure("AuthRequired", 401))
    );
    const now = Math.floor(request.now / 1e3);
    if (claims.aud !== request.audience || claims.lxm !== request.nsid || claims.iat > now + (request.skewSeconds ?? 0) || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > 60 || now - claims.iat > 60) {
      return yield* Effect9.fail(
        authFailure("AuthRequired", 401, "Invalid service-auth claims")
      );
    }
    const kid = header.kid ?? "#atproto";
    const keyId = kid.startsWith("#") ? `${claims.iss}${kid}` : kid;
    const resolver = yield* DidResolver;
    const key = yield* resolver.resolve(claims.iss, keyId, "authentication");
    const signature = yield* Effect9.try({
      catch: () => authFailure("AuthRequired", 401),
      try: () => unbase64url(signatureText)
    });
    const valid = yield* verify(
      key,
      new TextEncoder().encode(`${headerText}.${claimsText}`),
      signature
    ).pipe(Effect9.mapError(() => authFailure("AuthRequired", 401)));
    if (!valid) {
      return yield* Effect9.fail(authFailure("AuthRequired", 401));
    }
    const replay = yield* ReplayAuthority;
    yield* replay.consume(claims, request.now);
    return claims;
  }
);
var serviceToken = Effect9.fn("ServiceAuth.sign")(
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

// packages/mailbox-client/src/error.ts
import { Schema as Schema22 } from "effect";
var MailboxClientError = class extends Schema22.TaggedError()(
  "MailboxClientError",
  {
    error: Schema22.optionalKey(Schema22.String),
    reason: Schema22.String,
    status: Schema22.optionalKey(Schema22.Finite)
  }
) {
};
var clientError = (failure3) => {
  if (Schema22.is(MailboxClientError)(failure3)) {
    return failure3;
  }
  if (Schema22.is(XrpcFailure)(failure3)) {
    return new MailboxClientError({
      error: failure3.error,
      reason: failure3.message ?? "Mailbox XRPC call failed",
      status: failure3.status
    });
  }
  return new MailboxClientError({ reason: "Mailbox operation failed" });
};

// packages/mailbox-client/src/identity.ts
import { Schema as Schema23 } from "effect";
var PrivateJwk = Schema23.Struct({
  crv: Schema23.Literal("P-256"),
  d: Schema23.String,
  kty: Schema23.Literal("EC"),
  x: Schema23.String,
  y: Schema23.String
});
var Identity = Schema23.Struct({
  agreement: PrivateJwk,
  did: Schema23.String.check(Schema23.isPattern(/^did:web:/u)),
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

// packages/lexicon/src/mailbox.getPresence.ts
import { Effect as Effect10, Schema as Schema24 } from "effect";
var Params11 = Schema24.StructWithRest(
  Schema24.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema24.brand("Lexicon:did")
    )
  }),
  [Schema24.Record(Schema24.String, Data)]
);
var Input10 = Schema24.Undefined;
var Output10 = Schema24.StructWithRest(
  Schema24.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema24.brand("Lexicon:did")
    ),
    held: Schema24.Boolean,
    lastHeldAt: Schema24.optionalKey(
      lexString({ format: "datetime", type: "string" }).pipe(
        Schema24.brand("Lexicon:datetime")
      )
    ),
    renders: Schema24.optionalKey(
      Schema24.Array(lexString({ type: "string" })).check(
        Schema24.isMinLength(0),
        Schema24.isMaxLength(9007199254740991)
      )
    )
  }),
  [Schema24.Record(Schema24.String, Data)]
);
var ParamsFromQuery3 = Schema24.StructWithRest(
  Schema24.Struct({ did: Schema24.String }),
  [Schema24.Record(Schema24.String, Data)]
).pipe(Schema24.decodeTo(Params11));
var encodeParams5 = Effect10.fn("lexicon.encodeParams")(
  function* encodeParams6(params) {
    return entries(
      yield* Schema24.decodeUnknownEffect(Params4)(
        yield* Schema24.encodeEffect(ParamsFromQuery3)(params)
      )
    );
  }
);
var decodeParams5 = Effect10.fn("lexicon.decodeParams")(
  function* decodeParams6(entries2) {
    return yield* Schema24.decodeUnknownEffect(ParamsFromQuery3)(
      parameters(entries2)
    );
  }
);
var ErrorBody10 = XrpcErrorBody;
var Method10 = {
  defaults: {},
  error: ErrorBody10,
  input: Input10,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.getPresence",
  output: Output10,
  outputEncoding: "application/json",
  params: Params11,
  path: "/xrpc/sh.mschf.ratking.mailbox.getPresence"
};

// packages/mailbox-client/src/record-visibility.ts
import { Effect as Effect11, Option, Schema as Schema25 } from "effect";
var readerCannotRender = (name, type, presence) => type !== "unknown" && presence?.held === true && presence.renders !== void 0 && !presence.renders.some(
  (render) => render.endsWith(".*") ? type.startsWith(render.slice(0, -1)) : type === render
) ? `NOT SENT: ReaderCannotRender. ${name}'s reader doesn't render ${type} (it predates typed records or doesn't declare it). Send prose instead, or ask them to restart.` : void 0;
var recordType = (body) => {
  const result = Schema25.decodeUnknownOption(
    Schema25.fromJsonString(Schema25.Struct({ $type: Schema25.String }))
  )(body);
  return Option.match(result, {
    onNone: () => "unknown",
    onSome: (record) => record.$type
  });
};
var lookupPresence = Effect11.fn("Mailbox.lookupPresence")(
  function* lookupPresence2(did) {
    const transport = yield* Transport;
    const params = yield* Schema25.decodeUnknownEffect(Params11)({
      did
    }).pipe(Effect11.mapError(clientError));
    const response = yield* transport.request({
      input: void 0,
      method: "GET",
      nsid: Method10.nsid,
      params: yield* Schema25.encodeEffect(Params11)(params).pipe(
        Effect11.mapError(clientError)
      )
    }).pipe(Effect11.mapError(clientError));
    if (response.kind !== "json" || response.status !== 200) {
      return yield* new MailboxClientError({
        reason: "Presence request refused"
      });
    }
    return yield* Schema25.decodeUnknownEffect(Output10)(
      response.body
    ).pipe(Effect11.mapError(clientError));
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
import { Schema as Schema26 } from "effect";
var TransportFailure = class extends Schema26.TaggedError()(
  "TransportFailure",
  { cause: Schema26.Defect(), reason: Schema26.String }
) {
};

// packages/mailbox-client/src/transport.ts
import { Clock, Effect as Effect12, Layer as Layer3, Result as Result2, Schema as Schema27 } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
var transportLayer = (endpoint, audience, identity) => Layer3.effect(
  Transport,
  Effect12.gen(function* makeTransport() {
    const http = yield* HttpClient.HttpClient;
    return Transport.of({
      request: Effect12.fn("MailboxCli.request")(
        function* requestCall(request) {
          const now = Math.floor((yield* Clock.currentTimeMillis) / 1e3);
          const nonce = yield* Effect12.sync(
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
              if (Schema27.is(Schema27.String)(value) || Schema27.is(Schema27.Finite)(value) || Schema27.is(Schema27.Boolean)(value)) {
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
          const json2 = yield* Schema27.decodeUnknownEffect(
            Schema27.fromJsonString(Schema27.toEncoded(Data))
          )(body).pipe(Effect12.result);
          if (Result2.isFailure(json2)) {
            return { body, kind: "text", status: response.status };
          }
          return {
            body: json2.success,
            kind: "json",
            status: response.status
          };
        },
        Effect12.mapError(
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
import { Effect as Effect13, Schema as Schema28 } from "effect";
var Auth = Schema28.StructWithRest(
  Schema28.Struct({ token: lexString({ type: "string" }) }),
  [Schema28.Record(Schema28.String, Data)]
);
var Params12 = Schema28.StructWithRest(
  Schema28.Struct({
    generation: Schema28.Int.check(
      Schema28.isGreaterThanOrEqualTo(1),
      Schema28.isLessThanOrEqualTo(9007199254740991)
    ),
    leaseId: lexString({ format: "tid", type: "string" }).pipe(
      Schema28.brand("Lexicon:tid")
    ),
    recipientDid: lexString({ format: "did", type: "string" }).pipe(
      Schema28.brand("Lexicon:did")
    )
  }),
  [Schema28.Record(Schema28.String, Data)]
);
var Message = Schema28.Union([
  Schema28.StructWithRest(
    Schema28.Struct({
      $type: Schema28.Literal("sh.mschf.ratking.mailbox.subscribe#notice"),
      seq: Schema28.Int.check(
        Schema28.isGreaterThanOrEqualTo(0),
        Schema28.isLessThanOrEqualTo(9007199254740991)
      )
    }),
    [Schema28.Record(Schema28.String, Data)]
  ),
  TaggedMap.check(
    Schema28.makeFilter(
      (value) => !["sh.mschf.ratking.mailbox.subscribe#notice"].includes(value.$type),
      { expected: "unknown union tag only" }
    )
  )
]);
var ParamsFromQuery4 = Schema28.StructWithRest(
  Schema28.Struct({
    generation: Schema28.FiniteFromString,
    leaseId: Schema28.String,
    recipientDid: Schema28.String
  }),
  [Schema28.Record(Schema28.String, Data)]
).pipe(Schema28.decodeTo(Params12));
var encodeParams7 = Effect13.fn("lexicon.encodeParams")(
  function* encodeParams8(params) {
    return entries(
      yield* Schema28.decodeUnknownEffect(Params4)(
        yield* Schema28.encodeEffect(ParamsFromQuery4)(params)
      )
    );
  }
);
var decodeParams7 = Effect13.fn("lexicon.decodeParams")(
  function* decodeParams8(entries2) {
    return yield* Schema28.decodeUnknownEffect(ParamsFromQuery4)(
      parameters(entries2)
    );
  }
);
var Method11 = {
  nsid: "sh.mschf.ratking.mailbox.subscribe",
  params: Params12,
  path: "/xrpc/sh.mschf.ratking.mailbox.subscribe"
};
var Notice = Schema28.StructWithRest(
  Schema28.Struct({
    seq: Schema28.Int.check(
      Schema28.isGreaterThanOrEqualTo(0),
      Schema28.isLessThanOrEqualTo(9007199254740991)
    )
  }),
  [Schema28.Record(Schema28.String, Data)]
);

// packages/mailbox-client/src/watch.ts
import {
  Clock as Clock2,
  Context as Context5,
  Duration,
  Effect as Effect14,
  Option as Option2,
  Predicate,
  Schedule,
  Schema as Schema29,
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
    Effect14.gen(function* connect() {
      if (fence.did !== config.identity.did) {
        return yield* new MailboxClientError({
          reason: "Watch fence DID differs from recipient"
        });
      }
      const params = yield* Schema29.decodeUnknownEffect(
        Schema29.toType(Params12)
      )({
        generation: fence.generation,
        leaseId: fence.leaseId,
        recipientDid: config.identity.did
      }).pipe(Effect14.mapError(clientError));
      const url = new URL(Method11.path, config.endpoint);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      for (const [name, value] of yield* encodeParams7(params).pipe(
        Effect14.mapError(clientError)
      )) {
        url.searchParams.set(name, value);
      }
      const port = yield* Effect14.serviceOption(WebSocketPort);
      const socket = yield* Socket.fromWebSocket(
        Effect14.acquireRelease(
          Effect14.try({
            catch: (cause) => new Socket.SocketError({
              reason: new Socket.SocketOpenError({
                cause,
                kind: "Unknown"
              })
            }),
            try: () => Option2.isSome(port) ? port.value.connect(url.href) : new globalThis.WebSocket(url.href)
          }),
          (ws) => Effect14.sync(() => {
            ws.close(1e3);
          })
        ),
        { highWaterMark: 65536 }
      );
      const reader = yield* socket.reader.pipe(Effect14.mapError(socketError));
      const writer = yield* socket.writer;
      const now = Math.floor((yield* Clock2.currentTimeMillis) / 1e3);
      const token = yield* serviceToken(
        {
          aud: config.serviceDid.replace(/(?:#mailbox)?$/u, "#mailbox"),
          exp: now + 60,
          iat: now,
          iss: config.identity.did,
          jti: base64url2(crypto.getRandomValues(new Uint8Array(16))),
          lxm: Method11.nsid
        },
        yield* importSigning(config.identity).pipe(
          Effect14.mapError(clientError)
        )
      ).pipe(Effect14.mapError(clientError));
      const auth = yield* Schema29.encodeEffect(Auth)({
        $type: "sh.mschf.ratking.mailbox.subscribe#auth",
        token
      }).pipe(Effect14.mapError(clientError));
      yield* writer.write(JSON.stringify(auth)).pipe(Effect14.mapError(socketError));
      const receiveNotice = Effect14.gen(function* receiveNotice2() {
        const frames = yield* reader.pull.pipe(Effect14.mapError(socketError));
        for (const frame of frames) {
          yield* Schema29.decodeUnknownEffect(
            Schema29.fromJsonString(Notice)
          )(
            Schema29.is(Schema29.String)(frame) ? frame : new TextDecoder().decode(frame)
          ).pipe(Effect14.mapError(clientError));
        }
      });
      yield* receiveNotice;
      const notices = Stream.fromEffectRepeat(
        receiveNotice.pipe(Effect14.flatMap(() => poll(checkpoint)))
      );
      return Stream.fromEffect(Effect14.suspend(() => poll(checkpoint))).pipe(
        Stream.concat(notices)
      );
    })
  );
  return connection.pipe(
    Stream.filter((batch) => batch.events.length > 0),
    Stream.tap(
      (batch) => Effect14.sync(() => {
        checkpoint = batch.throughSeq;
      })
    ),
    Stream.retry(
      Schedule.exponential("100 millis").pipe(
        Schedule.jittered,
        Schedule.modifyDelay(
          ({ duration }) => Effect14.succeed(Math.min(5e3, Duration.toMillis(duration)))
        ),
        Schedule.while(
          ({ input }) => input.error === "SocketDisconnected"
        )
      )
    )
  );
});

// packages/mailbox-client/src/mailbox.ts
var RatKingMailbox = class extends Context6.Service()("@rat-king/mailbox-client/RatKingMailbox") {
};
var layer = (config, resolverLayer = staticResolver(config.documents)) => Layer4.effect(
  RatKingMailbox,
  Effect15.gen(function* makeMailbox() {
    const client = yield* MailboxClient;
    const transport = yield* Transport;
    const resolver = yield* DidResolver;
    const { identity } = config;
    const list = Effect15.fn("RatKingMailbox.list")(
      (params) => Schema30.decodeUnknownEffect(Schema30.toType(Params5))({
        ...params,
        recipientDid: identity.did
      }).pipe(Effect15.flatMap(client.list), Effect15.mapError(clientError))
    );
    const poll = Effect15.fn("RatKingMailbox.poll")(function* poll2(afterSeq) {
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
      ack: Effect15.fn("RatKingMailbox.ack")(
        (input) => Schema30.decodeUnknownEffect(Schema30.toType(Input2))({
          ...input,
          recipientDid: identity.did
        }).pipe(Effect15.flatMap(client.ack), Effect15.mapError(clientError))
      ),
      deliver: Effect15.fn("RatKingMailbox.deliver")(
        (input) => Schema30.decodeUnknownEffect(Schema30.toType(Input3))({
          ...input,
          recipientDid: identity.did
        }).pipe(Effect15.flatMap(client.deliver), Effect15.mapError(clientError))
      ),
      lease: {
        acquire: Effect15.fn("RatKingMailbox.lease.acquire")(
          (input) => Schema30.decodeUnknownEffect(Schema30.toType(Input6))(
            input
          ).pipe(
            Effect15.flatMap(client.acquireLease),
            Effect15.map((output) => output.lease),
            Effect15.mapError(clientError)
          )
        ),
        release: Effect15.fn("RatKingMailbox.lease.release")(
          (input) => Schema30.decodeUnknownEffect(Schema30.toType(Input7))(
            input
          ).pipe(
            Effect15.flatMap(client.releaseLease),
            Effect15.mapError(clientError)
          )
        ),
        renew: Effect15.fn("RatKingMailbox.lease.renew")(
          (input) => Schema30.decodeUnknownEffect(Schema30.toType(Input8))(input).pipe(
            Effect15.flatMap(client.renewLease),
            Effect15.map((output) => output.lease),
            Effect15.mapError(clientError)
          )
        ),
        resolve: Effect15.fn("RatKingMailbox.lease.resolve")(
          (did) => Schema30.decodeUnknownEffect(Schema30.toType(Params10))({
            did
          }).pipe(
            Effect15.flatMap(client.resolveLease),
            Effect15.map((output) => output.lease),
            Effect15.mapError(clientError)
          )
        )
      },
      list,
      open: Effect15.fn("RatKingMailbox.open")(function* open3(input) {
        const envelope = yield* Schema30.decodeUnknownEffect(
          Schema30.toType(EncryptedEnvelope)
        )(input);
        const payload = yield* open({
          envelope,
          recipientDid: identity.did,
          recipientKey: yield* importAgreement(identity),
          recipientKeyId: `${identity.did}#encryption`,
          resolveSigningKey: (did, keyId) => resolver.resolve(did, keyId, "authentication").pipe(
            Effect15.mapError(
              () => new EnvelopeFailure({
                reason: "Unauthorized sender signing key"
              })
            )
          )
        });
        const body = yield* Effect15.try({
          catch: () => new MailboxClientError({ reason: "Invalid UTF-8 body" }),
          try: () => new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: false
          }).decode(payload.body)
        });
        const carbonCopy = yield* Schema30.decodeUnknownEffect(
          Schema30.fromJsonString(
            Schema30.Struct({
              $type: Schema30.Literal("sh.mschf.ratking.mailbox.cc"),
              body: Schema30.String,
              primary: Schema30.Struct({
                messageId: Schema30.String,
                recipientDid: Schema30.String,
                senderDid: Schema30.String
              })
            })
          )
        )(body).pipe(Effect15.option);
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
      }, Effect15.mapError(clientError)),
      poll,
      putDidDocument: Effect15.fn("RatKingMailbox.putDidDocument")(
        (document) => Schema30.decodeUnknownEffect(Schema30.toType(Input))({
          document
        }).pipe(
          Effect15.flatMap(client.putDidDocument),
          Effect15.mapError(clientError)
        )
      ),
      send: Effect15.fn("RatKingMailbox.send")(function* send(to, body, opts) {
        if (opts?.recordType !== void 0) {
          const presence = yield* lookupPresence(to).pipe(
            Effect15.provideService(Transport, transport),
            Effect15.timeoutOption("2 seconds"),
            Effect15.orElseSucceed(() => Option3.none())
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
        const messageId = yield* Effect15.sync(() => randomTid(now));
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
        const payload = yield* Schema30.decodeUnknownEffect(
          Schema30.toType(SigningPayload)
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
        const input = { envelope };
        if (opts?.fence !== void 0) {
          input.generation = opts.fence.generation;
          input.leaseId = opts.fence.leaseId;
        }
        return yield* client.send(
          yield* Schema30.decodeUnknownEffect(Schema30.toType(Input5))(input)
        );
      }, Effect15.mapError(clientError)),
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
import { Effect as Effect16, Schema as Schema31 } from "effect";
var AgentName = Schema31.String.check(
  Schema31.isPattern(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z][a-z0-9_-]{0,31}$/u)
);
var SUMMARY_MAX = 280;
var SUMMARY_HARD_MAX = 400;
var SUMMARY_WIRE_MAX = SUMMARY_MAX;
var Kind = Schema31.Literals(["message", "ask", "reply", "data"]);
var ReplyRef = Schema31.Struct({
  parent: Schema31.String,
  root: Schema31.String
});
var Payload = Schema31.Struct({
  body: Schema31.String,
  cc: Schema31.optionalKey(Schema31.Array(AgentName)),
  from: AgentName,
  kind: Schema31.optionalKey(Kind),
  label: Schema31.optionalKey(Schema31.String.check(Schema31.isMaxLength(256))),
  reply: Schema31.optionalKey(ReplyRef),
  replyTo: Schema31.optionalKey(Schema31.String),
  summary: Schema31.optionalKey(
    Schema31.String.check(Schema31.isMaxLength(SUMMARY_HARD_MAX))
  ),
  thread: Schema31.optionalKey(Schema31.String),
  to: Schema31.optionalKey(AgentName)
});
var PayloadJson = Schema31.fromJsonString(Payload);
var encodePayload = Effect16.fn("RatKing.encodePayload")(
  function* encodePayload2(payload) {
    return yield* Schema31.encodeEffect(PayloadJson)(payload);
  }
);

// packages/lexicon/src/mailbox.getPeerDocument.ts
import { Effect as Effect17, Schema as Schema32 } from "effect";
var Params13 = Schema32.StructWithRest(
  Schema32.Struct({
    did: lexString({ format: "did", type: "string" }).pipe(
      Schema32.brand("Lexicon:did")
    )
  }),
  [Schema32.Record(Schema32.String, Data)]
);
var Input11 = Schema32.Undefined;
var Output11 = Schema32.StructWithRest(
  Schema32.Struct({ document: DidDocument }),
  [Schema32.Record(Schema32.String, Data)]
);
var ParamsFromQuery5 = Schema32.StructWithRest(
  Schema32.Struct({ did: Schema32.String }),
  [Schema32.Record(Schema32.String, Data)]
).pipe(Schema32.decodeTo(Params13));
var encodeParams9 = Effect17.fn("lexicon.encodeParams")(
  function* encodeParams10(params) {
    return entries(
      yield* Schema32.decodeUnknownEffect(Params4)(
        yield* Schema32.encodeEffect(ParamsFromQuery5)(params)
      )
    );
  }
);
var decodeParams9 = Effect17.fn("lexicon.decodeParams")(
  function* decodeParams10(entries2) {
    return yield* Schema32.decodeUnknownEffect(ParamsFromQuery5)(
      parameters(entries2)
    );
  }
);
var ErrorBody11 = XrpcErrorBody;
var Method12 = {
  defaults: {},
  error: ErrorBody11,
  input: Input11,
  inputEncoding: "",
  method: "GET",
  nsid: "sh.mschf.ratking.mailbox.getPeerDocument",
  output: Output11,
  outputEncoding: "application/json",
  params: Params13,
  path: "/xrpc/sh.mschf.ratking.mailbox.getPeerDocument"
};

// packages/mailbox-client/src/prepare.ts
import {
  Clock as Clock5,
  Context as Context7,
  Data as Data2,
  Effect as Effect19,
  Layer as Layer5,
  Match as Match2,
  Predicate as Predicate2,
  Result as Result3,
  Schema as Schema34
} from "effect";

// packages/mailbox-client/src/consume.ts
import {
  Clock as Clock4,
  DateTime,
  Effect as Effect18,
  Match,
  Option as Option4,
  Schedule as Schedule2,
  Schema as Schema33,
  Stream as Stream2
} from "effect";
import { createMachine, initialTransition, transition } from "xstate";
var consumerMachine = createMachine({
  context: {},
  id: "mailbox-consumer",
  initial: "acquiring",
  states: {
    acquiring: {
      on: { ACQUIRED: { target: "consuming" }, HELD: { target: "waiting" } }
    },
    closed: { type: "final" },
    consuming: {
      on: { LOST: { target: "releasing" }, STOP: { target: "releasing" } }
    },
    releasing: { on: { RELEASED: { target: "closed" } } },
    waiting: { on: { RETRY: { target: "acquiring" } } }
  }
});
var expiredRefusal = (error) => error.error === "InvalidTransition" && error.reason === "Expired message";
var settledRefusal = (error) => error.error === "InvalidTransition";
var releasedRefusal = (error) => error.error === "LeaseMismatch";
var consume = (mailbox, did, handler, options) => Effect18.scoped(
  Effect18.gen(function* runConsumer() {
    let [state] = initialTransition(consumerMachine);
    const step = (event) => Effect18.sync(() => {
      [state] = transition(consumerMachine, state, { type: event });
    });
    const acquire = Effect18.gen(function* acquire2() {
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
      return yield* mailbox.lease.acquire(input).pipe(
        Effect18.catchIf(
          (error) => error.error === "LeaseHeld",
          (error) => Effect18.gen(function* waitHolder() {
            yield* step("HELD");
            const holder = yield* mailbox.lease.resolve(did).pipe(
              Effect18.catchIf(
                (failure3) => failure3.error === "LeaseNotFound",
                () => Effect18.void
              )
            );
            const current2 = yield* Clock4.currentTimeMillis;
            if (holder !== void 0) {
              yield* Effect18.interruptible(
                Effect18.sleep(
                  Math.max(1, Date.parse(holder.expiresAt) - current2)
                )
              );
            }
            yield* step("RETRY");
            return yield* Effect18.fail(error);
          })
        )
      );
    }).pipe(
      Effect18.retry(
        Schedule2.spaced("1 millis").pipe(
          Schedule2.while(
            ({ input }) => input.error === "LeaseHeld"
          )
        )
      )
    );
    let current = yield* Effect18.acquireRelease(
      acquire,
      () => Effect18.gen(function* release() {
        yield* step("STOP");
        yield* mailbox.lease.release({
          did,
          generation: current.generation,
          leaseId: current.leaseId
        }).pipe(
          Effect18.catchIf(releasedRefusal, () => Effect18.void),
          Effect18.tapError(
            (error) => Effect18.logWarning("Mailbox lease release not confirmed", error)
          ),
          Effect18.ignore
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
    const lost = (error) => Effect18.gen(function* classifyLoss() {
      yield* step("LOST");
      const actual = yield* mailbox.lease.resolve(did).pipe(
        Effect18.catchIf(
          (failure3) => failure3.error === "LeaseNotFound",
          () => Effect18.void
        )
      );
      const now = yield* Clock4.currentTimeMillis;
      let reason = "LeaseRenewalFailed";
      if (Date.parse(current.expiresAt) <= now) {
        reason = "LeaseExpired";
      }
      if (actual !== void 0 && (actual.leaseId !== current.leaseId || actual.generation !== current.generation)) {
        reason = "LeaseTakenOver";
      }
      return yield* Effect18.fail(
        new MailboxClientError({ error: reason, reason: error.reason })
      );
    });
    const renew = Effect18.gen(function* renew2() {
      const now = yield* Clock4.currentTimeMillis;
      const remaining = Date.parse(current.expiresAt) - now;
      if (remaining <= 0) {
        return yield* new MailboxClientError({
          error: "LeaseExpired",
          reason: "Lease expired before renewal"
        });
      }
      yield* Effect18.sleep(Math.max(1, Math.floor(remaining / 2)));
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
      current = yield* mailbox.lease.renew(renewal);
      if (options.onLease !== void 0) {
        yield* options.onLease(current);
      }
      return yield* Effect18.void;
    }).pipe(Effect18.repeat(Schedule2.spaced("0 millis")), Effect18.catch(lost));
    const handed = /* @__PURE__ */ new Set();
    const intake = mailbox.watch(options.afterSeq ?? 0, fence()).pipe(
      Stream2.runForEach(
        (batch) => Effect18.forEach(
          batch.events,
          (event) => Effect18.gen(function* accept() {
            if (!Schema33.is(MessageEvent)(event)) {
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
            const skip = (reason) => onSkip === void 0 ? Effect18.void : onSkip({
              messageId: event.receipt.message.messageId,
              reason,
              senderDid: event.receipt.message.senderDid,
              seq: event.seq
            });
            const opened = yield* mailbox.open(event.envelope).pipe(
              Effect18.map(Option4.some),
              Effect18.catch(
                (error) => unopenable === void 0 ? Effect18.fail(error) : unopenable(event, error)
              )
            );
            if (Option4.isNone(opened)) {
              yield* skip("unopenable");
              return;
            }
            const message = opened.value;
            const input = { ...fence(), message: event.receipt.message };
            const delivered = yield* mailbox.deliver(input).pipe(
              Effect18.map(
                ({ receipt }) => Match.value(receipt.state).pipe(
                  Match.when(
                    "expired",
                    () => Option4.some("expired")
                  ),
                  Match.when(
                    "acked",
                    () => Option4.some("settled")
                  ),
                  Match.orElse(() => Option4.none())
                )
              ),
              Effect18.catchIf(
                expiredRefusal,
                () => Effect18.succeed(Option4.some("expired"))
              ),
              Effect18.catchIf(
                settledRefusal,
                () => Effect18.succeed(Option4.some("settled"))
              )
            );
            if (Option4.isSome(delivered)) {
              yield* skip(delivered.value);
              return;
            }
            const ack = mailbox.ack(input).pipe(
              Effect18.catchIf(settledRefusal, () => Effect18.void),
              Effect18.asVoid
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
      Effect18.catch((error) => {
        if (Schema33.is(MailboxClientError)(error) && error.error === "LeaseMismatch") {
          return lost(error);
        }
        return Effect18.fail(error);
      })
    );
    yield* Effect18.raceFirst(intake, renew);
  })
);

// packages/mailbox-client/src/prepare.ts
var ownBrand = /* @__PURE__ */ Symbol("OwnIdentity");
var identities = /* @__PURE__ */ new WeakMap();
var ownIdentity = Effect19.fn("Mailbox.ownIdentity")(
  function* ownIdentity2(value) {
    const identity = yield* Schema34.decodeUnknownEffect(Identity)(value).pipe(
      Effect19.mapError(clientError)
    );
    yield* importSigning(identity).pipe(Effect19.mapError(clientError));
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
var seal3 = Effect19.fn("Mailbox.sealPayload")(function* seal4(to, body, opts) {
  const client = yield* PreparedMailbox;
  return yield* client.sealPayload(to, body, opts);
});
var sendSealed = Effect19.fn("Mailbox.sendSealed")(function* sendSealed2(envelope, fence) {
  const client = yield* PreparedMailbox;
  return yield* client.sendSealed(envelope, fence);
});
var failure2 = (reason) => new MailboxClientError({ reason });
var sameDocument = (a, b) => base64url2(canonical(a)) === base64url2(canonical(b));
var prepare = Effect19.fn("Mailbox.prepare")(function* prepare2(options) {
  const identity = identities.get(options.own);
  if (identity === void 0) {
    return yield* failure2("Unknown own identity handle");
  }
  const peers = /* @__PURE__ */ new Map();
  for (const value of options.peers) {
    const peer = yield* Schema34.decodeUnknownEffect(Document)(value).pipe(
      Effect19.mapError(clientError)
    );
    const existing = peers.get(peer.id);
    if (existing !== void 0 && !sameDocument(existing, peer)) {
      return yield* failure2("Conflicting peer documents");
    }
    peers.set(peer.id, peer);
  }
  const resolverLayer = documentResolver(
    (did) => Effect19.sync(() => peers.get(did))
  );
  const config = {
    documents: yield* Schema34.decodeUnknownEffect(
      Schema34.Array(Schema34.toType(DidDocument))
    )(options.peers).pipe(Effect19.mapError(clientError)),
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
    Effect19.mapError(clientError)
  );
  const payloads = /* @__PURE__ */ new WeakMap();
  const copies = /* @__PURE__ */ new WeakMap();
  let consuming = false;
  const sealEnvelopeForPeer = Effect19.fn("Mailbox.seal")(
    function* sealEnvelopeForPeer2(to, body, opts) {
      const now = yield* Clock5.currentTimeMillis;
      const messageId = randomTid(now);
      const text = yield* Effect19.try({
        catch: () => new MailboxClientError({ reason: "Invalid message body factory" }),
        try: () => Match2.value(body).pipe(
          Match2.when(Match2.string, (value) => value),
          Match2.orElse((factory) => factory(messageId))
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
      const payload = yield* Schema34.decodeUnknownEffect(
        Schema34.toType(SigningPayload)
      )(raw).pipe(Effect19.mapError(clientError));
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
      }).pipe(Effect19.mapError(clientError));
      payloads.set(envelope, payload);
      return envelope;
    }
  );
  const submit = Effect19.fn("Mailbox.sendSealed")(function* submit2(envelope, fence) {
    if (envelope.aad.senderDid !== identity.did || fence !== void 0 && fence.did !== identity.did) {
      return SendOutcomes.NotAttempted({
        reason: "Sender identity or fence mismatch"
      });
    }
    const raw = { envelope };
    if (fence !== void 0) {
      Object.assign(raw, {
        generation: fence.generation,
        leaseId: fence.leaseId
      });
    }
    const decoded = yield* Schema34.decodeUnknownEffect(
      Schema34.toType(Input5)
    )(raw).pipe(Effect19.mapError(clientError), Effect19.result);
    if (Result3.isFailure(decoded)) {
      return SendOutcomes.NotAttempted({ reason: decoded.failure.reason });
    }
    const result = yield* client.send(decoded.success).pipe(Effect19.mapError(clientError), Effect19.result);
    if (Result3.isSuccess(result)) {
      return SendOutcomes.Accepted({ receipt: result.success.receipt });
    }
    const error = result.failure;
    return error.status !== void 0 && error.status >= 400 && error.status < 500 ? SendOutcomes.Rejected({ error }) : SendOutcomes.Uncertain({ error });
  });
  const send = Effect19.fn("Mailbox.send")(function* send2(envelope, opts) {
    if (!peers.has(envelope.aad.recipientDid)) {
      return SendOutcomes.NotAttempted({ reason: "Unknown primary peer" });
    }
    const primary = yield* submit(envelope, opts?.fence);
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
    const ccResult = yield* Effect19.gen(function* carbonCopy() {
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
        const replyTo = yield* Schema34.decodeUnknownEffect(
          Schema34.toType(MessageRef)
        )({ messageId: envelope.aad.messageId, senderDid: identity.did }).pipe(
          Effect19.mapError(clientError)
        );
        copy = yield* sealEnvelopeForPeer(did, body, { replyTo });
        cached.set(did, copy);
        copies.set(envelope, cached);
      }
      return yield* submit(copy, opts?.fence);
    }).pipe(
      Effect19.mapError(clientError),
      Effect19.catch(
        (error) => Effect19.succeed(SendOutcomes.NotAttempted({ reason: error.reason }))
      )
    );
    return { ...primary, cc: ccResult };
  });
  const sealPayload = Effect19.fn("Mailbox.sealPayload")(function* sealPayload2(to, body, opts) {
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
        return Schema34.encodeSync(PayloadJson)(payload);
      },
      opts
    ).pipe(Effect19.mapError(clientError));
    return { envelope, messageId: envelope.aad.messageId };
  });
  const refresh = Effect19.fn("Mailbox.refresh")(function* refresh2(did) {
    const params = yield* Schema34.decodeUnknownEffect(Params13)({ did }).pipe(
      Effect19.mapError(clientError)
    );
    const response = yield* transport.request({
      input: void 0,
      method: "GET",
      nsid: Method12.nsid,
      params: yield* Schema34.encodeEffect(Params13)(params).pipe(
        Effect19.mapError(clientError)
      )
    }).pipe(Effect19.mapError(clientError));
    if (response.kind !== "json" || response.status !== 200) {
      return yield* new MailboxClientError({
        reason: "Peer directory request refused",
        status: response.status
      });
    }
    const output = yield* Schema34.decodeUnknownEffect(Output11)(
      response.body
    ).pipe(Effect19.mapError(clientError));
    const peer = yield* Schema34.decodeUnknownEffect(Document)(
      output.document
    ).pipe(Effect19.mapError(clientError));
    const existing = peers.get(did);
    if (peer.id !== did || existing !== void 0 && !sameDocument(existing, peer)) {
      return yield* failure2(
        "Peer directory conflict; retained trusted document"
      );
    }
    peers.set(did, peer);
    return peer;
  });
  const presence = (did) => lookupPresence(did).pipe(Effect19.provideService(Transport, transport));
  return {
    consume: (handler, opts) => Effect19.suspend(() => {
      if (consuming) {
        return Effect19.fail(failure2("Consumer already active"));
      }
      consuming = true;
      return consume(mailbox, identity.did, handler, opts).pipe(
        Effect19.ensuring(
          Effect19.sync(() => {
            consuming = false;
          })
        )
      );
    }),
    head: mailbox.list({ afterSeq: 0, limit: 1 }).pipe(Effect19.map(({ throughSeq }) => throughSeq)),
    mailbox,
    open: mailbox.open,
    presence,
    refresh,
    resolveLease: mailbox.lease.resolve,
    seal: sealEnvelopeForPeer,
    sealPayload,
    send,
    sendSealed: submit
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
  authenticateClaims,
  base64url2 as base64url,
  consumerMachine,
  documentResolver,
  encodePayload,
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
  transportLayer,
  unbase64url
};
