import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 只跑 src/utils 下的纯逻辑单测。
 *
 * 这里刻意不接 Umi/React 的渲染环境：菜单装树与放行判断被单独拆到 utils/menu-tree.ts
 * 就是为了能脱离组件测，environment 保持 node、不引 jsdom，跑一次几百毫秒。
 * 将来要测组件再单独加配置，不要为了那一天先把这套拖重。
 */
export default defineConfig({
  resolve: {
    // 复刻 Umi 的 @ 别名，否则 import type { ... } from '@/types' 解析不到
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
