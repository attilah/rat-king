import type { Effect } from "effect";
import { Context, Schema } from "effect";

import type { SliceError } from "./slice-error.ts";

export { SliceError } from "./slice-error.ts";

export const SliceChunkSchema = Schema.Struct({
  chunk_id: Schema.String,
  role: Schema.String,
  started_at: Schema.Int,
  text: Schema.String,
});

export type SliceChunk = typeof SliceChunkSchema.Type;

export const ChunkMetadataSchema = Schema.Struct({
  chunk_id: Schema.String,
  conversation: Schema.String,
  role: Schema.String,
  rowid: Schema.Int,
  started_at: Schema.Int,
  token_count: Schema.Int,
});

export type ChunkMetadata = typeof ChunkMetadataSchema.Type;

export const SignatureSchema = Schema.Struct({
  literal: Schema.String,
  role: Schema.optionalKey(Schema.String),
  since_ms: Schema.Int,
});

export type Signature = typeof SignatureSchema.Type;

export const CountResultSchema = Schema.Struct({
  by_day: Schema.Array(
    Schema.Struct({ conversations: Schema.Int, day: Schema.String })
  ),
  conversations: Schema.Int,
});

export type CountResult = typeof CountResultSchema.Type;

export interface ChunkPage {
  readonly items: readonly ChunkMetadata[];
  readonly next: number;
}

export interface SliceResult {
  readonly conversation: string;
  readonly first: string;
  readonly last: string;
  readonly chunks: readonly SliceChunk[];
  readonly sha256: string;
}

export interface QuoteResult {
  readonly chunk: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly sha256: string;
}

export class SliceSource extends Context.Service<
  SliceSource,
  {
    readonly slice: (
      conversation: string,
      first: string,
      last: string
    ) => Effect.Effect<readonly SliceChunk[], SliceError>;
    readonly quote: (
      chunk: string,
      start: number,
      end: number
    ) => Effect.Effect<string, SliceError>;
    readonly chunks: (
      after: number,
      limit: number,
      idleMs: number
    ) => Effect.Effect<ChunkPage, SliceError>;
    readonly count: (
      signature: Signature
    ) => Effect.Effect<CountResult, SliceError>;
  }
>()("@rat-king/SliceSource") {}

export const maxSliceBytes = 256 * 1024;

export const canonicalChunks = (chunks: readonly SliceChunk[]): string =>
  JSON.stringify(
    chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      role: chunk.role,
      started_at: chunk.started_at,
      text: chunk.text,
    }))
  );
