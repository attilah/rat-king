---
name: ratking-tui
description: Build or change a Rat King TUI view, inline message, receipt, notice, digest or status. Use the owned rendering primitives and verify their width and grammar properties.
---

# Rat King TUI

Grammar: `🐀 <verb> <party> · <short facts>`. The call owns the header; its result does not repeat it. Delivery ticks belong to receipts, never inbound mail.

Compose, never draw. Read [the swipe file](references/primitives.md) for props, variants and composition examples. Use `src/ui/` primitives. Add a swipe-file entry when adding a primitive; regenerate with `pnpm --filter pi-ratking tui:frames`.

Collapsed parties show the callsign alone, or the raw name when no callsign exists. Expand to `callsign (name)`. Spend the saved space on content: receipt `✓ party · summary · id8`, inbound header `🐀 from party · summary`. Reserve the receipt id before truncating the summary. Multiple recipients share one summary row. Render repeated summary/body prefixes once; a reply's footer does not repeat its header id.

Keep full model content. Only renders fold; rendering must not edit the message, summary, id or diagnostics the model receives.

Read the matching pattern at [Pi TUI patterns](https://pi-tui.ratstack.sh): [Identity Anchor](https://pi-tui.ratstack.sh/patterns/identity-anchor.md) for Party; [Call Capsule](https://pi-tui.ratstack.sh/patterns/call-capsule.md) for call/result shells; [Keyed Slot](https://pi-tui.ratstack.sh/patterns/keyed-slot.md) for tags; [Detail Fold](https://pi-tui.ratstack.sh/patterns/detail-fold.md) for receipts; [Error Digest](https://pi-tui.ratstack.sh/patterns/error-digest.md) for faults; [Message Fold](https://pi-tui.ratstack.sh/patterns/message-fold.md) for boxes and previews.

## Completion check

- Render at 40, 60, 80 and 120 columns, in dark and light themes. Check width, style closure and collapsed height.
- Run the border property and header-grammar property in `test/inline-view.test.ts`.
- Run `test/tui-kit.test.ts`: generated frames must match; a view containing its own literal rat mark must fail.
- Run `test/compact-content.test.ts`: repeated-party plants fail, summaries spend spare width, ids stay visible, and pending omits empty sections.
- For pure extractions, snapshots remain byte-identical. Refresh snapshots only for approved behavior changes and list the refresh.
- Run `pnpm check` and `pnpm test`. Report untested claims rather than adding duplicate tests.
