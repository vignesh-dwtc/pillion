import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { permissionService, startLoopback } from '../../app/composition';
import { useSessionSnapshot } from '../../app/hooks';
import { strings } from '../../app/strings';
import { colors } from '../../app/theme';
import type { LoopbackRun } from '../../platform/media/loopback';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { Card, SectionHeading, StatusPill } from '../components/Card';
import { LevelBar } from '../components/LevelBar';

import { describeLoopbackPhase, describeLoopbackResult, type LoopbackView } from './loopbackView';

/**
 * Loopback self-test (brief, "Diagnostics"): my microphone back to my earbuds through a local WebRTC loop, on a
 * dedicated media engine. Refused while a ride runs (the ride owns the microphone); asks for the microphone first.
 */
export function LoopbackCard() {
  const snapshot = useSessionSnapshot();
  const rideRunning = snapshot.state !== 'idle' && snapshot.state !== 'ended';
  const [view, setView] = useState<LoopbackView | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const runRef = useRef<LoopbackRun | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runRef.current?.cancel();
    };
  }, []);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setLevel(null);
    setView(describeLoopbackPhase('starting', 0));
    try {
      const status = await permissionService.request(['microphone']);
      if (status.microphone !== 'granted' && status.microphone !== 'unavailable') {
        if (mounted.current)
          setView({ tone: 'warning', status: strings.debug.loopbackMicNeeded, detail: null });
        return;
      }
      const started = startLoopback({
        onProgress: (progress) => {
          if (!mounted.current) return;
          setView(describeLoopbackPhase(progress.phase, progress.elapsedMs));
          setLevel(progress.receiver?.outputLevel ?? progress.sender?.inputLevel ?? null);
        },
      });
      if (!started) {
        if (mounted.current) setView({ tone: 'warning', status: strings.debug.loopbackBusy, detail: null });
        return;
      }
      runRef.current = started;
      const result = await started.result;
      if (mounted.current) setView(describeLoopbackResult(result));
    } finally {
      runRef.current = null;
      if (mounted.current) setRunning(false);
    }
  };

  return (
    <Card testID="card-loopback">
      <SectionHeading icon="headset">{strings.debug.loopbackHeading}</SectionHeading>
      <AppText variant="caption" color={colors.textMuted}>
        {strings.debug.loopbackHint}
      </AppText>
      {rideRunning ? (
        <AppText variant="caption" color={colors.amber} testID="loopback-ride-running">
          {strings.debug.loopbackBusy}
        </AppText>
      ) : null}
      {view ? (
        <View aria-live="polite" role="status" style={{ gap: 6 }}>
          <StatusPill tone={view.tone} label={view.status} testID="loopback-status" />
          {view.detail ? (
            <AppText variant="mono" color={colors.textMuted} testID="loopback-detail">
              {view.detail}
            </AppText>
          ) : null}
          {running && level !== null ? <LevelBar level={level} /> : null}
        </View>
      ) : null}
      {running ? (
        <Button
          testID="btn-loopback-cancel"
          label={strings.debug.loopbackCancel}
          variant="danger"
          icon="stop"
          onPress={() => runRef.current?.cancel()}
        />
      ) : (
        <Button
          testID="btn-loopback"
          label={strings.debug.loopbackRun}
          variant="primary"
          icon="headset"
          disabled={rideRunning}
          onPress={() => void run()}
        />
      )}
    </Card>
  );
}
