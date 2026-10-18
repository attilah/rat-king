import type { BinaryProps } from "../../packages/alchemy-nest/src/release.ts";

export const fleetCelldBuild = {
  buildCommand: "cargo +1.98.1 build --release --locked",
  package: "gzip -9 -n -c target/release/celld",
  source: "celld ce4f4dc3514cd5cce209a77bebafdae8d69afdcc",
};

export const fleetCelldBinary = (home: string): Omit<BinaryProps, "path"> => ({
  asset: {
    format: "gz",
    memberSha256:
      "f139756468bb3b6d842fb6f78606262012b8ad5f813a1a9606592f04853723b5",
  },
  hostSource: `${home}/.local/share/rat-king/artifacts/celld-ce4f4dc-x86_64-unknown-linux-gnu.gz`,
  sha256: "8f6fc721e9a9515c3b3667241e1bae9b26cfb78fcbdfa170a8ce1ea1331d5074",
  size: 25_324_630,
});
