import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { useAnimatedValue } from './motion/useAnimatedValue';
import Svg, { Path } from 'react-native-svg';

import { strings } from '../../app/strings';
import { colors } from '../../app/theme';

import { createHoldController, type HoldController } from './holdController';
import { duration } from './motion/tokens';
import { haptic } from './motion/haptics';
import { useReducedMotion } from './motion/useReducedMotion';
import { Plate, chamferPath, chamferPerimeter, type PlateProps } from './Plate';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** How long the screen-reader confirm stays armed. */
const CONFIRM_WINDOW_MS = 5000;

/**
 * A plate that needs a 1.0 s press (End ride). A brassLight stroke traces the plate outline while held, with a haptic
 * tick at the start and at completion; releasing early reverses it in 200 ms. Reduced motion: no stroke, the
 * sub-label counts down in steps. Screen readers: the 'activate' action asks for a confirmation (activate again
 * within 5 s) and then completes immediately, without the hold. The logic lives in holdController.ts (unit tested).
 */
export function HoldPlate({
  onComplete,
  label,
  sub,
  testID,
  accessibilityLabel,
  ...rest
}: Omit<PlateProps, 'onPress' | 'onPressIn' | 'onPressOut' | 'overlay' | 'accessibilityActions'> & {
  onComplete: () => void;
}) {
  const reduced = useReducedMotion();
  const progress = useAnimatedValue(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  const controller = useRef<HoldController | null>(null);

  // One controller per mount; disposing it on unmount stops an in-flight hold (the ride may end remotely mid-hold),
  // clears the screen-reader confirm timer and resets the stroke.
  useEffect(() => {
    const c = createHoldController({
      driver: {
        run(to, ms, done) {
          const animation = Animated.timing(progress, { toValue: to, duration: ms, useNativeDriver: false });
          animation.start(({ finished }) => done(finished));
          return () => animation.stop();
        },
        reset: () => progress.setValue(0),
      },
      onComplete: () => onCompleteRef.current(),
      onArmedChange: setArmed,
      onHoldStart: haptic.tick,
      onCompleteFeedback: haptic.medium,
      announceArmed: () => AccessibilityInfo.announceForAccessibility(strings.ride.endConfirm),
      holdMs: duration.hold,
      releaseMs: duration.holdRelease,
      confirmWindowMs: CONFIRM_WINDOW_MS,
    });
    controller.current = c;
    return () => {
      c.dispose();
      if (controller.current === c) controller.current = null;
    };
  }, [progress]);

  useEffect(() => {
    if (!reduced) return;
    const id = progress.addListener(({ value }) => {
      setRemaining(value <= 0 ? null : Math.max(0, Math.ceil((1 - value) * 4) / 4));
    });
    return () => progress.removeListener(id);
  }, [progress, reduced]);

  const subLabel = armed
    ? strings.ride.endConfirm
    : remaining !== null
      ? strings.ride.endHolding(remaining)
      : sub;

  return (
    <Plate
      {...rest}
      label={label}
      sub={subLabel}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={strings.ride.endA11yHint}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') controller.current?.accessibilityActivate();
      }}
      onPressIn={() => controller.current?.pressIn()}
      onPressOut={() => controller.current?.pressOut()}
      overlay={({ w, h, c }) => {
        if (reduced) return null;
        const inset = 2.5;
        const len = chamferPerimeter(w, h, c, inset);
        const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [len, 0] });
        return (
          <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
            <AnimatedPath
              d={chamferPath(w, h, c, inset)}
              fill="none"
              stroke={colors.brassLight}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeDasharray={[len, len]}
              strokeDashoffset={dashOffset}
            />
          </Svg>
        );
      }}
    />
  );
}
