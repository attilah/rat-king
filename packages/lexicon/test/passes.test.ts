import { it } from "@effect/vitest";
import { Arbitrary, Effect } from "effect";
import { expect } from "vitest";

import { signatures } from "../adapters/webcrypto.ts";
import {
  decodeDidKey,
  makeMemoryNonceBinding,
  NonceBinding,
  scopeWithin,
  signPass,
  signRequest,
  signTicket,
  verifyPass,
  verifyRequest,
  verifyTicket,
} from "../passes.ts";
import { TrustFailure } from "../trust.ts";
import { didForBytes, fixture, keypair, Variation } from "./pass-helpers.ts";

const variations = Arbitrary.schema(Variation);

const options = { arbitrary: { runs: 25 } };

const refused = <A, R>(effect: Effect.Effect<A, TrustFailure, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.tap((failure) =>
      Effect.sync(() => {
        expect(failure).toBeInstanceOf(TrustFailure);
        expect(failure.reason.split(";")).toHaveLength(3);
      })
    )
  );

it.effect.prop(
  "random valid chains verify with a ticket or a known desk and permit matching re-presentation",
  [variations],
  ([input]) =>
    Effect.gen(function* validChainProperty() {
      const sample = yield* fixture(input);
      expect(sample.worker.decoded).toEqual(sample.worker.publicKey);
      const binding = yield* makeMemoryNonceBinding(Effect.succeed(input.now));
      const at = input.now + input.skew;

      const pass = yield* verifyPass(sample.authority, sample.pass, at).pipe(
        Effect.provideService(NonceBinding, binding)
      );

      const repeated = yield* verifyPass(sample.known, sample.pass, at).pipe(
        Effect.provideService(NonceBinding, binding)
      );

      expect(repeated.record).toEqual(pass.record);

      const request = new TextEncoder().encode(
        `${input.method}:${input.credential}`
      );

      const sig = yield* signRequest(sample.worker.signer, request);
      yield* verifyRequest(pass, request, sig);
      yield* refused(
        verifyRequest(
          pass,
          request,
          yield* signRequest(sample.desk.signer, request)
        )
      );
      yield* refused(verifyRequest(pass, new Uint8Array([...request, 0]), sig));
      expect(Object.isFrozen(pass.record.scope)).toBe(true);
    }).pipe(Effect.provide(signatures)),
  options
);

const ticketPlants = [
  "unpinned",
  "namespace",
  "name",
  "fingerprint",
  "expired",
  "future",
  "over-cap",
  "inverted",
  "forged",
] as const;

for (const plant of ticketPlants) {
  it.effect.prop(
    `ticket refuses ${plant}`,
    [variations],
    ([input]) =>
      Effect.gen(function* ticketPlantProperty() {
        const sample = yield* fixture(input);
        const { record } = sample.ticket;

        const changes = {
          expired: { exp: input.now - 61, iat: input.now - 961 },
          fingerprint: { fingerprint: "0".repeat(64) },
          forged: { name: `${record.namespace}forged` },
          future: { exp: input.now + 961, iat: input.now + 61 },
          inverted: { exp: input.now, iat: input.now + 1 },
          name: { name: `${record.namespace.slice(0, -1)}-other/desk` },
          namespace: { namespace: "outside/" },
          "over-cap": { exp: input.now + 901 },
          unpinned: {},
        };

        const signed =
          plant === "forged"
            ? { ...sample.ticket, record: { ...record, ...changes[plant] } }
            : yield* signTicket(
                sample.host.signer,
                {
                  ...record,
                  ...changes[plant],
                },
                sample.desk.publicKey
              );

        yield* refused(
          verifyTicket(
            plant === "unpinned" ? new Map() : sample.pins,
            signed,
            input.now
          )
        );
      }).pipe(Effect.provide(signatures)),
    options
  );
}

const passPlants = [
  "borrowed-desk",
  "widened",
  "bare-star",
  "empty",
  "unknown",
  "expired",
  "future",
  "over-cap",
  "desk-name",
  "desk-did",
  "invalid-worker",
  "wrong-signature",
] as const;

for (const plant of passPlants) {
  it.effect.prop(
    `pass refuses ${plant}`,
    [variations],
    ([input]) =>
      Effect.gen(function* passPlantProperty() {
        const sample = yield* fixture(input);
        const { record } = sample.pass;

        const changes = {
          "bare-star": { scope: [`${input.method}:*`] },
          "borrowed-desk": { worker: sample.desk.did },
          "desk-did": { deskDid: sample.worker.did },
          "desk-name": { desk: `${record.desk}-other` },
          empty: { scope: [] },
          expired: { exp: input.now - 61, iat: input.now - 661 },
          future: { exp: input.now + 661, iat: input.now + 61 },
          "invalid-worker": { worker: "did:key:zInvalid" },
          "over-cap": { exp: input.now + 601 },
          unknown: { scope: ["sh.secretcell.set"] },
          widened: { scope: [`${input.method}:elsewhere/*`] },
          "wrong-signature": {},
        };

        const changed = { ...record, ...changes[plant] };

        const signing = signPass(
          plant === "wrong-signature"
            ? sample.worker.signer
            : sample.desk.signer,
          changed
        );

        const binding = yield* makeMemoryNonceBinding(
          Effect.succeed(input.now)
        );

        yield* refused(
          signing.pipe(
            Effect.flatMap((signed) =>
              verifyPass(sample.authority, signed, input.now)
            ),
            Effect.provideService(NonceBinding, binding)
          )
        );
        yield* verifyPass(sample.authority, sample.pass, input.now).pipe(
          Effect.provideService(NonceBinding, binding)
        );
      }).pipe(Effect.provide(signatures)),
    options
  );
}

it.effect.prop(
  "a pass from desk A refuses desk B's valid ticket even under the same host",
  [variations],
  ([input]) =>
    Effect.gen(function* otherDeskProperty() {
      const sample = yield* fixture(input);
      const other = yield* fixture(input);
      const binding = yield* makeMemoryNonceBinding(Effect.succeed(input.now));
      yield* refused(
        verifyPass(other.authority, sample.pass, input.now).pipe(
          Effect.provideService(NonceBinding, binding)
        )
      );
    }).pipe(Effect.provide(signatures)),
  options
);

for (const changed of ["worker", "run"] as const) {
  it.effect.prop(
    `nonce refuses a different ${changed} after first use`,
    [variations],
    ([input]) =>
      Effect.gen(function* noncePlantProperty() {
        const sample = yield* fixture(input);
        const other = yield* keypair;

        const binding = yield* makeMemoryNonceBinding(
          Effect.succeed(input.now)
        );

        yield* verifyPass(sample.authority, sample.pass, input.now).pipe(
          Effect.provideService(NonceBinding, binding)
        );

        const record = {
          ...sample.pass.record,
          [changed]:
            changed === "worker"
              ? other.did
              : `${sample.pass.record.run}-other`,
        };

        const signed = yield* signPass(sample.desk.signer, record);
        yield* refused(
          verifyPass(sample.authority, signed, input.now).pipe(
            Effect.provideService(NonceBinding, binding)
          )
        );
        yield* verifyPass(sample.authority, sample.pass, input.now).pipe(
          Effect.provideService(NonceBinding, binding)
        );
      }).pipe(Effect.provide(signatures)),
    options
  );
}

it.effect.prop(
  "scope coverage respects method, slash boundary and wildcard direction",
  [variations],
  ([input]) =>
    Effect.gen(function* scopeCoverageProperty() {
      const prefix = `project${input.credential}`;
      const broad = `${input.method}:${prefix}/*`;
      const exact = `${input.method}:${prefix}/secret`;
      yield* scopeWithin([exact], [broad]);
      yield* scopeWithin([broad], [input.method]);

      for (const denied of [
        [broad, exact],
        [input.method, broad],
        [`${input.method}:${prefix}-other/secret`, broad],
        ["*", broad],
        [`${input.method}:*`, input.method],
        ["rk.ask", broad],
      ]) {
        yield* refused(scopeWithin(denied.slice(0, 1), denied.slice(1)));
      }

      yield* refused(scopeWithin([], [broad]));
    }),
  options
);

it.effect.prop(
  "skew boundaries and exact lifetime caps are enforced without wall time",
  [variations],
  ([input]) =>
    Effect.gen(function* timeBoundariesProperty() {
      const sample = yield* fixture(input);
      yield* verifyTicket(sample.pins, sample.ticket, input.now - 60);
      yield* verifyTicket(
        sample.pins,
        sample.ticket,
        sample.ticket.record.exp + 60
      );
      const binding = yield* makeMemoryNonceBinding(Effect.succeed(input.now));

      const capped = yield* signPass(sample.desk.signer, {
        ...sample.pass.record,
        exp: input.now + 600,
      });

      yield* verifyPass(sample.known, capped, input.now + 660).pipe(
        Effect.provideService(NonceBinding, binding)
      );
      yield* refused(
        verifyPass(sample.known, sample.pass, Number.NaN).pipe(
          Effect.provideService(NonceBinding, binding)
        )
      );
      yield* refused(
        verifyTicket(sample.pins, sample.ticket, Number.POSITIVE_INFINITY)
      );
      const mutated = { ...sample.pass, signature: "!" };
      yield* refused(
        verifyPass(sample.known, mutated, input.now).pipe(
          Effect.provideService(NonceBinding, binding)
        )
      );
    }).pipe(Effect.provide(signatures)),
  options
);

it.effect.prop(
  "inline ticket keys cannot be substituted and noncanonical desk coordinates cannot bypass key separation",
  [variations],
  ([input]) =>
    Effect.gen(function* deskKeyBindingProperty() {
      const sample = yield* fixture(input);
      yield* refused(
        verifyTicket(
          sample.pins,
          { ...sample.ticket, publicKey: sample.worker.publicKey },
          input.now
        )
      );

      const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

      const { x } = sample.desk.publicKey;
      const altered = `${x.slice(0, -1)}${alphabet[alphabet.indexOf(x.slice(-1)) + 1]}`;

      const authority = {
        ...sample.known,
        knownDesk: {
          ...sample.known.knownDesk,
          key: { ...sample.desk.publicKey, x: altered },
        },
      };

      const binding = yield* makeMemoryNonceBinding(Effect.succeed(input.now));
      yield* refused(
        verifyPass(authority, sample.pass, input.now).pipe(
          Effect.provideService(NonceBinding, binding)
        )
      );
    }).pipe(Effect.provide(signatures)),
  options
);

it.effect.prop(
  "malformed and wrong-curve did:key values refuse before worker verification",
  [variations],
  ([input]) =>
    Effect.gen(function* malformedDidProperty() {
      const sample = yield* fixture(input);
      const nonPoint = new Uint8Array(32);

      nonPoint[31] = (input.credential % 4) + 1;

      const prefix = input.wildcard ? 2 : 3;

      const prime =
        "ffffffff00000001000000000000000000000000ffffffffffffffffffffffff";

      const outOfField = Uint8Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(prime.slice(index * 2, index * 2 + 2), 16)
      );

      for (const value of [
        didForBytes(Uint8Array.from([0x80, 0x24, prefix, ...nonPoint])),
        didForBytes(Uint8Array.from([0x80, 0x24, prefix, ...outOfField])),
        didForBytes(Uint8Array.from([0x80, 0x24, 4, ...new Uint8Array(32)])),
        didForBytes(
          Uint8Array.from([0x81, 0x24, prefix, ...new Uint8Array(32)])
        ),
        sample.worker.did.replace("did:key:z", "did:key:m"),
        `${sample.worker.did}1`,
        "did:web:worker.example.invalid",
        `did:key:z${"1".repeat(48)}`,
        `${sample.worker.did}#key`,
      ]) {
        yield* refused(decodeDidKey(value));
      }
    }).pipe(Effect.provide(signatures)),
  options
);
