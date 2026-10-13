import type { Paint } from "./text.ts";

export type TagVariant = "default" | "quiet" | "held" | "woken";

export interface TagProps {
  readonly theme: Paint;
  readonly variant: TagVariant;
}

export const Tag = ({ theme, variant }: TagProps) =>
  variant === "default" ? undefined : theme.fg("dim", variant);
