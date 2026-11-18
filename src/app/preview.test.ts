import { previewFromSearch, sampleSessionFor } from './preview';

describe('ride preview (M0 placeholder)', () => {
  it('reads ?preview= and falls back to connected', () => {
    expect(previewFromSearch('?preview=reconnecting')).toBe('reconnecting');
    expect(previewFromSearch('?a=1&preview=headset-missing')).toBe('headset-missing');
    expect(previewFromSearch('?preview=nonsense')).toBe('connected');
    expect(previewFromSearch(undefined)).toBe('connected');
  });

  it('builds a sample session per variant', () => {
    expect(sampleSessionFor('connecting').state).toBe('connecting');
    expect(sampleSessionFor('connecting').connectedAt).toBeNull();
    expect(sampleSessionFor('reconnecting').state).toBe('reconnecting');
    expect(sampleSessionFor('headset-missing').local.headsetConnected).toBe(false);
    expect(sampleSessionFor('connected').state).toBe('connected');
  });
});
