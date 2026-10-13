import type { Paint } from "./text.ts";

export interface FooterProps {
  readonly cc?: string | undefined;
  readonly hint?: string | undefined;
  readonly relay?: string | undefined;
  readonly reply?: string | undefined;
  readonly sentBy?: string | undefined;
  readonly theme: Paint;
  readonly warning?: string | undefined;
}

export const Footer = ({
  cc,
  hint,
  relay,
  reply,
  sentBy,
  theme,
  warning,
}: FooterProps) =>
  [sentBy, cc, reply, relay, warning, hint]
    .filter((part) => part !== undefined)
    .join(theme.fg("dim", " · "));
