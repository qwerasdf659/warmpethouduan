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
   * `scripts/*.js` 的回归脚本：只做基础检查 + 格式化，关掉需要类型信息的规则。
   *
   * 必须放在**最后** —— 上面那个通用 rules 块会把 `no-floating-promises` 之类的
   * 类型规则重新打开，而这些脚本是 CommonJS、不属于任何 tsconfig project，
   * 类型规则一碰它们就直接抛错。
   *
   * 但把它们完全排除在检查之外也不行：账本重构删掉 `wallet`/`ledger`/`item_owned`/
   * `item_def` 之后，这 7 个脚本全部失效却没有任何信号，正是因为它们游离在
   * lint 与 tsc 之外。基础检查至少能挡住语法错、未定义变量、未使用引用这类腐坏。
   */
  {
    files: ['scripts/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
