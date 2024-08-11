module.exports = {
  env: {
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:eslint-comments/recommended',
    'plugin:import/recommended',
    'plugin:typescript-sort-keys/recommended',
  ],
  globals: {},
  overrides: [
    {
      files: ['src/server-validation/index.ts'],
      rules: {
        'no-useless-escape': 'off',
        'sort-keys': 'off',
      },
    },
    {
      files: ['src/inject-env/index.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      files: ['*.ts'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'error',
      },
    },
    {
      env: {
        mocha: true,
      },
      files: '*.spec.*',
    },
    {
      files: ['test/__mocks__/log.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    project: './tsconfig.eslint.json',
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
    'unused-imports',
    'import',
    'typescript-sort-keys',
  ],
  root: true,
  rules: {
    '@typescript-eslint/ban-ts-comment': 'error',
    '@typescript-eslint/ban-types': [
      'error',
      {
        extendDefaults: false,
        types: {
          Boolean: 'Avoid using the `Boolean` type. Did you mean `boolean`?',
          Number: 'Avoid using the `Number` type. Did you mean `number`?',
          Object: 'Avoid using the `Object` type. Did you mean `object`?',
          String: 'Avoid using the `String` type. Did you mean `string`?',
          Symbol: 'Avoid using the `Symbol` type. Did you mean `symbol`?',
        },
      },
    ],
    '@typescript-eslint/member-delimiter-style': [
      'error',
      {
        multiline: {
          delimiter: 'semi',
          requireLast: true,
        },
        singleline: {
          delimiter: 'semi',
          requireLast: false,
        },
      },
    ],
    '@typescript-eslint/no-array-constructor': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-empty-interface': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': ['error'],
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/semi': ['error', 'always'],
    'brace-style': ['error'],
    'comma-dangle': ['error', 'always-multiline'],
    'comma-spacing': ['error', { 'after': true, 'before': false }],
    'comma-style': ['error', 'last'],
    'curly': ['error'],
    'eol-last': ['error'],
    'eslint-comments/no-use': 'error',
    'import/newline-after-import': 'error',
    'import/no-unresolved': 'off',
    'import/order': ['error', {
      'alphabetize': {
        'caseInsensitive': true,
        'order': 'asc',
      },
      'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      'newlines-between': 'always',
      'warnOnUnassignedImports': true,
    },
    ],
    'indent': ['error', 2, { 'SwitchCase': 1 }],
    'keyword-spacing': ['error'],
    'max-classes-per-file': ['error', 10],
    'max-len': ['error', 200],
    'no-console': 'warn',
    'no-empty': 'off',
    'no-multi-spaces': ['error'],
    'no-multiple-empty-lines': ['error', { 'max': 1, 'maxEOF': 0 }],
    'no-prototype-builtins': 'off',
    'no-trailing-spaces': 'error',
    'no-use-before-define': 'off',
    'no-var': 'error',
    'object-curly-spacing': ['error', 'always'],
    'prefer-const': ['error', { destructuring: 'all' }],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'sort-imports': ['error',
      {
        ignoreCase: true,
        ignoreDeclarationSort: true,
      // ignoreMemberSort: true,
      // allowSeparatedGroups: true
      },
    ],
    'sort-keys': 'error',
    'sort-vars': 'error',
    'space-before-blocks': 'error',
    'space-infix-ops': 'error',
    'unused-imports/no-unused-imports': 'error',
  },
  settings: {
    'import/ignore': [ /@mui\/material/ ],
    react: {
      version: 'detect',
    },
  },
};
