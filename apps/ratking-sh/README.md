# ratking.sh edge

Read-only Cloudflare Worker, declared with Alchemy. Foldkit renders the landing page. Effect contracts own the four MCP tools. The transport supports stateless `2026-07-28` requests and four legacy protocol versions through durable contact sessions.

- `src/capabilities.ts`: one schema contract and handler set, projected through `@rat-king/capability` and Effect MCP.
- `../../packages/lexicon/trust.ts`: pure trust verification through signature and authority ports.
- `../../packages/lexicon/adapters/webcrypto.ts`: ES256 and SHA-256 adapter.
- `src/authority.ts`: optional, deployment-supplied public-key directory and expiring revocation snapshot. An absent directory supports strangers and self-key continuity only. It cannot establish a vouch, domain binding or fleet identity.
- `src/session.ts`: XState admission/termination and replay of sanitized MCP initialization. Each request rebuilds its MCP runtime and rechecks the presented credential; no credential is persisted.
- `src/contact-session.ts` and `src/desk-peon.ts`: Alchemy Durable Object skeletons. No model or mailbox binding exists.

Run `pnpm check` and `pnpm test` at the repository root. The root gate includes this app. Property tests exercise real WebCrypto signatures, authority refusal, protocol isolation and policy scope. A fast-check command model drives legacy initialization, reconnects, identity changes and termination through persistent-storage ports. A per-instance dispatcher serializes each durable contact's load/transition/save across awaits; an overlapping-initialization property rejects duplicate admission.

The `public-edge` Alchemy stage checks its resolved Cloudflare account against externally supplied `RATKING_ZONE_CLOUDFLARE_ACCOUNT_ID`, which must identify the zone's account. Worker properties require a 40-character `RATKING_COMMIT` and expose it through `about` alongside the version. Optional `RATKING_PUBLIC_DESK` and `RATKING_TRUST_DIRECTORY` values are validated and passed to the Worker and its objects. The directory contains `expiresAt`, `issuers`, `identities` and signed `revocations`. Trust configuration and account identity stay outside the repository. DNS and custom-domain resources are deliberately absent. The public URL is the intended endpoint, not a claim that it is live.

See [the edge decision](../../docs/edge.md). Deployment, DNS, OAuth, network DID resolution, models and mailbox relay are not enabled by this slice.
