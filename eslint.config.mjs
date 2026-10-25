// Mandatory linting gate. Run via `npm run lint`, which uses --max-warnings 0:
// every rule violation fails the build, including anything set to "warn".
// Type-checked presets resolve per-file tsconfigs through the project service
// (src/, tests/ and scripts/ each have their own tsconfig).
//
// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'licenses/**', // vendored third-party license texts
      'src/types/**', // vendored vscode API proposal typings (upstream-owned)
      '**/*.vsix',
      'package-lock.json',
    ],
  },

  // Base non-TS-aware rules for everything (JS + TS).
  eslint.configs.recommended,

  // TypeScript sources: strict, type-checked linting.
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Underscore-prefixed args/vars/caught errors are intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Public-facing functions must declare their return type.
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true, allowIIFEs: true },
      ],
      // Interpolating uids, pids and ports into shell commands is routine here;
      // numbers stringify deterministically. Anything else (nullish, any,
      // booleans) stays an error.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: false,
          allowNullish: false,
          allowAny: false,
          allowRegExp: true,
        },
      ],
      // `a || b` on booleans is falsy logic, not nullish fallback.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { boolean: true } },
      ],
      // Semantic hygiene.
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Hand-written CommonJS build/tooling scripts are plain JS: no tsconfig
  // membership, so type-checked rules are disabled and Node globals/CJS are
  // enabled instead.
  {
    files: ['esbuild.js', 'assets/*.js', 'scripts/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // Test harness and dev-loop scripts: the offline fixture boundary hands
  // OPAQUE values into production code and re-captures them loosely, so
  // `any` is a deliberate part of their design. The unsafe-`any` family
  // exists to protect shipped code and would misfire on these stubs.
  // Everything else — including the strict compiler flags — stays at full
  // strength for tests and scripts.
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Captured `let` state mutated across mocked timers and `await` points
      // makes the rule's control-flow reasoning chronically unsound here
      // (upstream typescript-eslint ships its own tests with this disabled).
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // `test(name, fn)` from node:test returns a promise by design.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [{ from: 'lib', name: ['test', 'describe', 'it', 'suite'] }],
        },
      ],
      // Stub no-op listeners and empty test scaffolding are normal here.
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions', 'functions', 'methods'] },
      ],
    },
  },

  // Prettier owns formatting; turn off ESLint rules that would fight it.
  prettierConfig,
);
