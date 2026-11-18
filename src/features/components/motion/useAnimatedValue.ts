import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * One Animated.Value for the component's lifetime. React Native has its own `useAnimatedValue`, but
 * react-native-web does not export it, so this tiny twin serves both targets.
 */
export function useAnimatedValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}
