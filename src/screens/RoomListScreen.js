import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl, ScrollView } from 'react-native';
import { findRoomDuration } from '../api/client';
import { todayDateStr, tomorrowDateStr } from '../utils/time';
import ScreenHeader from '../components/ScreenHeader';
import StateView from '../components/StateView';
import { colors } from '../theme';

export default function RoomListScreen({ route, navigation }) {
  const { buildingId, buildingName, floors = [] } = route.params;
  const [rooms, setRooms] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayDateStr());
  const [selectedFloor, setSelectedFloor] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreLock = useRef(false);
  const request = useRef(0);
  const dates = [{ label: '今天', value: todayDateStr() }, { label: '明天', value: tomorrowDateStr() }];
  const floorOptions = [{ label: '全部楼层', value: '0' }, ...(Array.isArray(floors) ? floors : []).filter(f => f && f.id != null).map(f => ({ label: f.name || f.nameE || '楼层', value: String(f.id) }))];
  const loadRooms = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError(''); setLoadingMore(false); moreLock.current = false;
    try {
      const resp = await findRoomDuration(buildingId, selectedDate, { currentPage: 1, pageSize: 50, floorId: selectedFloor });
      if (version !== request.current) return;
      if (!resp.status) throw new Error(resp.message || '获取房间失败');
      const list = Array.isArray(resp.data?.pageList) ? resp.data.pageList : [];
      setRooms(list); setTotal(Number(resp.data?.totalCount) || list.length); setPage(1);
    } catch (e) {
      if (version === request.current && e.message !== 'TOKEN_EXPIRED') setError(e.message || '网络异常，请重试');
    } finally { if (version === request.current) setLoading(false); }
  }, [buildingId, selectedDate, selectedFloor]);
  useEffect(() => { setRooms([]); setTotal(0); loadRooms(); return () => { request.current += 1; }; }, [loadRooms]);
  const loadMore = async () => {
    if (loading || moreLock.current || rooms.length >= total) return;
    const version = ++request.current;
    moreLock.current = true; setLoadingMore(true); setError('');
    try {
      const resp = await findRoomDuration(buildingId, selectedDate, { currentPage: page + 1, pageSize: 50, floorId: selectedFloor });
      if (version !== request.current) return;
      if (!resp.status) throw new Error(resp.message || '加载更多房间失败');
      const list = Array.isArray(resp.data?.pageList) ? resp.data.pageList : [];
      setRooms(previous => { const known = new Set(previous.map(item => String(item.id))); return [...previous, ...list.filter(item => !known.has(String(item.id)))]; });
      setPage(page + 1);
      if (!list.length) setTotal(rooms.length);
    } catch (e) {
      if (version === request.current && e.message !== 'TOKEN_EXPIRED') setError(e.message || '加载更多失败，请重试');
    } finally { if (version === request.current) { moreLock.current = false; setLoadingMore(false); } }
  };
  const chooseDate = value => { if (value !== selectedDate) { request.current += 1; setRooms([]); setLoading(true); setSelectedDate(value); } };
  const chooseFloor = value => { if (value !== selectedFloor) { request.current += 1; setRooms([]); setLoading(true); setSelectedFloor(value); } };
  return (
    <View style={styles.container}>
      <ScreenHeader title={buildingName || '选择区域'} subtitle="按日期和楼层筛选学习区域" onBack={() => navigation.goBack()} />
      <View style={styles.filters}>
        <View style={styles.dates}>{dates.map(item => (
          <TouchableOpacity key={item.value} style={[styles.date, item.value === selectedDate && styles.active]} onPress={() => chooseDate(item.value)} accessibilityRole="button" accessibilityState={{ selected: item.value === selectedDate }}>
            <Text style={[styles.dateLabel, item.value === selectedDate && styles.white]}>{item.label}</Text>
            <Text style={[styles.dateDetail, item.value === selectedDate && styles.white]}>{item.value.slice(5)}</Text>
          </TouchableOpacity>
        ))}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>{floorOptions.map(item => (
          <TouchableOpacity key={item.value} style={[styles.floor, selectedFloor === item.value && styles.floorActive]} onPress={() => chooseFloor(item.value)} accessibilityRole="button">
            <Text style={[styles.floorText, selectedFloor === item.value && { color: colors.primary }]}>{item.label}</Text>
          </TouchableOpacity>
        ))}</ScrollView>
      </View>
      <FlatList data={rooms} keyExtractor={item => String(item.id)} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading && rooms.length > 0} onRefresh={loadRooms} tintColor={colors.primary} />}
        ListHeaderComponent={rooms.length ? <><Text style={styles.summary}>{selectedDate} · {total} 个学习区域{total > rooms.length ? `（已显示 ${rooms.length} 个）` : ''}</Text>{error ? <StateView error={error} onRetry={loadRooms} /> : null}</> : null}
        ListEmptyComponent={<StateView loading={loading} error={error} empty="该日期和楼层暂无学习区域" onRetry={loadRooms} />}
        ListFooterComponent={rooms.length < total ? <TouchableOpacity style={styles.more} onPress={loadMore} disabled={loading || loadingMore}><Text style={{ color: colors.primary }}>{loadingMore ? '加载中…' : '加载更多区域'}</Text></TouchableOpacity> : null}
        renderItem={({ item }) => {
          const free = Math.max(0, Number(item.seatFree) || 0);
          const count = Math.max(0, Number(item.seatTotal) || 0);
          const ratio = count ? Math.min(1, free / count) : 0;
          const color = free > 0 ? colors.success : colors.muted;
          return <TouchableOpacity style={styles.card} activeOpacity={0.8} accessibilityRole="button"
            onPress={() => navigation.navigate('SeatMap', { roomId: item.id, roomName: item.name || item.nameE, roomNameE: item.nameE, buildingName, floorName: item.floorName || '', date: selectedDate, buildingId })}>
            <View style={styles.row}><Text style={styles.name}>{item.name || item.nameE || '学习区域'}</Text><Text style={styles.arrow}>›</Text></View>
            {item.nameE && item.nameE !== item.name ? <Text style={styles.english}>{item.nameE}</Text> : null}
            <View style={styles.stats}><Text style={[styles.count, { color }]}>{free}</Text><Text style={styles.muted}>空闲 / {count} 总座位</Text><Text style={[styles.badge, { color }]}>{free > 0 ? '可查看选座' : '暂无空闲'}</Text></View>
            <View style={styles.progress}><View style={{ width: `${ratio * 100}%`, backgroundColor: color, height: 5 }} /></View>
            <View style={styles.tags}>{[item.floorName, item.seatPower > 0 && '电源', item.seatWindows > 0 && '靠窗', item.seatComputer > 0 && '电脑'].filter(Boolean).map(label => <Text key={label} style={styles.tag}>{label}</Text>)}</View>
          </TouchableOpacity>;
        }} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, filters: { backgroundColor: colors.surface, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  dates: { flexDirection: 'row', gap: 10, marginBottom: 14 }, date: { flex: 1, backgroundColor: colors.background, borderRadius: 12, padding: 11, alignItems: 'center' }, active: { backgroundColor: colors.primary },
  dateLabel: { color: colors.text, fontSize: 15, fontWeight: '600' }, dateDetail: { color: colors.muted, fontSize: 12, marginTop: 3 }, white: { color: '#fff' },
  floor: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginRight: 8, backgroundColor: colors.background, borderWidth: 1, borderColor: 'transparent' }, floorActive: { backgroundColor: '#eef5ff', borderColor: colors.primary }, floorText: { color: colors.muted, fontSize: 13 },
  list: { padding: 16, paddingBottom: 28, flexGrow: 1 }, summary: { color: colors.muted, fontSize: 12, marginBottom: 12 },
  more: { padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16, marginBottom: 12 }, row: { flexDirection: 'row', alignItems: 'center' }, name: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' }, arrow: { color: colors.muted, fontSize: 25 }, english: { color: colors.muted, fontSize: 12, marginTop: 2 },
  stats: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 }, count: { fontSize: 28, fontWeight: '700' }, muted: { color: colors.muted, fontSize: 12 }, badge: { marginLeft: 'auto', fontSize: 12 },
  progress: { height: 5, backgroundColor: colors.background, borderRadius: 3, overflow: 'hidden', marginTop: 9 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }, tag: { color: colors.primary, backgroundColor: '#eef5ff', fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
});
