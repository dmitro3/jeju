import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'lib/stubs/**',
    ],
  },
];
