import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'web-dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // NestJS resolves constructor parameters from their runtime classes, so these imports must stay value imports.
    files: ['server/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  { files: ['scripts/**/*.ts', 'tests/**/*.ts'], rules: { 'no-console': 'off' } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } } },
  { files: ['**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  prettier,
);
