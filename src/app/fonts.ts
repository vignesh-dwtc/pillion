import { BarlowSemiCondensed_400Regular } from '@expo-google-fonts/barlow-semi-condensed/400Regular';
import { BarlowSemiCondensed_500Medium } from '@expo-google-fonts/barlow-semi-condensed/500Medium';
import { BarlowSemiCondensed_600SemiBold } from '@expo-google-fonts/barlow-semi-condensed/600SemiBold';
import { CormorantGaramond_500Medium_Italic } from '@expo-google-fonts/cormorant-garamond/500Medium_Italic';
import { Marcellus_400Regular } from '@expo-google-fonts/marcellus/400Regular';
import { MarcellusSC_400Regular } from '@expo-google-fonts/marcellus-sc/400Regular';

import { fonts } from './theme';

/**
 * Bundled font files (offline: no network fetch, Metro packs the .ttf assets). Imported per weight from the
 * package subpaths so only the six faces we use end up in the bundle. The keys are the family names in
 * `theme.fonts`; if loading fails the system font is used and the app is not blocked.
 */
export const FONT_MAP: Record<(typeof fonts)[keyof typeof fonts], number> = {
  [fonts.title]: Marcellus_400Regular,
  [fonts.legend]: MarcellusSC_400Regular,
  [fonts.body]: BarlowSemiCondensed_400Regular,
  [fonts.bodyMedium]: BarlowSemiCondensed_500Medium,
  [fonts.bodySemi]: BarlowSemiCondensed_600SemiBold,
  [fonts.script]: CormorantGaramond_500Medium_Italic,
};
