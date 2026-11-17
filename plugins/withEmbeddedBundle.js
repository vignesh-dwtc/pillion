/**
 * Expo config plugin: makes the DEBUG variant embed the JS bundle (Hermes bytecode) so the CI APK starts without Metro.
 *
 * React Native's Gradle plugin skips bundling for every variant listed in `react { debuggableVariants }`
 * (default ['debug', 'debugOptimized']; ReactExtension.kt: "Variants in this list will not be bundled (the bundle file will
 * not be created and won't be copied over)"; TaskConfiguration.kt registers `createBundle<Variant>JsAndAssets` only
 * `if (!isDebuggableVariant)`). Setting the list to empty bundles every variant, debug included. See docs/DECISIONS.md D-009.
 *
 * The app still has the dev menu / dev support (BuildConfig.DEBUG stays true); it simply also has a bundle to load.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = '// @pillion/withEmbeddedBundle';
const LINE = `debuggableVariants = [] ${MARKER}: embed the JS bundle in debug builds too (no Metro needed)`;

/**
 * Pure text transform of android/app/build.gradle. Idempotent. Throws when the `react {` block is missing.
 * @param {string} gradle
 * @returns {string}
 */
function embedBundleInDebug(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  const match = /^react \{[^\n]*\n/m.exec(gradle);
  if (!match) throw new Error('withEmbeddedBundle: no `react {` block found in android/app/build.gradle');
  const at = match.index + match[0].length;
  return `${gradle.slice(0, at)}    ${LINE}\n${gradle.slice(at)}`;
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withEmbeddedBundle = (config) =>
  withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = embedBundleInDebug(cfg.modResults.contents);
    return cfg;
  });

module.exports = withEmbeddedBundle;
module.exports.embedBundleInDebug = embedBundleInDebug;
