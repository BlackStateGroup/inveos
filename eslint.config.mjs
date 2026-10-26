import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, {
  files: ['apps/web/src/**/*.{ts,tsx}'],
  rules: { '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}] }
});
