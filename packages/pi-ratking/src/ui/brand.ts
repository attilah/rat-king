import type { Paint } from "./text.ts";

export const BRAND = "🐀";

export interface BrandProps {
  readonly theme: Paint;
}

export const Brand = ({ theme }: BrandProps) =>
  theme.fg("toolTitle", theme.bold(BRAND));
