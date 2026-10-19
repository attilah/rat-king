import { Effect } from "effect";
import * as Base64Url from "effect/encoding/Base64Url";

import { refusal } from "./pass-failure.ts";
import type { PublicKeyValue } from "./trust.ts";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const prime =
  0xff_ff_ff_ff_00_00_00_01_00_00_00_00_00_00_00_00_00_00_00_00_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ff_ffn;

const curveB =
  0x5a_c6_35_d8_aa_3a_93_e7_b3_eb_bd_55_76_98_86_bc_65_1d_06_b0_cc_53_b0_f6_3b_ce_3c_3e_27_d2_60_4bn;

const mod = (value: bigint) => ((value % prime) + prime) % prime;

const power = (base: bigint, exponent: bigint): bigint => {
  let result = 1n;
  let current = mod(base);
  let remaining = exponent;

  while (remaining > 0n) {
    if (remaining % 2n === 1n) {
      result = mod(result * current);
    }

    current = mod(current * current);
    remaining /= 2n;
  }

  return result;
};

const coordinate = (value: bigint) => {
  const hex = value.toString(16).padStart(64, "0");

  return Base64Url.encode(
    Uint8Array.from({ length: 32 }, (_, index) =>
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    )
  );
};

const decode = (did: string): PublicKeyValue => {
  if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{48}$/u.test(did)) {
    throw new Error("not a canonical P-256 did:key");
  }

  let value = 0n;

  for (const char of did.slice(9)) {
    value = value * 58n + BigInt(alphabet.indexOf(char));
  }

  const hex = value.toString(16);

  if (hex.length !== 70 || !hex.startsWith("8024")) {
    throw new Error("not the P-256 multicodec");
  }

  const prefix = Number.parseInt(hex.slice(4, 6), 16);
  const x = BigInt(`0x${hex.slice(6)}`);

  if ((prefix !== 2 && prefix !== 3) || x >= prime) {
    throw new Error("invalid compressed P-256 point");
  }

  const square = mod(x * x * x - 3n * x + curveB);
  const root = power(square, (prime + 1n) / 4n);

  if (mod(root * root) !== square) {
    throw new Error("point is not on P-256");
  }

  const y = Number(root % 2n) === prefix % 2 ? root : prime - root;

  return { crv: "P-256", kty: "EC", x: coordinate(x), y: coordinate(y) };
};

export const decodeDidKey = (did: string) =>
  Effect.try({
    catch: () =>
      refusal(
        "Key refused",
        "expected a canonical P-256 did:key",
        "generate a P-256 worker key and use its multibase DID"
      ),
    try: () => decode(did),
  });
