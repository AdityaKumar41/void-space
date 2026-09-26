// Root ESLint flat config (ESLint 9). Shared baseline for the whole monorepo.
// App-specific overrides live next to the app (e.g. apps/web/eslint.config.mjs).
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/.turbo/**',
      '**/generated/**',
      'packages/contracts/lib/**',
      'packages/contracts/out/**',
      'packages/contracts/cache/**',
      /*
       * The editor is a vendored fork of FaberLeaf (apps/studio-web) and is excluded from this
       * workspace, so this config's rules are not the rules its source was written against. Linting
       * it here would report thousands of style findings in third-party code we intend to diverge
       * from, and — worse — would drown the findings in our own packages, which is the only signal
       * this config exists to produce.
       *
       * It keeps its own `eslint.config.js` and `pnpm --dir apps/studio-web lint`.
       */
      'apps/studio-web/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
);
