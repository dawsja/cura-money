import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const tsFiles = ['src/**/*.ts', 'scripts/**/*.ts', 'drizzle.config.ts'];

export default [
  {
    ignores: [
      'node_modules/**',
      'src/ui/**',
      'dist/**',
      'public/**',
      'drizzle/**',
      '**/*.d.ts',
      'src/ui/src/**',
      'src/db/schema/auth.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: tsFiles })),
  {
    files: tsFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
    },
  },
  prettier,
];
