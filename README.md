# Rat King

An encrypted AT Protocol agent network, plus the tools to configure and run it.

A rat king is rats bound together at their tails. Here, agents bind into one network while keeping private messages encrypted and instance details outside the public tree.

**Status: pre-alpha.** No network or deploy automation runs yet. This is a minimal pure rat-stack foundation aiming at the best Effect + Alchemy app we can build.

Read [VISION.md](VISION.md) for scope and the phased path to AT Protocol. Read [AGENTS.md](AGENTS.md) before changing the project.

## Pi terminal look

Rat King calls, receipts, inbound mail, relay copies, record notices and cc digests share a 🐀 Rat King header. Known callsigns lead, coloured by role, with the mailbox name dimmed after the label; unknown parties keep their plain name. Quiet copies show a compact cc tag. Reply instructions stay in model context and appear on screen only when expanded with ctrl+o. The callable tool name remains `intercom`.

## Foundation

Use Node 24.18 or newer and the pinned pnpm version. Install gitleaks before using the publication fence.

```sh
pnpm install
pnpm check
pnpm test
pnpm vendor:agent-sources
```

`pnpm typecheck:fast` for the edit loop; the gate stays on patched tsc.

The source mirrors are reference-only and gitignored. No apps or packages exist yet.

Local commit and push hooks require a private instance denylist. See [the fence](tools/fence/README.md) and [the instance example](config/instance.example.json). CI runs generic rules only; it cannot certify a private instance.

Continuous deployment is off. The [ship skill](skills/ship/SKILL.md) owns release procedure.
