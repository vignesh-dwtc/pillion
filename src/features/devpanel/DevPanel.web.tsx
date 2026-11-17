/**
 * Web-only developer panel (DEV ONLY). Metro picks this file on web; the native twin `DevPanel.tsx` renders nothing, so
 * the panel never reaches the Android bundle. Mounted once at the app root by `src/app/App.tsx`.
 *
 * It drives the pretend world behind the web fakes through the typed `devControls` registry: "headset disconnected",
 * "link dropped", "phone call started", plus a few extras the flows need (hold the link down, notification buttons, low
 * battery). Everything here is a switch for the UI and the session logic: it proves nothing about real Bluetooth,
 * telephony, Wi-Fi Direct or the Android foreground service.
 *
 * Collapsed by default to a thin "DEV" tab inside the left screen margin (the app keeps 16 px side margins), so it
 * never covers a control or a label of the real screens. The open panel can be moved between the bottom and the top
 * of the screen so it does not hide what you are watching.
 */
import { useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { devControls } from '../../platform/devtools/devControls.web';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_DEV_PANEL = '@@web-only:DevPanel.web@@';

const LOW_BATTERY = { levelPct: 15, charging: false };
const NORMAL_BATTERY = { levelPct: 80, charging: false };

function useDevState() {
  return useSyncExternalStore(devControls.subscribe, devControls.getState, devControls.getState);
}

interface PanelButtonProps {
  testID: string;
  label: string;
  onPress: () => void;
  active?: boolean;
}

function PanelButton({ testID, label, onPress, active = false }: PanelButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, active && styles.buttonActive]}
    >
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
    </Pressable>
  );
}

interface RowProps {
  label: string;
  value?: string;
  valueTestID?: string;
  children: ReactNode;
}

function Row({ label, value, valueTestID, children }: RowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {label}
        {value === undefined ? null : ': '}
        {value === undefined ? null : (
          <Text testID={valueTestID} style={styles.rowValue}>
            {value}
          </Text>
        )}
      </Text>
      {children}
    </View>
  );
}

export function DevPanel(): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [atTop, setAtTop] = useState(false);
  const state = useDevState();

  const linkValue = state.linkBlocked ? 'blocked' : state.linkUp ? 'up' : 'down';
  const batteryValue = state.battery === null ? 'n/a' : `${state.battery.levelPct}%`;
  const lowBattery = state.battery !== null && state.battery.levelPct <= 15;

  return (
    <View style={styles.overlay}>
      {open ? (
        <View
          testID="devpanel"
          accessibilityLabel="Developer panel (web only)"
          style={[styles.panel, atTop ? styles.panelTop : styles.panelBottom]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>DEV PANEL (web only)</Text>
            <View style={styles.buttons}>
              <PanelButton
                testID="devpanel-move"
                label={atTop ? 'Move down' : 'Move up'}
                onPress={() => setAtTop(!atTop)}
              />
              <PanelButton testID="devpanel-close" label="Close" onPress={() => setOpen(false)} />
            </View>
          </View>

          <Row
            label="Headset"
            value={state.headsetConnected ? 'connected' : 'disconnected'}
            valueTestID="devpanel-headset-state"
          >
            <PanelButton
              testID="devpanel-headset"
              label={state.headsetConnected ? 'Disconnect headset' : 'Connect headset'}
              active={!state.headsetConnected}
              onPress={() => devControls.setHeadsetConnected(!state.headsetConnected)}
            />
          </Row>

          <Row
            label="Phone call"
            value={state.phoneCallActive ? 'active' : 'none'}
            valueTestID="devpanel-call-state"
          >
            <PanelButton
              testID="devpanel-call"
              label={state.phoneCallActive ? 'End phone call' : 'Start phone call'}
              active={state.phoneCallActive}
              onPress={() => devControls.setPhoneCallActive(!state.phoneCallActive)}
            />
          </Row>

          <Row label="Link" value={linkValue} valueTestID="devpanel-link-state">
            <PanelButton
              testID="devpanel-drop-link"
              label="Drop link"
              onPress={() => devControls.dropLink()}
            />
            <PanelButton
              testID="devpanel-block-link"
              label={state.linkBlocked ? 'Unblock link' : 'Block link'}
              active={state.linkBlocked}
              onPress={() => devControls.setLinkBlocked(!state.linkBlocked)}
            />
          </Row>

          <Row label="Notification">
            <PanelButton
              testID="devpanel-action-toggle-mute"
              label="Mute"
              onPress={() => devControls.pressRideServiceAction('toggle-mute')}
            />
            <PanelButton
              testID="devpanel-action-end"
              label="End"
              onPress={() => devControls.pressRideServiceAction('end')}
            />
          </Row>

          <Row label="Battery" value={batteryValue} valueTestID="devpanel-battery-state">
            <PanelButton
              testID="devpanel-battery"
              label={lowBattery ? 'Battery 80%' : 'Battery 15%'}
              active={lowBattery}
              onPress={() => devControls.setBattery(lowBattery ? NORMAL_BATTERY : LOW_BATTERY)}
            />
          </Row>

          <Text style={styles.footer}>
            Last cue: <Text testID="devpanel-last-cue">{state.lastCue ?? 'none'}</Text> ({state.cueCount})
          </Text>
          <Text style={styles.footer}>
            Fakes only: proves UI and session logic, not Bluetooth, Wi-Fi Direct or the foreground service.
          </Text>
        </View>
      ) : (
        <Pressable
          testID="devpanel-toggle"
          accessibilityRole="button"
          accessibilityLabel="Open developer panel (web only)"
          onPress={() => setOpen(true)}
          style={styles.tab}
        >
          <Text style={styles.tabText}>DEV</Text>
        </Pressable>
      )}
    </View>
  );
}

const ACCENT = '#c4b5fd';
const PANEL_BACKGROUND = '#181030';

const styles = StyleSheet.create({
  // Covers the screen but lets every touch through except on the tab and the open panel.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10_000,
    pointerEvents: 'box-none',
  },
  // A thin vertical tab inside the 16 px left screen margin, at about 40% of the height.
  tab: {
    position: 'absolute',
    left: 0,
    top: '40%',
    width: 14,
    height: 44,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: ACCENT,
    backgroundColor: PANEL_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tabText: {
    width: 44,
    height: 14,
    lineHeight: 14,
    textAlign: 'center',
    color: ACCENT,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    transform: [{ rotate: '-90deg' }],
  },
  panel: {
    position: 'absolute',
    left: 6,
    right: 6,
    maxWidth: 400,
    padding: 10,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: PANEL_BACKGROUND,
  },
  panelBottom: { bottom: 6 },
  panelTop: { top: 6 },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  title: { color: ACCENT, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  rowLabel: { color: '#e5e7eb', fontSize: 13, minWidth: 150 },
  rowValue: { color: '#fde68a', fontWeight: '700' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: { backgroundColor: ACCENT },
  buttonText: { color: ACCENT, fontSize: 13, fontWeight: '600' },
  buttonTextActive: { color: '#1e1b4b' },
  footer: { color: '#9ca3af', fontSize: 11 },
});
