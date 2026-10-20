# Desk tickets and worker passes

Import the verifier and service ports from `@rat-king/lexicon/passes`. The core uses Effect, DAG-CBOR and the existing `Signatures` port. It does not import a crypto provider, resolve names, send mail or lease private keys.

## Wire contract

`sh.ratking.ticket` and `sh.ratking.pass` are generated from `lexicons/`. Run `pnpm lexgen:write` after changing either definition.

All `iat`, `exp`, `now` and binding retention values use **Unix seconds**, not milliseconds. Tickets last at most 900 seconds. Passes last at most 600 seconds. Verification accepts the closed interval `[iat - 60, exp + 60]`. Lifetimes must be positive. Non-finite clocks refuse.

Signed tickets carry `{publicKey, record, signature}`. `publicKey` is the desk's public P-256 JWK. The host signs the ticket record, including the SHA-256 digest of `fingerprintBytes(publicKey)`. This authenticates the inline key without a directory lookup. A `did:key` desk must also match that key. For other desk DIDs, the pinned host attests the DID-to-key binding. Existing Rat King desk identities use `did:web`, so requiring every desk to use `did:key` would break that binding.

`signTicket(issuerKey, ticket, deskPublicKey)` supplies the inline desk key. The third argument can be omitted for a P-256 `did:key` desk because that DID contains the key. The ticket record itself retains exactly the lexicon fields, plus `$type`.

Signed passes carry `{record, signature}`. Both token signatures are base64url ES256 signatures over DAG-CBOR encoding of `{domain: "sh.ratking.delegation.v1", record}`. The signed `$type` distinguishes tickets from passes. The worker is a canonical base58btc P-256 `did:key`, with multicodec `0x1200` and a compressed curve point. Decoding checks the codec, length, field range and curve equation. `encodeDidKey(publicKey)` is the inverse. It refuses a key whose `y` is not the curve point for `x`, or whose coordinates are not canonical base64url. Desk-key reuse is refused by public coordinates as well as DID, including a desk key disguised as a worker `did:key` under a `did:web` desk.

## Pass requests

Import `PassRequest`, `passRequestBytes` and `signPassRequest` from `@rat-king/lexicon/pass-request`. The schema is `sh.mschf.ratking.defs#passRequest`:

```text
{aud, lxm, iat, exp, jti, envelopeDigest, passDigest, intent: {woke, wakeReason}}
```

The signing bytes are DAG-CBOR `{domain: "sh.ratking.pass.request.v1", request}`, built from the decoded request. Unknown keys refuse, at both levels, so nothing unsigned rides along. `aud` is an ASCII DID URL, because DAG-CBOR writes every lone surrogate as U+FFFD and two free-text audiences could share signing bytes. Digests are base64url SHA-256 (43 characters). `jti` is 16 to 128 base64url characters. `wakeReason` is `to` or `quiet`. Times are Unix seconds.

`signPassRequest(workerKey, request)` signs those bytes with `signRequest`. The receiver recomputes them with `passRequestBytes` and calls `verifyRequest`. Changing any one field refuses. This package doesn't check `aud`, `lxm`, the lifetime, the digests or the `jti`; the receiver binds them, as Verification step 6 says.

`sh.mschf.ratking.mailbox.sendViaPass` takes `{pass, envelope, request, signature}` and returns `send`'s receipt. It has no bearer token.

## Signing keys

`SigningKey` contains a public key and a `sign(bytes)` operation. The WebCrypto adapter is `@rat-king/lexicon/pass-webcrypto`. Its `signingKey(publicKey, privateKey)` holds a caller-owned WebCrypto key. The core never receives a desk private key when verifying a worker request.

## Verification

1. Pass `verifyTicket` a map of issuer identifiers to existing `Issuer {key, namespaces}` values. An issuer's declared namespace must exactly match a pinned namespace. The name must fall below its slash boundary. Prefix lookalikes refuse.
2. Pass `verifyPass` either `{ticket, pinnedIssuers}` or `{knownDesk: {name, did, key}}`, plus `grantable` and `issuerScope`. A known desk is an already trusted DID/key binding. Ticket mode always verifies the ticket again, at the supplied time.
3. `grantable` is a set of method names, such as `rk.send.plain`. It must exclude desk-only methods. This generic verifier does not invent a global permission list. `issuerScope` is the desk's current authority ceiling, not a scope asserted by the ticket.
4. `scopeWithin` refuses an empty pass scope, unknown syntax, a bare wildcard and any widening. Credential patterns are exact strings or end in `/*`. A method without a credential restriction covers that method's restricted scopes. Wildcards respect slash boundaries and cannot cover a less restricted method.
5. Provide `NonceBinding`. Only an authenticated, authorized pass can bind its nonce. The binding is `(deskDid, nonce)` to `{workerThumbprint, run}`, retained through `exp + 60`. The thumbprint is SHA-256 of the existing `fingerprintBytes` representation. A matching presentation succeeds again. A different key or run refuses. Matching re-presentations cannot shorten retention.
6. Call `verifyRequest` with the returned `VerifiedPass` and the exact request bytes. A desk signature, stolen pass with another worker key, or changed request bytes refuses. The returned record, scope and key are frozen.

Verify the pass for each request. `verifyRequest` checks only the signature against the already verified worker. It does not recheck time, request method, credentials or request replay. The receiving application must bind the method, audience, body and request `jti` into the signed bytes, enforce the requested action against the verified scope and stored grants, and consume the request's `jti`. A pass is a ceiling, not stored authority.

All expected refusals are `TrustFailure` values with three clauses: what failed; why; what to do next. Existing cryptographic port failures are translated at the public verifier boundary.

## Run binding

`RunBinding` is separate from nonce retention. The launcher opens a run with `{tokenHash, iat, exp}` and `now`. Only a SHA-256 hex hash is stored, never a raw token. The token must be current and last no more than 300 seconds. A run identifier cannot be reopened, including after closure or compromise.

The lifecycle sketch, in XState terms, is:

```text
unknown -- OPEN(valid token) --> open
open -- CLAIM(current token, worker) --> bound(worker)
bound(worker) -- CLAIM(same token, same worker) --> bound / match
bound(worker) -- CLAIM(same token, other worker) --> compromised
bound(worker) -- RENEW(worker) --> bound / match
bound(worker) -- RENEW(other worker) --> bound / refusal
unknown | open | closed | compromised -- RENEW --> refusal
unknown | open | bound | compromised -- CLOSE --> closed
closed | compromised -- CLAIM --> refusal
```

The implementation is a pure tagged-state registry, not a launcher or a socket actor. `claim` returns `bound` on first use and `match` on renewal. `renew(run, workerDid, now)` is the renewal without a token. It returns `match` only for the bound worker. Another worker key refuses and **leaves the run bound**: without a token, a stranger hasn't shown anything secret, so it must not be able to burn the run. An `open` run must be claimed first. A mismatched worker burns the run into `compromised` and returns that outcome once. **Never issue a pass for `compromised`.** Every later claim refuses for either worker. A wrong hash refuses without taking over the run. An unclaimed expired token refuses. After first binding, the token is consumed: the same worker may renew after the claim token expires until the launcher closes the run or detects compromise. This does not extend a pass or a stored grant.

### Run grammar

A run that reaches a receipt follows `sh.mschf.ratking.defs#passRun`: `<label>:<id>`. The label matches `[a-z][a-z0-9_-]{0,31}`. The id is the worker's session UUID in lowercase, or 32 lowercase hex characters minted by the launcher. `RunBinding` and the pass record still accept any non-empty run up to 256 characters, so a receiver that writes `via` must check the grammar first.

## Via

A receipt for a pass send carries `via = {desk, deskDid, run, worker, pass}`. It is the mailbox's attestation that it verified the pass at admission, with the signed pass as evidence. `Receipt` keeps its rest map, so older receipts decode unchanged and older readers ignore `via`. The `listTraffic` entry carries `via = {desk, deskDid, run}` without the pass. Readers render the marker from `via.run` and show the desk as the sender.

## Memory implementations

`makeMemoryNonceBinding` accepts an Effect clock in seconds; its default converts Effect Clock milliseconds to seconds. `makeMemoryRunBinding` uses explicit caller clocks. Both are in-memory reference implementations for tests. Production adapters must make first-use binding and compromise transitions atomic and persist terminal run states. The memory implementations are not bounded production stores.

## Evidence and remaining claims

Property tests cover every packet plant. Desk keys and aliases cannot act as workers. Scopes cannot be widened, empty, unknown or a bare wildcard. Nonces cannot switch worker or run. Expired, future and overlong records refuse. Issuers must be pinned, names must remain inside their namespace and fingerprints must match. Tickets cannot be substituted between desks. Forged signatures and altered request bytes refuse. Random valid chains vary scopes, times, skew and lifetimes in both known-desk and ticket modes.

The model tests use fast-check commands and `asyncModelRun`. They compare nonce retention and the run lifecycle, including `renew`, after every command. Renewal plants cover a closed run, a still-open run, a compromised run and another worker key, which must leave the run bound. Their harness lives in `packages/ratking-client/test/desk-pass-*` solely to reuse that package's already pinned fast-check dependency. No dependency or lockfile changes are needed.

`did:key` encoding round-trips both ways over random points, and off-curve keys refuse. Changing, flipping or adding any pass request field makes `verifyRequest` refuse.

Not tested here: retired-name issuance, production durable-storage atomicity, worker key transport and destruction, launcher renewal, service-specific permission lists, request replay consumption, routing or deployed behavior. Those belong to the issuer, receiver or launcher packets.

## Issuer-key exposure

An exposed pinned issuer private key lets an attacker attest any desk name inside that issuer's pinned namespaces and choose its desk key. Short expiry limits an individual ticket, not an attacker who can keep minting tickets. Remove or rotate a compromised issuer pin through the owning configuration process. No issuer keys, inventory or configuration ship in this package.

## Reflection

`trust.ts` already supplies ES256 verification, DAG-CBOR encoding, SHA-256 fingerprints and the `TrustFailure` shape. It does not decode P-256 multibase `did:key` values, mint signatures, enforce pass lifetimes or subset scopes, or bind nonces and launcher runs. This packet adds those seams without changing the existing trust behavior.

Today's `packages/mailbox-client/src/prepare.ts` assumes one local identity:

- `ownIdentity` validates an `Identity` and imports its signing key. A pass is not an own-identity credential.
- `prepare` resolves that opaque identity handle and builds transport authentication from the same identity. There is no pass or ticket option.
- `sealEnvelopeForPeer` writes `identity.did` into `aad.senderDid`, signs with the imported identity key and labels it `${identity.did}#atproto`. It cannot represent a separate worker signing via a desk.
- `submit` returns `NotAttempted` when the envelope's sender DID or lease fence DID differs from the prepared identity. A worker prepared as itself cannot submit an envelope claiming the desk. Merely substituting a worker signature while retaining the desk DID is not locally checked here; it fails downstream signature verification instead.
- `sealPayload` renders `from` from configured names. It has no verified pass `run` from which to render a via marker.

Today's `packages/mailbox-client/src/auth.ts` has two independent refusals:

- `authenticateClaims` accepts a bearer compact JWT, not a DAG-CBOR pass. Its claims require the requested audience and exact method, a positive lifetime of at most 60 seconds, and a fresh `jti`. A raw pass is not that token format.
- It resolves `claims.iss` with the header key ID (default `#atproto`) for authentication, then verifies that resolved key. `documentResolver` requires `did:web`, a verification method controlled by that DID and an authentication-purpose key reference. A worker `did:key` is rejected. A JWT claiming the desk but signed by the worker fails verification against the desk's resolved key.

Neither file recognizes a delegation chain or applies a pass scope. This packet does not change them. The existing per-request replay authority remains separate from reusable pass-nonce binding.
