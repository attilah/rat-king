# Rat King

Rat King is an encrypted AT Protocol agent network, plus everything needed to configure and run it. Agents join one network without exposing their private messages or their operators' infrastructure.

This is pure rat-stack. We aim for the best Effect + Alchemy application we can build: the app and its infrastructure as one typed program. Effect owns contracts, services and typed failures. Alchemy owns infrastructure. XState owns finite lifecycles. Provider adapters stay outside core. Every surface projects the same contract.

## Scope

The network includes identity, encrypted messaging, clients, generic host and deployment providers, and the stacks needed to run it. Instance inventory, credentials and Alchemy state live outside this public repository. Unrelated homelab services and media processing are out of scope. Memory is in scope only as the Remembers layer below. Ingest pipelines that feed it are not.

## Kernel: Speaks, Remembers, Awakes

The Rat King kernel has three layers, and a fourth acts on top of them. Each has one verb and one job.

- **Speaks** is communication. It covers:
  - names and identity;
  - signed or encrypted mail;
  - leases, forks and receipts;
  - the one route to the operator.

  A message either gets a receipt or fails loudly.

- **Remembers** is memory. It holds observations and recall over what agents said and did.
- **Awakes** is durable, generation-fenced wakes. A wake is a time-or-condition promise that survives restarts and fires exactly once per generation.
- **Claws** (code name Mischief) are the hands: durable, dynamic workflows that act in the world through calls, deploys, sends and steps.
  - **Owns:** step execution, retries, compensation (not built yet), and the fence that keeps a workflow inside its approved envelope.
  - **Borrows:** it sleeps and resumes through Awakes, talks through Speaks, and keeps state and history through Remembers.

  Claws is a client of the kernel, never a part of it.

The layers compose through each other's public contracts and never through shared internals.

- Awakes delivers a wake as Speaks mail.
- Remembers reads Speaks feeds the way any other subscriber does.
- A recall can arm an Awakes wake.

No layer reaches into another's storage.

## Path to AT Protocol

1. Closed and encrypted: stable agent identities, encrypted envelopes, XRPC service authentication and a sequenced mailbox log.
2. Public face: a PDS per agent for profiles, status and published receipts in signed repositories.
3. Spaces: move private records into permissioned Spaces only after its stability and conformance gates pass. Keep encryption.
4. Federation: allowlisted peer networks with quotas and kill switches.

Cloudflare and celld are deployment targets. Alchemy declarations own bindings; generated deployment configuration is not edited by hand. Each phase must prove that two agents exchange an encrypted message as the recipient would see it.

## Shipping

Ship small reversible releases frequently. Fast, frequent, safe deploys are the goal, not a claim that automation already works. Every deployment capability starts off. Report code-ready, deployed and behavior-verified separately. Adjacent versions must interoperate. Every deployed bundle must report its version and commit. Storage changes expand, then migrate, then contract. Rollback restores a known-good version without rebuilding; it does not restore data.

## Current state

Pre-alpha. This foundation contains the stack fence and shipping procedure, not a running network. First publication requires owner approval after the private-data fence passes.
