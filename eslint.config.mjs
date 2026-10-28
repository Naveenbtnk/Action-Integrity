import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import importPlugin from 'eslint-plugin-import';

const deterministicModules = [
  'src/lib/gate/**/*.{ts,tsx}',
  'src/lib/policy/**/*.{ts,tsx}',
  'src/lib/approval/**/*.{ts,tsx}',
  'src/lib/executor/**/*.{ts,tsx}',
  'src/lib/verifier/**/*.{ts,tsx}',
  'src/lib/integrity/**/*.{ts,tsx}',
  'src/lib/exposure/**/*.{ts,tsx}',
];

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      'import/order': [
        'error',
        {
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          'newlines-between': 'always',
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: deterministicModules,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/agent', '@/lib/agent/**', '@google/genai'],
              message: 'Deterministic control modules must not import agent or LLM code.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'apps/public/.astro/**',
    'apps/public/dist/**',
    'node_modules/**',
    'storybook-static/**',
    'src/generated/prisma/**',
    'coverage/**',
    'artifacts/**',
    'var/**',
    'next-env.d.ts',
  ]),
]);
