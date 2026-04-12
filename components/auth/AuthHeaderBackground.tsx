import { StyleSheet, View } from 'react-native';

import { AUTH_GREEN, AUTH_GREEN_LIGHT } from '@/components/auth/authTheme';

type Props = {
  children: React.ReactNode;
};

/** Forest header with faint overlapping circles (matches app mockups). */
export function AuthHeaderBackground({ children }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.circle, styles.c1]} />
      <View style={[styles.circle, styles.c2]} />
      <View style={[styles.circle, styles.c3]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: AUTH_GREEN,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  circle: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: AUTH_GREEN_LIGHT,
    opacity: 0.22,
  },
  c1: {
    width: 220,
    height: 220,
    top: -60,
    left: -50,
  },
  c2: {
    width: 180,
    height: 180,
    top: 20,
    right: -40,
  },
  c3: {
    width: 140,
    height: 140,
    bottom: -30,
    left: '28%',
  },
});
