import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert } from 'react-native';
import { getBuildingFloorDate } from '../api/client';

export default function BuildingListScreen({ navigation }) {
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadBuildings(); }, []);

  const loadBuildings = async () => {
    setLoading(true);
    try {
      const resp = await getBuildingFloorDate();
      if (resp.status && resp.data) {
        // API 返回 { buildings: [...], dates: [...] }
        setBuildings(resp.data.buildings || []);
      } else {
        Alert.alert('提示', resp.message || '获取建筑列表失败');
      }
    } catch (e) {
      Alert.alert('错误', e.message || '网络异常');
    } finally {
      setLoading(false);
    }
  };

  const handleBuildingPress = (building) => {
    navigation.navigate('RoomList', {
      buildingId: building.id,          // API字段名: id
      buildingName: building.name || '图书馆',
      buildingNameE: building.nameE || 'library',
      floors: building.floors || [],   // API字段名: floors
    });
  };

  const renderBuilding = ({ item }) => (
    <TouchableOpacity style={styles.buildingCard} onPress={() => handleBuildingPress(item)} activeOpacity={0.7}>
      <View style={styles.buildingInfo}>
        <Text style={styles.buildingName}>🏛️ {item.name || '图书馆'}</Text>
        <Text style={styles.buildingDetail}>
          ⏰ {item.seTime || '08:00 - 21:50'} · 📍 {item.floors?.length || 0}层
        </Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1677FF" />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>选择场馆</Text>
        <Text style={styles.subtitle}>请选择要预约的图书馆区域</Text>
      </View>
      <FlatList
        data={buildings}
        renderItem={renderBuilding}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>暂无可预约场馆</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadBuildings}>
              <Text style={styles.retryText}>点击重试</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: { backgroundColor: '#1677FF', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 24 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },
  list: { padding: 16 },
  buildingCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 18, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  buildingInfo: { flex: 1 },
  buildingName: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 6 },
  buildingDetail: { fontSize: 14, color: '#888' },
  arrow: { fontSize: 28, color: '#ccc', marginLeft: 12 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#999' },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyText: { fontSize: 16, color: '#999' },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#1677FF', borderRadius: 20 },
  retryText: { color: '#fff', fontSize: 14 },
});
