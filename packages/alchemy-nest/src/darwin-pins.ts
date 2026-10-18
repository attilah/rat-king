import type { BinaryProps } from "./release.ts";

export const darwinWeedBinary = (path: string): BinaryProps => ({
  asset: {
    format: "tar.gz",
    member: "weed",
    memberSha256:
      "1e836167ed1882c0acac670b753b436edd8303834139ea2bdc80b400446119c9",
  },
  path,
  sha256: "faa194e72a346755dc4404288b0561eb3c260351702901d8363024d5099bdd7d",
  size: 42_699_632,
  url: "https://github.com/seaweedfs/seaweedfs/releases/download/4.48/darwin_arm64.tar.gz",
});

export const darwinCelldBinary = (path: string): BinaryProps => ({
  asset: {
    format: "gz",
    memberSha256:
      "91f6d7a470720c300efddf75e666f121c0f51bbaf7a245d9d76efffaefeecf57",
  },
  path,
  sha256: "3033cc4f428433f4239ac616a04092cd4b6c7db19f2f5ba9926c86ec56c34c95",
  size: 22_043_344,
  url: "https://github.com/denoland/celld/releases/download/v0.6.1/celld-aarch64-apple-darwin.gz",
});
