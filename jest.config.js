/**
 * Jest runs the pure-TypeScript layers in a plain Node environment on purpose: if src/core accidentally imports
 * react-native, its tests fail. UI is verified through the web build + Playwright (e2e/), not component tests.
 */
const moduleNameMapper = {
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@config/(.*)$': '<rootDir>/config/$1',
  '^@specs/(.*)$': '<rootDir>/specs/$1',
};

const transform = {
  '^.+\\.(ts|tsx|js|jsx|mjs)$': ['babel-jest', { presets: ['babel-preset-expo'] }],
};

module.exports = {
  passWithNoTests: true,
  projects: [
    {
      displayName: 'core',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/core'],
      testMatch: ['**/*.test.ts'],
      moduleNameMapper,
      transform,
      // @noble/hashes is ESM-only; transpile it for Jest's CommonJS runtime.
      transformIgnorePatterns: ['/node_modules/(?!(@noble)/)'],
    },
    {
      displayName: 'platform',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/platform', '<rootDir>/src/app', '<rootDir>/src/features', '<rootDir>/scripts'],
      testMatch: ['**/*.test.ts'],
      moduleNameMapper,
      transform,
      transformIgnorePatterns: ['/node_modules/(?!(@noble)/)'],
    },
  ],
};
