import {
  type BinaryLike,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';

// scrypt 有多个重载，裸 promisify 会把结果推成 unknown；显式给出泛型拿到 Buffer。
const scrypt = promisify<BinaryLike, BinaryLike, number, Buffer>(scryptCb);

const KEYLEN = 64;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

/**
 * 口令散列（Node 内置 scrypt，免第三方依赖 / 免原生编译）。
 * 存储格式：`scrypt$<saltHex>$<hashHex>`，绝不落明文。
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEYLEN);
  return `${PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * 校验口令。用 timingSafeEqual 做定长比较，避免计时侧信道。
 * 存储格式不合法或校验失败一律返回 false（不抛异常）。
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = await scrypt(plain, salt, expected.length || KEYLEN);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
