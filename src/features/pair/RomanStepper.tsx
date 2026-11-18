import { View } from 'react-native';

import { strings } from '../../app/strings';
import { colors, spacing } from '../../app/theme';
import { AppText, Legend } from '../components/AppText';

const NUMERALS = ['I', 'II', 'III'] as const;

/**
 * Roman stepper (I Show plate / II Partner scans / III Chime): 40 dp numerals joined by a hairline; steps up to the
 * active one are filled with brass, the active one is also named "current step" for screen readers.
 */
export function RomanStepper({ steps, active }: { steps: readonly string[]; active: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((name, index) => {
        const done = index <= active;
        return (
          <View
            key={name}
            accessible
            aria-label={strings.pairHost.stepLabel(index + 1, name, index === active)}
            style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View
                style={{ flex: 1, height: 1, backgroundColor: index === 0 ? 'transparent' : colors.hairline }}
              />
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: done ? colors.brassDeep : colors.border,
                  backgroundColor: done ? colors.brass : colors.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText
                  variant="button"
                  color={done ? colors.onBrass : colors.textMuted}
                  maxFontSizeMultiplier={1.1}
                >
                  {NUMERALS[index] ?? String(index + 1)}
                </AppText>
              </View>
              <View
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: index === steps.length - 1 ? 'transparent' : colors.hairline,
                }}
              />
            </View>
            <Legend
              align="center"
              color={index === active ? colors.brass : colors.textSubtle}
              style={{ fontSize: 11, letterSpacing: 1.8 }}
            >
              {name}
            </Legend>
          </View>
        );
      })}
    </View>
  );
}
