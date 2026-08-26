/**
 * 改后台账号口令，**同时**更新数据库与 `.env` 的 ADMIN_INIT_PASSWORD。
 *
 *   npm run admin:passwd                      # 改 ADMIN_INIT_USERNAME 的账号，随机生成口令
 *   npm run admin:passwd -- --password 'xxx'  # 指定口令
 *   npm run admin:passwd -- --user 13800000000
 *
 * 为什么要有这个脚本：后台「系统管理 → 管理员 → 重置密码」只改库不碰 `.env`，
 * 而 `.env` 的 ADMIN_INIT_PASSWORD 同时被当作「重建库时的播种种子」和「口令备忘录」。
 * 走 UI 改密会让备忘录静默变成旧值，直到某天重建库才发现登不进去。
 * 这里把两边并成一次操作，让「不会漂移」成为最省事的路径。
 *
 * 只在改的是 ADMIN_INIT_USERNAME 那个账号时才回写 `.env`——其他管理员的口令
 * 本来就不该记进 `.env`，回写它们只会制造新的假真相源。
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from '../../src/admin/utils/password.util';
import { makeClient } from './_db';

const ENV_PATH = join(__dirname, '..', '..', '.env');
const ENV_KEY = 'ADMIN_INIT_PASSWORD';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * 生成 20 位口令。刻意避开 `'`、`"`、`\`、`$`、`` ` ``：这些字符在 `.env`、
 * shell 单双引号、curl 命令里各有一套转义规则，混进去之后「口令是对的但登不进」
 * 会被误判成认证 bug。牺牲这几个符号换来的确定性远比那点熵值划算。
 */
const ALPHABET =
  'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%^&*-_=+';

function generatePassword(len = 20): string {
  const bytes = randomBytes(len * 2);
  let out = '';
  for (let i = 0; out.length < len && i < bytes.length; i++) {
    // 取模会让排在前面的字符略微偏多，此处丢弃越界字节以保持均匀
    if (bytes[i] < 256 - (256 % ALPHABET.length)) {
      out += ALPHABET[bytes[i] % ALPHABET.length];
    }
  }
  return out.length === len ? out : generatePassword(len);
}

/**
 * 原地替换 `.env` 里的那一行，保留文件其余部分（注释、顺序、空行）一字不动。
 * 不用「读成对象再整体写回」的做法：那会把注释和排版全冲掉，而这个文件里的注释
 * 恰恰是解释「为什么保留明文」的关键上下文。
 */
function updateEnvFile(password: string): 'updated' | 'appended' {
  const original = readFileSync(ENV_PATH, 'utf8');
  const line = `${ENV_KEY}=${password}`;
  const pattern = new RegExp(`^${ENV_KEY}=.*$`, 'm');

  if (pattern.test(original)) {
    writeFileSync(ENV_PATH, original.replace(pattern, line));
    return 'updated';
  }
  const sep = original.endsWith('\n') ? '' : '\n';
  writeFileSync(ENV_PATH, `${original}${sep}${line}\n`);
  return 'appended';
}

async function main(): Promise<void> {
  const initUsername = process.env.ADMIN_INIT_USERNAME ?? 'admin';
  const username = argOf('--user') ?? initUsername;
  const password = argOf('--password') ?? generatePassword();

  if (password.length < 12) {
    throw new Error('口令至少 12 位（后台超管可改余额与全站配置，别用短口令）');
  }

  const client = makeClient();
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `UPDATE admin_user SET password_hash = $1, updated_at = now() WHERE username = $2`,
      [await hashPassword(password), username],
    );
    if (!rowCount) {
      throw new Error(`账号不存在：${username}`);
    }
    console.log(`✓ 已更新数据库口令：${username}`);

    if (username === initUsername) {
      const how = updateEnvFile(password);
      console.log(
        `✓ 已${how === 'updated' ? '更新' : '追加'} .env 的 ${ENV_KEY}`,
      );
    } else {
      console.log(
        `· 未回写 .env：${username} 不是 ADMIN_INIT_USERNAME（${initUsername}），` +
          '其口令不该记进 .env',
      );
    }

    console.log(`\n新口令：${password}\n`);
    console.log('应用进程内没有缓存口令，无需重启即可用新口令登录。');
  } finally {
    await client.end();
  }
}

void main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
