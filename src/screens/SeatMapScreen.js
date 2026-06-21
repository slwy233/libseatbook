import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {
  getFreeSeats,
  getStartTimes,
  getEndTimes,
  bookSeat,
} from '../api/client';
import { minutesToTimeStr, formatDate } from '../utils/time';

export default function SeatMapScreen({ route, navigation }) {
  const { roomId, roomName, roomNameE, buildingName, floorName, seatTotal, date, buildingId } = route.params;

  const [seats, setSeats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedSeat, setSelectedSeat] = useState(null);

  // 时间选择相关
  const [startTimes, setStartTimes] = useState([]);
  const [endTimes, setEndTimes] = useState([]);
  const [selectedStart, setSelectedStart] = useState(null);
  const [selectedEnd, setSelectedEnd] = useState(null);

  // Modal 状态
  const [bookingModal, setBookingModal] = useState(false);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    loadSeats();
  }, [date]);

  const loadSeats = async () => {
    setLoading(true);
    try {
      const resp = await getFreeSeats(roomId, date);
      if (resp.status && resp.data) {
        setSeats(resp.data);
      }
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') {
        Alert.alert('登录过期', '请重新登录', [
          { text: '确定', onPress: () => navigation.replace('Login') },
        ]);
        return;
      }
      Alert.alert('错误', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeatPress = async (seat) => {
    if (seat.status !== 'FREE' && seat.status !== 'BOOKED') return;

    setSelectedSeat(seat);
    setSelectedStart(null);
    setSelectedEnd(null);
    setStartTimes([]);
    setEndTimes([]);

    try {
      const resp = await getStartTimes(seat.id, date);
      if (resp.status && resp.data) {
        setStartTimes(resp.data);
      }
    } catch (e) {
      Alert.alert('错误', '获取时间失败');
    }

    setBookingModal(true);
  };

  const handleStartSelect = async (item) => {
    setSelectedStart(item);
    setSelectedEnd(null);

    const startMinute = item[0] === 'now' ? 0 : parseInt(item[0]);
    try {
      const resp = await getEndTimes(selectedSeat.id, date, startMinute);
      if (resp.status && resp.data) {
        setEndTimes(resp.data);
      }
    } catch (e) {
      Alert.alert('错误', '获取结束时间失败');
    }
  };

  const handleBook = async () => {
    if (!selectedStart || !selectedEnd) {
      Alert.alert('提示', '请选择开始和结束时间');
      return;
    }

    const startMin = selectedStart[0] === 'now' ? 0 : parseInt(selectedStart[0]);
    const endMin = parseInt(selectedEnd[0]);

    if (endMin <= startMin) {
      Alert.alert('提示', '结束时间必须晚于开始时间');
      return;
    }

    setBooking(true);
    try {
      const resp = await bookSeat(selectedSeat.id, date, startMin, endMin);
      if (resp.status) {
        Alert.alert('预约成功 🎉', [
          `座位: ${selectedSeat.label}号`,
          `时间: ${selectedStart[1]} - ${selectedEnd[1]}`,
          `位置: ${buildingName} ${floorName} ${roomName}`,
          `日期: ${date}`,
        ].join('\n'), [
          { text: '好的', onPress: () => {
            setBookingModal(false);
            navigation.goBack();
          }},
        ]);
      } else {
        Alert.alert('预约失败', resp.message || '未知错误');
      }
    } catch (e) {
      Alert.alert('错误', e.message);
    } finally {
      setBooking(false);
    }
  };

  // 座位列表转为展示用数组
  const seatList = Object.values(seats);
  const freeCount = seatList.filter((s) => s.status === 'FREE').length;
  const bookedCount = seatList.filter((s) => s.status === 'BOOKED').length;

  const getSeatColor = (status) => {
    switch (status) {
      case 'FREE':
        return '#52c41a';
      case 'BOOKED':
        return '#ff4d4f';
      default:
        return '#d9d9d9';
    }
  };

  const renderSeat = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.seatItem,
        { borderColor: getSeatColor(item.status) },
        item.status === 'FREE' && styles.seatFree,
        item.status === 'BOOKED' && styles.seatBooked,
      ]}
      onPress={() => handleSeatPress(item)}
      disabled={item.status !== 'FREE'}
    >
      <Text
        style={[
          styles.seatLabel,
          { color: getSeatColor(item.status) },
        ]}
      >
        {item.label}
      </Text>
      <Text style={[styles.seatStatus, { color: getSeatColor(item.status) }]}>
        {item.status === 'FREE' ? '空闲' : item.status === 'BOOKED' ? '已约' : '禁用'}
      </Text>
    </TouchableOpacity>
  );

  // 分组座位: 以行显示
  const seatGroups = [];
  const sortedSeats = seatList.sort(
    (a, b) => parseInt(a.label) - parseInt(b.label)
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ 返回</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {roomName || roomNameE}
          </Text>
          <Text style={styles.headerSub}>
            {buildingName} {floorName}
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* 统计 */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#52c41a' }]} />
          <Text style={styles.statText}>空闲 {freeCount}</Text>
        </View>
        <View style={styles.statItem}>
          <View style={[styles.statDot, { backgroundColor: '#ff4d4f' }]} />
          <Text style={styles.statText}>已约 {bookedCount}</Text>
        </View>
        <Text style={styles.statDate}>📅 {date}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1677FF" />
        </View>
      ) : (
        <FlatList
          data={sortedSeats}
          keyExtractor={(item) => item.id}
          renderItem={renderSeat}
          numColumns={6}
          contentContainerStyle={styles.seatGrid}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>暂无可选座位</Text>
            </View>
          }
        />
      )}

      {/* 预约弹窗 */}
      <Modal visible={bookingModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>预约座位</Text>
              <TouchableOpacity onPress={() => setBookingModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedSeat && (
              <>
                <View style={styles.modalSeatInfo}>
                  <Text style={styles.modalSeatLabel}>
                    {selectedSeat.label}号座位
                  </Text>
                  <Text style={styles.modalSeatLoc}>
                    {buildingName} {floorName} {roomName}
                  </Text>
                  <Text style={styles.modalSeatDate}>📅 {date}</Text>
                </View>

                {/* 开始时间 */}
                <Text style={styles.timeSectionTitle}>开始时间</Text>
                <View style={styles.timeGrid}>
                  {startTimes.map((item, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[
                        styles.timeChip,
                        selectedStart === item && styles.timeChipActive,
                      ]}
                      onPress={() => handleStartSelect(item)}
                    >
                      <Text
                        style={[
                          styles.timeChipText,
                          selectedStart === item && styles.timeChipTextActive,
                        ]}
                      >
                        {item[1]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 结束时间 */}
                {selectedStart && (
                  <>
                    <Text style={styles.timeSectionTitle}>结束时间</Text>
                    <View style={styles.timeGrid}>
                      {endTimes.map((item, idx) => (
                        <TouchableOpacity
                          key={idx}
                          style={[
                            styles.timeChip,
                            selectedEnd === item && styles.timeChipActive,
                          ]}
                          onPress={() => setSelectedEnd(item)}
                        >
                          <Text
                            style={[
                              styles.timeChipText,
                              selectedEnd === item && styles.timeChipTextActive,
                            ]}
                          >
                            {item[1]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {/* 预约按钮 */}
                {selectedStart && selectedEnd && (
                  <TouchableOpacity
                    style={[styles.bookBtn, booking && styles.bookBtnDisabled]}
                    onPress={handleBook}
                    disabled={booking}
                  >
                    {booking ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.bookBtnText}>
                        确认预约 · {selectedStart[1]} 至 {selectedEnd[1]}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
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
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statText: {
    fontSize: 13,
    color: '#666',
  },
  statDate: {
    fontSize: 13,
    color: '#999',
    marginLeft: 'auto',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  seatGrid: {
    padding: 12,
    alignItems: 'center',
  },
  seatItem: {
    width: 52,
    height: 64,
    margin: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  seatFree: {
    backgroundColor: '#f6ffed',
  },
  seatBooked: {
    backgroundColor: '#fff2f0',
  },
  seatLabel: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  seatStatus: {
    fontSize: 10,
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  modalClose: {
    fontSize: 20,
    color: '#999',
    padding: 4,
  },
  modalSeatInfo: {
    backgroundColor: '#f0f5ff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  modalSeatLabel: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1677FF',
  },
  modalSeatLoc: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  modalSeatDate: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  timeSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  timeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  timeChipActive: {
    backgroundColor: '#1677FF',
  },
  timeChipText: {
    fontSize: 13,
    color: '#666',
  },
  timeChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  bookBtn: {
    backgroundColor: '#1677FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  bookBtnDisabled: {
    opacity: 0.7,
  },
  bookBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
