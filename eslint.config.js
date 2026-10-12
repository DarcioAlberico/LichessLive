import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='eval']",
          message: 'eval é proibido em extensões MV3.',
        },
      ],
    },
  },
  {
    // Camada de domínio: TypeScript puro, sem DOM, Chrome ou Preact.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['preact', 'preact/*', '../../adapters/*', '../../presentation/*', '../../persistence/*'],
        },
      ],
      'no-restricted-globals': [
        'error',
        'chrome',
        'document',
        'window',
        'fetch',
        'indexedDB',
        'localStorage',
      ],
    },
  },
  {
    // Apresentação não faz fetch diretamente.
    files: ['src/presentation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'chrome', 'indexedDB'],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'playwright.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' },
    },
  },
);
