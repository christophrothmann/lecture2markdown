module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  globals: {
    __APP_VERSION__: 'readonly',
  },
  extends: [
    'eslint:recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-redeclare': 'off',
    '@typescript-eslint/no-redeclare': 'off',
    'no-useless-escape': 'off',
    'no-useless-catch': 'warn',
  },
};
