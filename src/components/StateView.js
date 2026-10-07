import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme';

export default function StateView({ loading, error, empty = '暂无数据', onRetry }) {
  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : <Text style={styles.icon}>{error ? '!' : '○'}</Text>}
      <Text style={styles.title}>{loading ? '正在加载…' : error ? '暂时无法加载' : empty}</Text>
      {error ? <Text style={styles.detail}>{typeof error === 'string' ? error : error.message}</Text> : null}
      {!loading && onRetry && <TouchableOpacity style={styles.button} onPress={onRetry}><Text style={styles.buttonText}>重新加载</Text></TouchableOpacity>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 28, alignItems: 'center', justifyContent: 'center', minHeight: 180 },
  icon: { fontSize: 34, color: colors.muted, marginBottom: 8 },
  title: { color: colors.text, fontSize: 16, marginTop: 12, textAlign: 'center' },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  button: { backgroundColor: '#eaf2ff', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12, marginTop: 16 },
  buttonText: { color: colors.primary, fontWeight: '600' },
});
