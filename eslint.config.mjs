// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // NestJS 的 @Body()/@Param() 有时只为触发校验管道而声明，本身用不到；
      // 约定以 _ 开头表示「有意不使用」，避免为了过 lint 写无意义的引用。
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  /*
   * 单文件行数软上限（P3-8）。只算「代码行」（跳过空行与注释），因此**不惩罚注释**——
   * 本仓库靠大段「为什么」注释承载设计意图，按总行数卡会逼人删注释，正好卡反。
   *
   * 上限 800 是按当前最大的账本引擎（`ledger.service` 约 750 代码行）留出的余量：
   * 双录记账引擎是一台环环相扣的事务机器，强行再拆只会把守恒逻辑打散。真要再涨，
   * 就得先像市场那样把只读层/结算层拆出去，而不是继续往一个文件里堆。
   *
   * 只管生产代码：迁移是自动生成的 SQL、测试是逐用例堆叠的，两者按行数卡都没有意义。
   */
  {
    files: ['src/**/*.ts'],
    ignores: ['src/migrations/**', 'src/**/*.spec.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },
);
