import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

export default function ScreenHeader({ title, subtitle, onBack, action }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
      <View style={styles.row}>
        {onBack && <TouchableOpacity onPress={onBack} accessibilityLabel="返回" style={styles.back}><Text style={styles.backText}>‹</Text></TouchableOpacity>}
        <View style={styles.heading}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1 },
  title: { fontSize: 23, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 13, color: '#dceaff', marginTop: 6, lineHeight: 19 },
  back: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12 },
  backText: { fontSize: 32, color: '#fff' },
});
