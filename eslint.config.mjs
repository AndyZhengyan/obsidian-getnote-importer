import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['main.js', 'node_modules/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
