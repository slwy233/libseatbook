import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator, Modal, ScrollView, RefreshControl, useWindowDimensions } from 'react-native';
import { getFreeSeats, getStartTimes, getEndTimes, bookSeat } from '../api/client';
import { nowMinutes } from '../utils/time';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import StateView from '../components/StateView';
import { colors } from '../theme';

const timeOptions = value => Array.isArray(value) ? value.filter(item => Array.isArray(item) && item.length >= 2 && (item[0] === 'now' || /^\d+$/.test(String(item[0])))) : [];
const timeMinute = item => item?.[0] === 'now' ? 0 : Number(item?.[0]);

export default function SeatMapScreen({ route, navigation }) {
  const { roomId, roomName, roomNameE, buildingName, floorName, date } = route.params;
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [startTimes, setStartTimes] = useState([]);
  const [endTimes, setEndTimes] = useState([]);
  const [selectedStart, setSelectedStart] = useState(null);
  const [selectedEnd, setSelectedEnd] = useState(null);
  const [bookingModal, setBookingModal] = useState(false);
  const [booking, setBooking] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [endLoading, setEndLoading] = useState(false);
  const [startError, setStartError] = useState('');
  const [endError, setEndError] = useState('');
  const seatRequest = useRef(0);
  const startRequest = useRef(0);
  const endRequest = useRef(0);
  const bookingLock = useRef(false);
  const mounted = useRef(true);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const columns = Math.max(3, Math.min(8, Math.floor((width - 24) / 62)));
  const seatWidth = Math.max(40, (width - 24) / columns - 8);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; seatRequest.current += 1; startRequest.current += 1; endRequest.current += 1; }; }, []);
  const closeModal = () => {
    if (bookingLock.current) return;
    startRequest.current += 1; endRequest.current += 1;
    setBookingModal(false); setSelectedSeat(null); setSelectedStart(null); setSelectedEnd(null);
    setStartTimes([]); setEndTimes([]); setStartError(''); setEndError('');
  };
  const loadSeats = useCallback(async () => {
    const version = ++seatRequest.current;
    setLoading(true); setError('');
    try {
      const resp = await getFreeSeats(roomId, date);
      if (version !== seatRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '获取座位失败');
      const list = Object.values(resp.data || {}).filter(item => item && typeof item === 'object' && item.id != null);
      setSeats(list);
    } catch (e) {
      if (version === seatRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setError(e.message || '网络异常，请重试');
    } finally { if (version === seatRequest.current && mounted.current) setLoading(false); }
  }, [roomId, date]);
  useEffect(() => { closeModal(); setSeats([]); loadSeats(); return () => { seatRequest.current += 1; startRequest.current += 1; endRequest.current += 1; }; }, [loadSeats]);

  const handleSeatPress = async seat => {
    if (seat.status !== 'FREE' || bookingLock.current) return;
    const version = ++startRequest.current;
    endRequest.current += 1;
    setSelectedSeat(seat); setSelectedStart(null); setSelectedEnd(null); setStartTimes([]); setEndTimes([]);
    setStartError(''); setEndError(''); setStartLoading(true); setEndLoading(false); setBookingModal(true);
    try {
      const resp = await getStartTimes(seat.id, date);
      if (version !== startRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '获取开始时间失败');
      setStartTimes(timeOptions(resp.data));
    } catch (e) {
      if (version === startRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setStartError(e.message || '获取开始时间失败');
    } finally { if (version === startRequest.current && mounted.current) setStartLoading(false); }
  };
  const handleStartSelect = async item => {
    if (!selectedSeat || bookingLock.current) return;
    const version = ++endRequest.current;
    setSelectedStart(item); setSelectedEnd(null); setEndTimes([]); setEndError(''); setEndLoading(true);
    try {
      const resp = await getEndTimes(selectedSeat.id, date, timeMinute(item));
      if (version !== endRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '获取结束时间失败');
      setEndTimes(timeOptions(resp.data).filter(option => option[0] !== 'now'));
    } catch (e) {
      if (version === endRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setEndError(e.message || '获取结束时间失败');
    } finally { if (version === endRequest.current && mounted.current) setEndLoading(false); }
  };
  const handleBook = async () => {
    if (bookingLock.current) return;
    if (!selectedSeat || !selectedStart || !selectedEnd || startLoading || endLoading) return Alert.alert('请选择时段', '请选择可用的开始和结束时间');
    const start = timeMinute(selectedStart); const end = timeMinute(selectedEnd);
    const actualStart = selectedStart[0] === 'now' ? nowMinutes() : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= 1440 || end > 1440 || end <= actualStart) return Alert.alert('时段无效', '结束时间必须晚于开始时间，请重新选择');
    bookingLock.current = true; setBooking(true);
    try {
      const resp = await bookSeat(selectedSeat.id, date, start, end);
      if (!mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '预约失败，请刷新座位后重试');
      setBookingModal(false); startRequest.current += 1; endRequest.current += 1;
      Alert.alert('预约成功', `${selectedSeat.label}号座位 · ${date}\n${selectedStart[1]} 至 ${selectedEnd[1]}\n${buildingName} ${floorName} ${roomName || roomNameE}`, [{ text: '查看我的预约', onPress: () => navigation.navigate('Main', { screen: 'My' }) }]);
      setSelectedSeat(null); loadSeats();
    } catch (e) {
      if (mounted.current && e.message !== 'TOKEN_EXPIRED') Alert.alert('预约未完成', e.message || '网络异常，请刷新后核对我的预约');
    } finally { bookingLock.current = false; if (mounted.current) setBooking(false); }
  };
  const freeCount = seats.filter(item => item.status === 'FREE').length;
  const bookedCount = seats.filter(item => item.status === 'BOOKED').length;
  const sortedSeats = useMemo(() => seats.filter(item => !onlyFree || item.status === 'FREE').sort((a, b) => String(a.label ?? '').localeCompare(String(b.label ?? ''), undefined, { numeric: true })), [seats, onlyFree]);
  return (
    <View style={s.container}>
      <ScreenHeader title={roomName || roomNameE || '座位列表'} subtitle={`${buildingName || ''} ${floorName || ''}`} onBack={() => { if (!bookingLock.current) navigation.goBack(); }} />
      <View style={s.toolbar}>
        <Text style={s.date}>{date}</Text><Text style={s.stat}>空闲 {freeCount} · 已约 {bookedCount}</Text>
        <View style={s.row}>
          <TouchableOpacity style={[s.filter, onlyFree && s.filterOn]} onPress={() => setOnlyFree(!onlyFree)} accessibilityRole="button" accessibilityState={{ selected: onlyFree }}><Text style={{ color: onlyFree ? colors.primary : colors.muted }}>{onlyFree ? '✓ 只看空闲' : '只看空闲'}</Text></TouchableOpacity>
          <TouchableOpacity style={s.filter} onPress={loadSeats} disabled={loading} accessibilityRole="button"><Text style={{ color: colors.primary }}>{loading ? '刷新中…' : '刷新座位'}</Text></TouchableOpacity>
        </View>
        <Text style={s.hint}>座位按编号排列，位置请以现场布局为准。绿：空闲 · 红：已约 · 灰：不可用</Text>
      </View>
      <FlatList key={columns} data={sortedSeats} keyExtractor={item => String(item.id)} numColumns={columns} contentContainerStyle={s.grid}
        refreshControl={<RefreshControl refreshing={loading && seats.length > 0} onRefresh={loadSeats} tintColor={colors.primary} />}
        ListHeaderComponent={error && seats.length ? <StateView error={error} onRetry={loadSeats} /> : null}
        ListEmptyComponent={<StateView loading={loading} error={error} empty={onlyFree ? '暂无空闲座位，可刷新或查看全部座位' : '暂无座位数据'} onRetry={loadSeats} />}
        renderItem={({ item }) => {
          const free = item.status === 'FREE'; const booked = item.status === 'BOOKED';
          return <TouchableOpacity style={[s.seat, { width: seatWidth }, free ? s.free : booked ? s.booked : s.unavailable]} disabled={!free}
            onPress={() => handleSeatPress(item)} accessibilityRole="button" accessibilityLabel={`${item.label}号座位，${free ? '空闲' : booked ? '已预约' : '不可用'}`}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[s.seatLabel, { color: free ? colors.success : booked ? colors.danger : colors.muted }]}>{item.label}</Text>
            <Text style={s.seatStatus}>{free ? '空闲' : booked ? '已约' : '不可用'}</Text>
          </TouchableOpacity>;
        }} />
      <Modal visible={bookingModal} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={s.overlay}><View style={[s.modal, { paddingBottom: Math.max(20, insets.bottom + 12) }]}>
          <View style={s.modalHeader}><Text style={s.title}>预约座位</Text><TouchableOpacity onPress={closeModal} disabled={booking} style={s.close} accessibilityRole="button"><Text style={s.link}>{booking ? '提交中' : '关闭'}</Text></TouchableOpacity></View>
          <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={s.modalScroll}>
            <View style={s.info}><Text style={s.seatTitle}>{selectedSeat?.label} 号座位</Text><Text style={s.location}>{buildingName} {floorName} {roomName || roomNameE}</Text><Text style={s.location}>{date}</Text></View>
            <Text style={s.section}>1 · 选择开始时间</Text>
            {startLoading || startError || !startTimes.length ? <StateView loading={startLoading} error={startError} empty="该座位暂无可预约时段" onRetry={() => selectedSeat && handleSeatPress(selectedSeat)} /> : <View style={s.chips}>{startTimes.map(item => <TouchableOpacity disabled={booking} key={String(item[0])} style={[s.chip, selectedStart?.[0] === item[0] && s.chipOn]} onPress={() => handleStartSelect(item)}><Text style={[s.chipText, selectedStart?.[0] === item[0] && s.white]}>{item[1]}</Text></TouchableOpacity>)}</View>}
            {selectedStart ? <><Text style={s.section}>2 · 选择结束时间</Text>{endLoading || endError || !endTimes.length ? <StateView loading={endLoading} error={endError} empty="该开始时间暂无可用结束时间，请换一个时段" onRetry={() => handleStartSelect(selectedStart)} /> : <View style={s.chips}>{endTimes.map(item => <TouchableOpacity disabled={booking} key={String(item[0])} style={[s.chip, selectedEnd?.[0] === item[0] && s.chipOn]} onPress={() => setSelectedEnd(item)}><Text style={[s.chipText, selectedEnd?.[0] === item[0] && s.white]}>{item[1]}</Text></TouchableOpacity>)}</View>}</> : null}
          </ScrollView>
          <TouchableOpacity style={[s.submit, (!selectedStart || !selectedEnd || endLoading || booking) && s.disabled]} onPress={handleBook} disabled={!selectedStart || !selectedEnd || endLoading || booking} accessibilityRole="button">
            {booking ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>{selectedStart && selectedEnd ? `确认预约 · ${selectedStart[1]} 至 ${selectedEnd[1]}` : '请选择预约时段'}</Text>}
          </TouchableOpacity>
        </View></View>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, toolbar: { padding: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }, date: { color: colors.text, fontSize: 16, fontWeight: '700' }, stat: { color: colors.muted, marginTop: 6, fontSize: 13 }, row: { flexDirection: 'row', gap: 10, marginTop: 12 }, filter: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }, filterOn: { backgroundColor: '#eef5ff', borderColor: colors.primary }, hint: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 10 },
  grid: { padding: 12, paddingBottom: 28, flexGrow: 1 }, seat: { height: 60, margin: 4, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, free: { backgroundColor: '#effaf3', borderColor: '#88c9a8' }, booked: { backgroundColor: '#fff0f1', borderColor: '#edb4b9' }, unavailable: { backgroundColor: '#eef0f4', borderColor: colors.border }, seatLabel: { fontSize: 17, fontWeight: '700', paddingHorizontal: 2 }, seatStatus: { fontSize: 10, color: colors.muted, marginTop: 3 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,30,50,0.45)', justifyContent: 'flex-end' }, modal: { maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30 }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }, title: { fontSize: 20, fontWeight: '700', color: colors.text }, close: { paddingVertical: 10, paddingLeft: 16 }, link: { color: colors.primary, fontSize: 14 }, modalScroll: { paddingBottom: 10 }, info: { backgroundColor: '#eef5ff', borderRadius: 14, padding: 16, marginBottom: 20 }, seatTitle: { color: colors.primary, fontSize: 23, fontWeight: '700' }, location: { color: colors.muted, fontSize: 13, marginTop: 6 }, section: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }, chip: { paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.background, borderRadius: 9 }, chipOn: { backgroundColor: colors.primary }, chipText: { color: colors.text, fontSize: 13 }, white: { color: '#fff' }, submit: { backgroundColor: colors.primary, paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 10 }, submitText: { color: '#fff', fontSize: 15, fontWeight: '700' }, disabled: { opacity: 0.5 },
});
