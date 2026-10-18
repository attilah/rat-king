export interface StorePorts {
  readonly master: number;
  readonly masterGrpc: number;
  readonly volume: number;
  readonly volumeGrpc: number;
  readonly filer: number;
  readonly filerGrpc: number;
  readonly s3: number;
  readonly s3Grpc: number;
}

export const renderStoreArguments = (
  binary: string,
  data: string,
  config: string,
  ports: StorePorts
): readonly [string, ...string[]] => [
  binary,
  "server",
  "-ip=127.0.0.1",
  "-ip.bind=127.0.0.1",
  "-s3.ip.bind=127.0.0.1",
  ...Object.entries({
    "filer.port": ports.filer,
    "filer.port.grpc": ports.filerGrpc,
    "master.port": ports.master,
    "master.port.grpc": ports.masterGrpc,
    "s3.port": ports.s3,
    "s3.port.grpc": ports.s3Grpc,
    "volume.port": ports.volume,
    "volume.port.grpc": ports.volumeGrpc,
  }).map(([flag, port]) => `-${flag}=${port}`),
  "-filer",
  "-s3",
  `-dir=${data}`,
  `-s3.config=${config}`,
  "-s3.port.iceberg=0",
  "-s3.port.lance=0",
  "-s3.port.https=0",
  "-filer.port.public=0",
  "-volume.port.public=0",
  "-webdav=false",
  "-sftp=false",
  "-iam=false",
  "-s3.iam=false",
  "-mq.broker=false",
  "-mq.agent=false",
  "-master.telemetry=false",
  "-metricsPort=0",
  "-metricsIp=127.0.0.1",
  "-debug=false",
  "-volume.pprof=false",
  "-master.volumeSizeLimitMB=64",
  "-volume.max=512",
  "-volume.preStopSeconds=0",
];
