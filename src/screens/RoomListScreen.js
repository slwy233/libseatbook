import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { findRoomDuration } from '../api/client';
import { isTokenExpiredError } from '../utils/authManager';
import { todayDateStr, tomorrowDateStr } from '../utils/time';

export default function RoomListScreen({ route, navigation }) {
  const { buildingId, buildingName, floors } = route.params;
  const [rooms, setRooms] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayDateStr());
  const [selectedFloor, setSelectedFloor] = useState('0');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageInfo, setPageInfo] = useState(null);

  // 可预约日期: 今天 + 明天
  const dates = [
    { label: '今天', value: todayDateStr() },
    { label: '明天', value: tomorrowDateStr() },
  ];

  const floorOptions = [
    { label: '全部楼层', value: '0', floorId: null },
    ...(floors || []).map((f) => ({
      label: f.name || f.nameE,
      value: f.id,
      floorId: f.id,
    })),
  ];

  useEffect(() => {
    loadRooms();
  }, [selectedDate, selectedFloor]);

  const loadRooms = async () => {
    setLoading(true);
    try {
      const params = {
        currentPage: 1,
        pageSize: 50,
        beginMinute: -1,
        endMinute: 0,
        minMinute: 0,
      };

      if (selectedFloor && selectedFloor !== '0' && selectedFloor !== 0) {
        params.floorId = selectedFloor;
      }

      const resp = await findRoomDuration(buildingId, selectedDate, params);
      if (resp.status && resp.data) {
        setRooms(resp.data.pageList || []);
        setPageInfo({
          totalCount: resp.data.totalCount,
          currentPage: resp.data.currentPage,
          totalPage: resp.data.totalPage,
        });
      }
    } catch (e) {
      if (isTokenExpiredError(e)) {
        return;
      }
      Alert.alert('错误', e.message);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  };

  const getFreeColor = (free, total) => {
    if (total === 0) return '#999';
    const ratio = free / total;
    if (ratio > 0.5) return '#52c41a';
    if (ratio > 0.2) return '#faad14';
    return '#ff4d4f';
  };

  const renderRoomItem = ({ item }) => {
    const freeRatio = item.seatTotal > 0 ? item.seatFree / item.seatTotal : 0;
    const freeColor = getFreeColor(item.seatFree, item.seatTotal);

    return (
      <TouchableOpacity
        style={styles.roomCard}
        onPress={() =>
          navigation.navigate('SeatMap', {
            roomId: item.id,
            roomName: item.name || item.nameE,
            roomNameE: item.nameE,
            buildingName,
            floorName: item.floorName || '',
            seatTotal: item.seatTotal,
            date: selectedDate,
            buildingId,
          })
        }
      >
        <View style={styles.roomHeader}>
          <Text style={styles.roomName} numberOfLines={1}>
            {item.name || item.nameE}
          </Text>
          <Text style={styles.roomEnglish}>{item.nameE}</Text>
        </View>

        <View style={styles.roomBody}>
          <View style={styles.roomStat}>
            <Text style={[styles.freeCount, { color: freeColor }]}>
              {item.seatFree}
            </Text>
            <Text style={styles.freeLabel}>空闲</Text>
          </View>
          <View style={styles.roomStat}>
            <Text style={styles.totalCount}>{item.seatTotal}</Text>
            <Text style={styles.totalLabel}>总座位</Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${freeRatio * 100}%`,
                  backgroundColor: freeColor,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.roomFooter}>
          <Text style={styles.floorTag}>{item.floorName}</Text>
          {item.seatPower > 0 && <Text style={styles.featureTag}>🔌电源</Text>}
          {item.seatWindows > 0 && <Text style={styles.featureTag}>🪟靠窗</Text>}
          {item.seatComputer > 0 && <Text style={styles.featureTag}>💻电脑</Text>}
          <Text style={styles.arrow}>&rsaquo;</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderDatePicker = () => (
    <View style={styles.dateRow}>
      {dates.map((d) => (
        <TouchableOpacity
          key={d.value}
          style={[
            styles.dateBtn,
            selectedDate === d.value && styles.dateBtnActive,
          ]}
          onPress={() => setSelectedDate(d.value)}
        >
          <Text
            style={[
              styles.dateBtnText,
              selectedDate === d.value && styles.dateBtnTextActive,
            ]}
          >
            {d.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderFloorFilter = () => (
    <View style={styles.floorRow}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={floorOptions}
        keyExtractor={(item) => String(item.value)}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.floorBtn,
              selectedFloor === item.value && styles.floorBtnActive,
            ]}
            onPress={() => setSelectedFloor(item.value)}
          >
            <Text
              style={[
                styles.floorBtnText,
                selectedFloor === item.value && styles.floorBtnTextActive,
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{buildingName}</Text>
        <View style={styles.backBtn} />
      </View>

      {renderDatePicker()}
      {renderFloorFilter()}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1677FF" />
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.id}
          renderItem={renderRoomItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>该日期暂无可用房间</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1677FF',
    paddingTop: 50,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  backBtn: {
    width: 60,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  dateRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
    backgroundColor: '#fff',
  },
  dateBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  dateBtnActive: {
    backgroundColor: '#1677FF',
  },
  dateBtnText: {
    fontSize: 14,
    color: '#666',
  },
  dateBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  floorRow: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  floorBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  floorBtnActive: {
    backgroundColor: '#e6f4ff',
    borderWidth: 1,
    borderColor: '#1677FF',
  },
  floorBtnText: {
    fontSize: 13,
    color: '#666',
  },
  floorBtnTextActive: {
    color: '#1677FF',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roomCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  roomHeader: {
    marginBottom: 10,
  },
  roomName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  roomEnglish: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  roomBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 16,
  },
  roomStat: {
    alignItems: 'center',
  },
  freeCount: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  freeLabel: {
    fontSize: 11,
    color: '#999',
  },
  totalCount: {
    fontSize: 18,
    fontWeight: '500',
    color: '#999',
  },
  totalLabel: {
    fontSize: 11,
    color: '#999',
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  roomFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  floorTag: {
    fontSize: 11,
    backgroundColor: '#f0f5ff',
    color: '#1677FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  featureTag: {
    fontSize: 11,
  },
  arrow: {
    fontSize: 20,
    color: '#ccc',
    marginLeft: 'auto',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});
