import { clip } from "./text.ts";
import type { Paint } from "./text.ts";

export interface FoldProps {
  readonly collapsed: () => readonly string[];
  readonly expanded: boolean;
  readonly full: () => readonly string[];
}

export const Fold = ({ collapsed, expanded, full }: FoldProps) =>
  expanded ? full() : collapsed();

export interface PreviewProps {
  readonly expanded: boolean;
  readonly lines: readonly string[];
  readonly room: number;
  readonly theme: Paint;
  readonly width: number;
}

export const Preview = ({
  expanded,
  lines,
  room,
  theme,
  width,
}: PreviewProps) =>
  Fold({
    collapsed: () => clip(theme, lines, room, width),
    expanded,
    full: () => lines,
  });
