import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { getFreeSeats, getStartTimes, getEndTimes, bookSeat } from '../api/client';

export default function SeatMapScreen({ route, navigation }) {
  const { roomId, roomName, roomNameE, buildingName, floorName, date } = route.params;
  const [seats, setSeats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [startTimes, setStartTimes] = useState([]);
  const [endTimes, setEndTimes] = useState([]);
  const [selectedStart, setSelectedStart] = useState(null);
  const [selectedEnd, setSelectedEnd] = useState(null);
  const [bookingModal, setBookingModal] = useState(false);
  const [booking, setBooking] = useState(false);

  useEffect(() => { loadSeats(); }, [date]);

  const loadSeats = async () => {
    setLoading(true);
    try {
      const resp = await getFreeSeats(roomId, date);
      if (resp.status && resp.data) setSeats(resp.data);
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') {
        Alert.alert('登录过期', '请重新登录', [{ text: '确定', onPress: () => navigation.replace('Login') }]);
        return;
      }
      Alert.alert('错误', e.message);
    } finally { setLoading(false); }
  };

  const handleSeatPress = async (seat) => {
    if (seat.status !== 'FREE') return;
    setSelectedSeat(seat);
    setSelectedStart(null);
    setSelectedEnd(null);
    setStartTimes([]);
    setEndTimes([]);
    try {
      const resp = await getStartTimes(seat.id, date);
      if (resp.status && resp.data) {
        setStartTimes(resp.data);
        setBookingModal(true);
      } else {
        Alert.alert('提示', '该座位暂无可选时间段');
      }
    } catch (e) { Alert.alert('错误', '获取时间失败'); }
  };

  const handleStartSelect = async (item) => {
    setSelectedStart(item);
    setSelectedEnd(null);
    const startMinute = item[0] === 'now' ? 0 : parseInt(item[0]);
    try {
      const resp = await getEndTimes(selectedSeat.id, date, startMinute);
      if (resp.status && resp.data) setEndTimes(resp.data);
    } catch (e) { Alert.alert('错误', '获取结束时间失败'); }
  };

  const handleBook = async () => {
    if (!selectedStart || !selectedEnd) {
      Alert.alert('提示', '请选择开始和结束时间');
      return;
    }
    const startMin = selectedStart[0] === 'now' ? 0 : parseInt(selectedStart[0]);
    const endMin = parseInt(selectedEnd[0]);
    if (endMin <= startMin) { Alert.alert('提示', '结束时间必须晚于开始时间'); return; }
    setBooking(true);
    try {
      const resp = await bookSeat(selectedSeat.id, date, startMin, endMin);
      if (resp.status) {
        Alert.alert('预约成功', `座位: ${selectedSeat.label}号\n时间: ${selectedStart[1]} - ${selectedEnd[1]}\n${buildingName} ${floorName} ${roomName}`, [
          { text: '好的', onPress: () => { setBookingModal(false); navigation.goBack(); } },
        ]);
      } else {
        Alert.alert('预约失败', resp.message || '未知错误');
      }
    } catch (e) { Alert.alert('错误', e.message); }
    finally { setBooking(false); }
  };

  const seatList = Object.values(seats);
  const freeCount = seatList.filter((s) => s.status === 'FREE').length;
  const bookedCount = seatList.filter((s) => s.status === 'BOOKED').length;
  const sortedSeats = [...seatList].sort((a, b) => parseInt(a.label) - parseInt(b.label));

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.backText}>‹ 返回</Text></TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{roomName || roomNameE}</Text>
          <Text style={s.headerSub}>{buildingName} {floorName}</Text>
        </View>
        <View style={s.headerSpacer} />
      </View>
      <View style={s.statsBar}>
        <Text style={s.stat}>🟢 空闲 {freeCount}</Text>
        <Text style={s.stat}>🔴 已约 {bookedCount}</Text>
        <Text style={s.statDate}>📅 {date}</Text>
      </View>
      {loading ? (
        <View style={s.loading}><ActivityIndicator size="large" color="#1677FF" /></View>
      ) : (
        <FlatList data={sortedSeats} keyExtractor={(item) => item.id} numColumns={6}
          contentContainerStyle={s.grid}
          renderItem={({ item }) => (
            <TouchableOpacity style={[s.seat, item.status === 'FREE' ? s.free : s.booked]}
              onPress={() => handleSeatPress(item)} disabled={item.status !== 'FREE'}>
              <Text style={[s.seatLabel, {color: item.status === 'FREE' ? '#52c41a' : '#ff4d4f'}]}>{item.label}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>暂无可选座位</Text></View>}
        />
      )}
      <Modal visible={bookingModal} animationType="slide" transparent onRequestClose={() => setBookingModal(false)}>
        <View style={s.mOverlay}>
          <View style={s.mContent}>
            <ScrollView style={s.mScroll} showsVerticalScrollIndicator={false} bounces={false}>
              <View style={s.mTitleRow}>
                <Text style={s.mTitle}>预约座位</Text>
                <TouchableOpacity onPress={() => setBookingModal(false)}><Text style={s.mClose}>✕</Text></TouchableOpacity>
              </View>
              {selectedSeat && (
                <>
                  <View style={s.mInfo}>
                    <Text style={s.mSeat}>{selectedSeat.label}号座位</Text>
                    <Text style={s.mLoc}>{buildingName} {floorName} {roomName}</Text>
                    <Text style={s.mDate}>📅 {date}</Text>
                  </View>
                  <Text style={s.tSection}>开始时间</Text>
                  <View style={s.tGrid}>
                    {startTimes.map((item, idx) => (
                      <TouchableOpacity key={idx} style={[s.tChip, selectedStart === item && s.tChipOn]}
                        onPress={() => handleStartSelect(item)}>
                        <Text style={[s.tChipT, selectedStart === item && s.tChipTOn]}>{item[1]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {selectedStart && (
                    <>
                      <Text style={s.tSection}>结束时间</Text>
                      <View style={s.tGrid}>
                        {endTimes.map((item, idx) => (
                          <TouchableOpacity key={idx} style={[s.tChip, selectedEnd === item && s.tChipOn]}
                            onPress={() => setSelectedEnd(item)}>
                            <Text style={[s.tChipT, selectedEnd === item && s.tChipTOn]}>{item[1]}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                  {selectedStart && selectedEnd && (
                    <TouchableOpacity style={[s.bookBtn, booking && {opacity:0.7}]} onPress={handleBook} disabled={booking}>
                      {booking ? <ActivityIndicator color="#fff" /> : <Text style={s.bookT}>确认预约 · {selectedStart[1]} 至 {selectedEnd[1]}</Text>}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1677FF', paddingTop: 50, paddingBottom: 14, paddingHorizontal: 16 },
  backText: { color: '#fff', fontSize: 16 }, headerSpacer: { width: 60 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  statsBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', gap: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  stat: { fontSize: 13, color: '#666' },
  statDate: { fontSize: 13, color: '#999', marginLeft: 'auto' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  grid: { padding: 12, alignItems: 'center' },
  seat: { width: 52, height: 56, margin: 3, borderRadius: 8, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  free: { backgroundColor: '#f6ffed', borderColor: '#52c41a' },
  booked: { backgroundColor: '#fff2f0', borderColor: '#ff4d4f' },
  seatLabel: { fontSize: 16, fontWeight: 'bold' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: '#999' },
  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  mContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', padding: 20, paddingBottom: 30 },
  mScroll: { flexGrow: 0 },
  mTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  mTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  mClose: { fontSize: 20, color: '#999', padding: 4 },
  mInfo: { backgroundColor: '#f0f5ff', borderRadius: 12, padding: 14, marginBottom: 14 },
  mSeat: { fontSize: 20, fontWeight: 'bold', color: '#1677FF' },
  mLoc: { fontSize: 14, color: '#666', marginTop: 4 },
  mDate: { fontSize: 13, color: '#666', marginTop: 2 },
  tSection: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  tGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f0f0f0' },
  tChipOn: { backgroundColor: '#1677FF' },
  tChipT: { fontSize: 13, color: '#666' },
  tChipTOn: { color: '#fff', fontWeight: '600' },
  bookBtn: { backgroundColor: '#1677FF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8, marginBottom: 10 },
  bookT: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
