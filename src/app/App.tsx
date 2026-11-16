import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

import IDENTITY from '../../config/identity.json';

// Placeholder shell; replaced by the ui subagent in M0.
export default function App() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 28 }}>{IDENTITY.displayName}</Text>
      <StatusBar style="light" />
    </View>
  );
}
