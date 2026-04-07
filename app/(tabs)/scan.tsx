import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function ScanScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle" style={styles.instruction}>
        Show this code at checkout to earn rewards.
      </ThemedText>

      <View style={styles.qrBox}>
        <IconSymbol name="qrcode.viewfinder" size={120} color="#0F9D58" />
      </View>

      <View style={styles.balanceWrap}>
        <ThemedText type="subtitle">Rewards Balance</ThemedText>
        <ThemedText type="title">150 points</ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  instruction: {
    textAlign: 'center',
    marginBottom: 20,
  },
  qrBox: {
    width: 250,
    height: 250,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#0F9D58',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  balanceWrap: {
    alignItems: 'center',
    gap: 6,
  },
});

