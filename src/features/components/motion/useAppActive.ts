import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** False whenever the app is not in the foreground: every loop pauses (nothing runs in a pocket). */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active' || !AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}
