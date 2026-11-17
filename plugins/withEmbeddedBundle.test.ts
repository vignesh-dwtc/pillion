import { embedBundleInDebug } from './withEmbeddedBundle';

const GRADLE = `apply plugin: "com.facebook.react"

react {
    entryFile = file("index.js")
    // debuggableVariants = ["liteDebug", "prodDebug"]
    autolinkLibrariesWithApp()
}
`;

describe('withEmbeddedBundle', () => {
  it('inserts an empty debuggableVariants list as the first line of the react block', () => {
    const out = embedBundleInDebug(GRADLE);
    expect(out).toMatch(/react \{\n {4}debuggableVariants = \[\] \/\/ @pillion\/withEmbeddedBundle/);
    expect(out).toContain('entryFile = file("index.js")');
  });

  it('is idempotent', () => {
    const once = embedBundleInDebug(GRADLE);
    expect(embedBundleInDebug(once)).toBe(once);
  });

  it('throws when there is no react block', () => {
    expect(() => embedBundleInDebug('android { }')).toThrow(/react \{/);
  });
});
