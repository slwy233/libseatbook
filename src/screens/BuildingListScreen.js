import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getBuildingFloorDate } from '../api/client';

export default function BuildingListScreen({ navigation }) {
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBuildings();
  }, []);

  const loadBuildings = async () => {
    setLoading(true);
    try {
      const resp = await getBuildingFloorDate();
      if (resp.status && resp.data) {
        setBuildings(resp.data);
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
      buildingId: building.buildingId,
      buildingName: building.buildingName,
      floors: building.floorList || [],
    });
  };

  const renderBuilding = ({ item }) => (
    <TouchableOpacity
      style={styles.buildingCard}
      onPress={() => handleBuildingPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.buildingInfo}>
        <Text style={styles.buildingName}>🏢 {item.buildingName}</Text>
        <Text style={styles.buildingDetail}>
          {item.floorList?.length || 0} 层 · {item.roomCount || 0} 间房间
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
        keyExtractor={(item) => item.buildingId?.toString()}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>暂无可预约场馆</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    backgroundColor: '#1677FF',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 24,
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)' },

  list: { padding: 16 },
  buildingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
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
});
