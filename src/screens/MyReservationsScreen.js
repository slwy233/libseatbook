import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SectionList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentMake, getLastMake } from '../api/client';
import { getSessionVersion, isSessionCurrent } from '../utils/storage';
import ScreenHeader from '../components/ScreenHeader';
import StateView from '../components/StateView';
import BookingCard from '../components/BookingCard';
import useBookingCancel from '../hooks/useBookingCancel';
import { colors } from '../theme';
export default function MyReservationsScreen({ navigation }) {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const loadData = useCallback(async (refresh = false) => {
    const id = ++request.current;
    const session = getSessionVersion();
    if (refresh) setRefreshing(true); else setLoading(true);
    const [currentResp, historyResp] = await Promise.allSettled([getCurrentMake(), getLastMake()]);
    if (request.current !== id || !isSessionCurrent(session)) return;
    const failures = [];
    if (currentResp.status === 'fulfilled') setCurrent(currentResp.value.data?.id ? currentResp.value.data : null);
    else failures.push('当前预约：' + currentResp.reason.message);
    if (historyResp.status === 'fulfilled') setHistory(Array.isArray(historyResp.value.data) ? historyResp.value.data : []);
    else failures.push('历史记录：' + historyResp.reason.message);
    setError(failures.join('\n')); setLoading(false); setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { loadData(); return () => { request.current++; }; }, [loadData]));
  const { cancel, cancelingId } = useBookingCancel(() => loadData(true));
  const seen = new Set(current ? [String(current.id)] : []);
  const past = history.filter(item => { const id = String(item.id); if (seen.has(id)) return false; seen.add(id); return true; });
  const sections = [{ title: '当前预约', data: current ? [current] : [] }, { title: '历史记录', data: past }];
  return (
    <View style={styles.container}>
      <ScreenHeader title="我的预约" subtitle="当前安排与历史记录" />
      {loading ? <StateView loading /> : <SectionList
        sections={sections} keyExtractor={item => String(item.id)} stickySectionHeadersEnabled={false}
        renderItem={({ item }) => <BookingCard booking={item} onCancel={cancel} canceling={cancelingId !== null} />}
        renderSectionHeader={({ section }) => <View style={styles.heading}><Text style={styles.title}>{section.title}</Text><Text style={styles.count}>{section.data.length} 条</Text></View>}
        renderSectionFooter={({ section }) => section.data.length === 0 ? <Text style={styles.empty}>{error ? '该部分尚未获取到数据' : section.title === '当前预约' ? '当前没有预约' : '暂无历史记录'}</Text> : null}
        ListHeaderComponent={error ? <StateView error={error} onRetry={() => loadData(true)} /> : null}
        ListFooterComponent={<TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Book')}><Text style={styles.buttonText}>去预约座位</Text></TouchableOpacity>}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
        contentContainerStyle={styles.list}
      />}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, list: { padding: 20, paddingBottom: 30 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 10 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text }, count: { fontSize: 13, color: colors.muted },
  empty: { color: colors.muted, paddingVertical: 16, fontSize: 14 },
  button: { borderRadius: 12, backgroundColor: colors.primary, padding: 14, alignItems: 'center', marginTop: 20 }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

