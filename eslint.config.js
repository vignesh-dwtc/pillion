// ESLint flat config. The architecture rules below are part of the project contract (docs/ARCHITECTURE.md):
//   src/core      pure TypeScript: no react / react-native / expo, no UI, and only the platform *interface* files
//   src/platform  interfaces + native (.ts) and web (.web.ts) implementations
//   web-only code (*.web.ts / *.web.tsx) must never be imported explicitly from native code
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

/** Interface files src/core may import (relative to src/platform). Keep in sync with docs/ARCHITECTURE.md. */
const PLATFORM_INTERFACE_FILES = [
  'link/LinkTransport.ts',
  'media/MediaEngine.ts',
  'audio/AudioRoute.ts',
  'audio/AudioTunables.ts',
  'service/RideService.ts',
  'permissions/PermissionService.ts',
  'storage/stores.ts',
];

module.exports = defineConfig([
  globalIgnores([
    'dist/**',
    'android/**',
    'ios/**',
    'node_modules/**',
    '.expo/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'e2e/.artifacts/**',
    'server/node_modules/**',
  ]),
  expoConfig,
  prettierConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Native/shared code must not import web-only modules explicitly (Metro picks .web.ts by platform extension).
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.web.{ts,tsx}', 'e2e/**', 'scripts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.web', '**/*.web.ts', '**/*.web.tsx'],
              message: 'Never import web-only modules from native code.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/core: pure TypeScript.
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-native',
                'react-native-*',
                'react-dom',
                'expo',
                'expo-*',
                '@react-native/*',
                '@react-navigation/*',
                '@livekit/*',
                'zustand',
                'react-native-mmkv',
              ],
              message: 'src/core must stay pure TypeScript: no react / react-native / expo imports.',
            },
            { group: ['**/features/**', '**/app/**'], message: 'src/core cannot depend on UI layers.' },
            {
              group: ['**/*.web', '**/*.web.ts', '**/*.web.tsx'],
              message: 'Never import web-only modules from native code.',
            },
          ],
        },
      ],
    },
  },
  {
    // Layering: core -> (platform interface files only); platform -> core; neither may reach up into the UI.
    files: ['src/core/**/*.{ts,tsx}', 'src/platform/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/core',
              from: './src/platform',
              except: PLATFORM_INTERFACE_FILES.map((f) => `./${f}`),
              message:
                'src/core may only import platform interface files (see eslint.config.js), never implementations.',
            },
            { target: './src/core', from: './src/features', message: 'src/core cannot depend on UI layers.' },
            { target: './src/core', from: './src/app', message: 'src/core cannot depend on UI layers.' },
            {
              target: './src/platform',
              from: './src/features',
              message: 'src/platform cannot depend on UI layers.',
            },
            {
              target: './src/platform',
              from: './src/app',
              message: 'src/platform cannot depend on UI layers.',
            },
          ],
        },
      ],
    },
  },
  {
    // Platform interface files are imported by core: they must stay free of react-native.
    files: PLATFORM_INTERFACE_FILES.map((f) => `src/platform/${f}`),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-native',
                'react-native-*',
                'expo',
                'expo-*',
                '@react-native/*',
                '@livekit/*',
              ],
              message:
                'Platform interface files are imported by src/core and must not import react-native / expo.',
            },
          ],
        },
      ],
    },
  },
  {
    // Platform code must not reach up into UI.
    files: ['src/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/features/**', '**/app/**'], message: 'src/platform cannot depend on UI layers.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts', 'scripts/**/*.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
]);
