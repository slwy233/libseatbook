import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getBuildingFloorDate } from '../api/client';
import ScreenHeader from '../components/ScreenHeader';
import StateView from '../components/StateView';
import { colors } from '../theme';

export default function BuildingListScreen({ navigation }) {
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const loadBuildings = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const resp = await getBuildingFloorDate();
      if (version !== request.current) return;
      if (!resp.status) throw new Error(resp.message || '获取场馆失败');
      setBuildings(Array.isArray(resp.data?.buildings) ? resp.data.buildings.filter(item => item && item.id != null) : []);
    } catch (e) {
      if (version === request.current && e.message !== 'TOKEN_EXPIRED') setError(e.message || '网络异常，请重试');
    } finally { if (version === request.current) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { loadBuildings(); return () => { request.current += 1; }; }, [loadBuildings]));
  return (
    <View style={styles.container}>
      <ScreenHeader title="预约选座" subtitle="选择场馆，找到适合你的学习空间" />
      <FlatList data={buildings} keyExtractor={item => String(item.id)} contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading && buildings.length > 0} onRefresh={loadBuildings} tintColor={colors.primary} />}
        ListHeaderComponent={buildings.length ? <><Text style={styles.section}>可预约场馆 · {buildings.length}</Text>{error ? <StateView error={error} onRetry={loadBuildings} /> : null}</> : null}
        ListEmptyComponent={<StateView loading={loading} error={error} empty="暂无可预约场馆" onRetry={loadBuildings} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.8} accessibilityRole="button"
            onPress={() => navigation.navigate('RoomList', { buildingId: item.id, buildingName: item.name || item.nameE || '图书馆', buildingNameE: item.nameE, floors: Array.isArray(item.floors) ? item.floors : [] })}>
            <View style={styles.icon}><Text style={styles.iconText}>🏛️</Text></View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name || item.nameE || '图书馆'}</Text>
              <Text style={styles.detail}>{item.seTime ? `开放 ${item.seTime}` : '开放时间请以场馆公告为准'}</Text>
              <Text style={styles.tag}>{item.floors?.length || 0} 个楼层 · 查看学习区域</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        )} />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, list: { padding: 16, paddingBottom: 28, flexGrow: 1 }, section: { color: colors.muted, fontSize: 13, marginBottom: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 },
  icon: { backgroundColor: '#eef5ff', width: 50, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14 }, iconText: { fontSize: 26 }, info: { flex: 1 },
  name: { fontSize: 18, fontWeight: '700', color: colors.text }, detail: { color: colors.muted, fontSize: 12, marginTop: 6 }, tag: { color: colors.primary, fontSize: 12, marginTop: 9 }, arrow: { color: colors.muted, fontSize: 28, marginLeft: 12 },
});
