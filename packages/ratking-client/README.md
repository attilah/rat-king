# @rat-king/ratking-client

The client core: everything a Rat King name does that is neither Pi nor a terminal. Pi's extension, the `ratking` CLI and scripts are thin shells over it.

It holds the `RatKing` service (`send`, `ask`, `reply`, `handled`, `pending`, `list`, `retire`, `status`, `attention`, and the reader loop `run`) and the `Inbox` service the CLI uses (`locate`, `attach`, `peek`, `hold`, `holder`). Config (`config.ts`), name and DID rules, the directory, secret store, issuer, payloads, relay, threads, asks, `attend` and the literal-prompt renderer (`prompt.ts`) live beside them. Every surface projects these contracts; none re-implements them.

Core imports no Pi package and no terminal code. Provider implementations sit behind `Issuer`, `SecretStore` and `Directory`.

## Lease rules

- `send`, `ask`, `reply` sign with the name's key and never take its lease. A send while a reader holds the lease carries that reader's fence only when this process is the reader.
- `Inbox.peek` lists with `mailbox.poll` and opens locally. It never delivers, acks, acquires or renews, so it cannot disturb a live reader.
- `Inbox.hold` is the only consumer. It acquires the lease itself first and fails `LeaseHeld`, naming the holder's session, if a live holder exists. Only then does it resume into the leased consumer, ack each message after the caller showed it, and release.

## Sharing

`sendingOptions` (`compose.ts`) turns the shared `summary`, `encrypt` and `ccOnPurpose` inputs into send options and the summary lead. The Pi tool and the CLI both call it, so the same send puts the same bytes on the wire. `apps/ratking-cli/test/wire.test.ts` proves it.
