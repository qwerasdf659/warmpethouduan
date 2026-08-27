/**
 * 最小 S3 客户端（AWS Signature V4，path-style）。
 *
 * **为什么不装 SDK**：`@aws-sdk/client-s3` 20+ MB，而这里只需要 PUT / HEAD 两个动作。
 * 项目在同类取舍上一贯选自己写（分区维护没装 `pg_partman`，理由是「多一个依赖，
 * 而 Sealos 托管 PG 未必允许装扩展」）。
 *
 * **手写签名的风险与对策**：签错的直接后果是「归档看起来成功、其实什么都没上传」——
 * 而归档之后要删库里的分区，这是能造成永久数据丢失的那类 bug。因此
 * `putObjectVerified()` 上传后**必须读回校验大小**，校验不过就抛错，
 * 让调用方停在「已转储但未删除」这个安全状态上。
 *
 * 只支持 Sealos 对象存储所需的最小集：path-style 寻址、SHA256 载荷签名、
 * 无分片上传（分录按月转储，单文件量级在几十到几百 MB，一次 PUT 足够）。
 */
import { createHash, createHmac } from 'node:crypto';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/** 从环境变量读配置。任一必填项缺失就返回 null（调用方据此跳过上传）。 */
export function s3ConfigFromEnv(): S3Config | null {
  const endpoint =
    process.env.SEALOS_INTERNAL_ENDPOINT ??
    process.env.SEALOS_EXTERNAL_ENDPOINT;
  const region = process.env.SEALOS_REGION;
  const bucket = process.env.SEALOS_BUCKET;
  const accessKey = process.env.SEALOS_ACCESS_KEY;
  const secretKey = process.env.SEALOS_SECRET_KEY;

  if (!endpoint || !region || !bucket || !accessKey || !secretKey) return null;
  // 占位值当作未配置：.env.example 里是 your_bucket / your_access_key，
  // 拿着占位值去签名只会得到一个费解的 403
  if (bucket.startsWith('your_') || accessKey.startsWith('your_')) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    region,
    bucket,
    accessKey,
    secretKey,
  };
}

const sha256Hex = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * 签一个请求，返回可直接用于 `fetch` 的 headers。
 *
 * URI 编码规则是 SigV4 最容易踩错的地方：S3 的 CanonicalURI 要对 key 逐段编码，
 * 但**保留 `/`**。用 `encodeURIComponent` 整串编码会把 `/` 变成 `%2F`，
 * 签名与服务端算出来的对不上，报错是含糊的 `SignatureDoesNotMatch`。
 */
function sign(
  cfg: S3Config,
  method: 'PUT' | 'HEAD' | 'GET',
  key: string,
  payload: Buffer,
): Record<string, string> {
  const url = new URL(cfg.endpoint);
  const host = url.host;
  const canonicalUri = `/${cfg.bucket}/${key}`
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretKey}`, dateStamp), cfg.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    Host: host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function objectUrl(cfg: S3Config, key: string): string {
  const encoded = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${cfg.endpoint}/${cfg.bucket}/${encoded}`;
}

/** 对象大小（字节）。不存在返回 null。 */
export async function headObject(
  cfg: S3Config,
  key: string,
): Promise<number | null> {
  const res = await fetch(objectUrl(cfg, key), {
    method: 'HEAD',
    headers: sign(cfg, 'HEAD', key, Buffer.alloc(0)),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HEAD ${key} 失败：${res.status} ${res.statusText}`);
  }
  return Number(res.headers.get('content-length') ?? 0);
}

/**
 * 上传并**读回校验大小**。
 *
 * 校验不是多余的一步：手写签名一旦有细节错误，某些 S3 实现会返回 2xx 而实际没落盘，
 * 或者代理层吞掉请求体。归档的下一步是删库里的分区，所以这里必须确认对象真的在。
 */
export async function putObjectVerified(
  cfg: S3Config,
  key: string,
  body: Buffer,
  contentType = 'application/gzip',
): Promise<void> {
  const res = await fetch(objectUrl(cfg, key), {
    method: 'PUT',
    headers: {
      ...sign(cfg, 'PUT', key, body),
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `上传 ${key} 失败：${res.status} ${res.statusText} ${detail.slice(0, 300)}`,
    );
  }

  const size = await headObject(cfg, key);
  if (size === null) {
    throw new Error(`上传 ${key} 后读回为 404：对象没有真的落盘`);
  }
  if (size !== body.byteLength) {
    throw new Error(
      `上传 ${key} 后大小不符：本地 ${body.byteLength} B、远端 ${size} B`,
    );
  }
}
