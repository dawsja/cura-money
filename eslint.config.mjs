import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'src/ui/node_modules/**',
      'src/ui/dist/**',
      'dist/**',
      'public/**',
      'drizzle/**',
      '**/*.d.ts',
      'src/ui/src/**',
      'src/db/schema/auth.ts',
    ],
  },
  js.configs.recommended,
  prettier,
];
