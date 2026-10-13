import { oneLine } from "./text.ts";

export interface ShortIdProps {
  readonly expanded?: boolean;
  readonly id: string;
}

export const ShortId = ({ expanded = false, id }: ShortIdProps) =>
  expanded ? oneLine(id) : oneLine(id).slice(0, 8);
