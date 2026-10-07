import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, Modal, TextInput, ActivityIndicator, ScrollView, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getBuildingFloorDate, findRoomDuration } from '../api/client';
import { createSchedule, getSchedules, deleteSchedule, toggleSchedule, executeSchedules } from '../api/scheduleApi';
import { tomorrowDateStr, formatDate, timeStrToMinutes } from '../utils/time';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { validateSchedule, parsePreferredSeats } from '../utils/validation';
import ScreenHeader from '../components/ScreenHeader';
import StateView from '../components/StateView';
import { colors } from '../theme';

// Bound server-provided ranges before rendering so a long task cannot freeze the list.
function resultDates(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return { dates: [], total: 0 };
  const [fy, fm, fd] = from.split('-').map(Number); const [ty, tm, td] = to.split('-').map(Number);
  const start = new Date(fy, fm - 1, fd); const end = new Date(ty, tm - 1, td);
  if (formatDate(start) !== from || formatDate(end) !== to) return { dates: [], total: 0 };
  const total = Math.max(0, Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1);
  const today = new Date();
  const dayIndex = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  const dates = []; const firstIndex = Math.max(0, Math.min(total - 14, dayIndex - 3));
  for (let index = firstIndex; index < Math.min(total, firstIndex + 14); index += 1) { const date = new Date(start); date.setDate(date.getDate() + index); dates.push(formatDate(date)); }
  return { dates, total };
}

export default function ScheduleScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [buildings, setBuildings] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [dateFrom, setDateFrom] = useState(tomorrowDateStr());
  const [dateTo, setDateTo] = useState(tomorrowDateStr());
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('21:30');
  const [preferredSeats, setPreferredSeats] = useState('');
  const [step, setStep] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [roomPage, setRoomPage] = useState(1);
  const [roomTotal, setRoomTotal] = useState(0);
  const [roomsLoadingMore, setRoomsLoadingMore] = useState(false);
  const roomMoreLock = useRef(false);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [busyIds, setBusyIds] = useState([]);
  const [formError, setFormError] = useState('');
  const mounted = useRef(true);
  const taskRequest = useRef(0);
  const catalogRequest = useRef(0);
  const roomRequest = useRef(0);
  const createLock = useRef(false);
  const executeLock = useRef(false);
  const taskLocks = useRef(new Set());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; taskRequest.current += 1; catalogRequest.current += 1; roomRequest.current += 1; }; }, []);
  const reportError = (title, e) => { if (mounted.current && e.message !== 'TOKEN_EXPIRED') Alert.alert(title, e.message || '网络异常，请重试'); };
  const loadTasks = useCallback(async () => {
    const version = ++taskRequest.current;
    setLoading(true); setError('');
    try {
      const resp = await getSchedules();
      if (version !== taskRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '获取定时任务失败');
      setTasks(Array.isArray(resp.data) ? resp.data.filter(item => item && item.id != null) : []);
    } catch (e) {
      if (version === taskRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setError(e.message || '无法连接定时预约服务');
    } finally { if (version === taskRequest.current && mounted.current) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { loadTasks(); return () => { taskRequest.current += 1; }; }, [loadTasks]));
  const loadBuildings = async () => {
    const version = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    try {
      const resp = await getBuildingFloorDate();
      if (version !== catalogRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '获取场馆失败');
      setBuildings(Array.isArray(resp.data?.buildings) ? resp.data.buildings.filter(item => item && item.id != null) : []);
    } catch (e) {
      if (version === catalogRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setCatalogError(e.message || '获取场馆失败');
    } finally { if (version === catalogRequest.current && mounted.current) setCatalogLoading(false); }
  };
  const loadRooms = useCallback(async () => {
    const version = ++roomRequest.current;
    setRooms([]); setRoomsError(''); setRoomPage(1); setRoomTotal(0); setRoomsLoadingMore(false); roomMoreLock.current = false;
    if (!selectedBuilding || !showModal) { setRoomsLoading(false); return; }
    const invalidDate = validateSchedule({ dateFrom, dateTo: dateFrom, startTime: '08:00', endTime: '21:30' });
    if (invalidDate) { setRoomsLoading(false); setRoomsError(invalidDate); return; }
    setRoomsLoading(true);
    try {
      const resp = await findRoomDuration(selectedBuilding.id, dateFrom, { currentPage: 1, pageSize: 50 });
      if (version !== roomRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '获取房间失败');
      const list = Array.isArray(resp.data?.pageList) ? resp.data.pageList : [];
      setRooms(list); setRoomTotal(Number(resp.data?.totalCount) || list.length);
    } catch (e) {
      if (version === roomRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setRoomsError(e.message || '获取房间失败');
    } finally { if (version === roomRequest.current && mounted.current) setRoomsLoading(false); }
  }, [selectedBuilding, dateFrom, showModal]);
  useEffect(() => { loadRooms(); return () => { roomRequest.current += 1; }; }, [loadRooms]);
  const loadMoreRooms = async () => {
    if (roomsLoading || roomMoreLock.current || rooms.length >= roomTotal || !selectedBuilding) return;
    const version = ++roomRequest.current;
    roomMoreLock.current = true; setRoomsLoadingMore(true); setRoomsError('');
    try {
      const resp = await findRoomDuration(selectedBuilding.id, dateFrom, { currentPage: roomPage + 1, pageSize: 50 });
      if (version !== roomRequest.current || !mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '加载更多房间失败');
      const list = Array.isArray(resp.data?.pageList) ? resp.data.pageList : [];
      setRooms(previous => { const known = new Set(previous.map(item => String(item.id))); return [...previous, ...list.filter(item => !known.has(String(item.id)))]; });
      setRoomPage(roomPage + 1); if (!list.length) setRoomTotal(rooms.length);
    } catch (e) {
      if (version === roomRequest.current && mounted.current && e.message !== 'TOKEN_EXPIRED') setRoomsError(e.message || '加载更多失败');
    } finally { if (version === roomRequest.current && mounted.current) { roomMoreLock.current = false; setRoomsLoadingMore(false); } }
  };
  const closeCreate = () => {
    if (createLock.current) return;
    catalogRequest.current += 1; roomRequest.current += 1;
    setShowModal(false);
  };
  const openCreate = () => {
    if (createLock.current) return;
    const tomorrow = tomorrowDateStr();
    roomRequest.current += 1; setStep(1); setSelectedBuilding(null); setSelectedRoom(null); setRooms([]); setBuildings([]);
    setDateFrom(tomorrow); setDateTo(tomorrow); setStartTime('08:00'); setEndTime('21:30'); setPreferredSeats(''); setFormError(''); setRoomsError('');
    setShowModal(true); loadBuildings();
  };
  const chooseBuilding = building => {
    roomRequest.current += 1; setRooms([]); setSelectedRoom(null); setSelectedBuilding({ ...building }); setRoomsLoading(true); setStep(2);
  };
  const changeDateFrom = value => {
    roomRequest.current += 1; setRooms([]); setSelectedRoom(null); setDateFrom(value); setFormError('');
    if (dateTo < value) setDateTo(value);
  };
  const handleCreate = async () => {
    if (createLock.current) return;
    if (!selectedBuilding || !selectedRoom) { setFormError('请选择场馆和房间'); return; }
    const invalid = validateSchedule({ dateFrom, dateTo, startTime, endTime });
    if (invalid) { setFormError(invalid); return; }
    createLock.current = true; setCreating(true); setFormError('');
    try {
      const resp = await createSchedule({ dateFrom, dateTo, buildingName: selectedBuilding.name || selectedBuilding.nameE || '图书馆', roomName: selectedRoom.name || selectedRoom.nameE, roomId: selectedRoom.id, startMinute: timeStrToMinutes(startTime), endMinute: timeStrToMinutes(endTime), startTime, endTime, preferredSeats: parsePreferredSeats(preferredSeats).join(',') });
      if (!mounted.current) return;
      if (!resp.status) throw new Error(resp.message || '创建失败');
      setShowModal(false); loadTasks(); Alert.alert('任务已创建', `${dateFrom} 至 ${dateTo}\n${startTime} 至 ${endTime}`);
    } catch (e) {
      if (mounted.current && e.message !== 'TOKEN_EXPIRED') setFormError(e.message || '创建失败，请重试');
    } finally { createLock.current = false; if (mounted.current) setCreating(false); }
  };
  const mutateTask = async (id, action) => {
    const key = String(id);
    if (taskLocks.current.has(key) || executeLock.current) return;
    taskLocks.current.add(key); setBusyIds([...taskLocks.current]);
    try {
      const resp = await action();
      if (!resp.status) throw new Error(resp.message || '任务操作失败');
      if (mounted.current) await loadTasks();
    } catch (e) { reportError('任务操作未完成', e); }
    finally { taskLocks.current.delete(key); if (mounted.current) setBusyIds([...taskLocks.current]); }
  };
  const handleDelete = id => {
    if (taskLocks.current.has(String(id)) || executeLock.current) return;
    Alert.alert('删除任务', '删除后该任务将停止后续预约，已有预约不会被取消。', [{ text: '保留', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => mutateTask(id, () => deleteSchedule(id)) }]);
  };
  const executeNow = async () => {
    if (executeLock.current || taskLocks.current.size) return;
    executeLock.current = true; setExecuting(true);
    try {
      const resp = await executeSchedules();
      if (!resp.status) throw new Error(resp.message || '执行失败');
      if (mounted.current) { await loadTasks(); Alert.alert('执行已完成', resp.message || '请查看各任务执行结果及我的预约'); }
    } catch (e) { reportError('执行未完成', e); }
    finally { executeLock.current = false; if (mounted.current) setExecuting(false); }
  };
  const confirmExecute = () => Alert.alert('立即执行任务', '将请求服务器检查并预约到期任务，执行结果以服务器返回为准。', [{ text: '取消', style: 'cancel' }, { text: '立即执行', onPress: executeNow }]);
  return (
    <View style={ss.container}>
      <ScreenHeader title="定时预约" subtitle="提前安排学习时段，集中查看执行结果"
        action={<TouchableOpacity onPress={openCreate} style={ss.headerButton} accessibilityRole="button"><Text style={ss.white}>+ 新建</Text></TouchableOpacity>} />
      <View style={ss.summary}><Text style={ss.summaryText}>{tasks.length} 个任务 · {tasks.filter(item => item.enabled).length} 个启用</Text><TouchableOpacity onPress={confirmExecute} disabled={executing || loading || !tasks.length || busyIds.length > 0} style={ss.execute}><Text style={{ color: executing || loading || !tasks.length ? colors.muted : colors.primary }}>{executing ? '执行中…' : '立即执行'}</Text></TouchableOpacity></View>
      <FlatList data={tasks} keyExtractor={item => String(item.id)} contentContainerStyle={ss.list}
        refreshControl={<RefreshControl refreshing={loading && tasks.length > 0} onRefresh={loadTasks} tintColor={colors.primary} />}
        ListHeaderComponent={error && tasks.length ? <StateView error={error} onRetry={loadTasks} /> : null}
        ListEmptyComponent={<><StateView loading={loading} error={error} empty="暂无定时任务，创建一个学习计划吧" onRetry={loadTasks} />{!loading && !error ? <TouchableOpacity style={ss.submit} onPress={openCreate}><Text style={ss.submitText}>创建第一个任务</Text></TouchableOpacity> : null}</>}
        renderItem={({ item }) => {
          const { dates, total } = resultDates(item.dateFrom, item.dateTo); const busy = busyIds.includes(String(item.id));
          const preferred = Array.isArray(item.preferredSeats) ? item.preferredSeats.join('、') : item.preferredSeats;
          return <View style={[ss.card, !item.enabled && ss.cardOff]}>
            <View style={ss.row}><Text style={[ss.status, { color: item.enabled ? colors.success : colors.muted }]}>{item.enabled ? '● 已启用' : '● 已暂停'}</Text><View style={{ flex: 1 }} />{busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
              <TouchableOpacity disabled={busy || executing} onPress={() => mutateTask(item.id, () => toggleSchedule(item.id, !item.enabled))} style={ss.taskAction}><Text style={ss.link}>{item.enabled ? '暂停' : '启用'}</Text></TouchableOpacity>
              <TouchableOpacity disabled={busy || executing} onPress={() => handleDelete(item.id)} style={ss.taskAction}><Text style={{ color: colors.danger }}>删除</Text></TouchableOpacity>
            </View>
            <Text style={ss.cardTitle}>{item.buildingName} · {item.roomName}</Text>
            <Text style={ss.cardInfo}>{item.dateFrom} 至 {item.dateTo}</Text><Text style={ss.cardTime}>{item.startTime} — {item.endTime}</Text>
            {preferred ? <Text style={ss.cardInfo}>偏好座位：{preferred}</Text> : null}
            <View style={ss.results}>{total > dates.length ? <Text style={ss.resultHint}>共 {total} 天，展示 {dates[0]} 至 {dates[dates.length - 1]} 的结果</Text> : null}{!dates.length ? <Text style={ss.resultHint}>任务日期信息无效，请核对</Text> : null}
              {dates.map(date => { const result = String(item.results?.[date] || '待执行'); const color = result.startsWith('✅') ? colors.success : result.startsWith('❌') ? colors.danger : colors.muted; return <View key={date} style={ss.resultRow}><Text style={ss.resultDate}>{date.slice(5)}</Text><Text style={[ss.resultText, { color }]}>{result}</Text></View>; })}
            </View>
          </View>;
        }} />
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={closeCreate}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ss.overlay}>
          <View style={[ss.modal, { paddingBottom: Math.max(20, insets.bottom + 12) }]}>
            <View style={ss.modalHeader}><View><Text style={ss.modalTitle}>{['选择场馆', '选择日期与房间', '设置预约时段'][step - 1]}</Text><Text style={ss.stepText}>第 {step} / 3 步</Text></View><TouchableOpacity disabled={creating} onPress={closeCreate} style={ss.taskAction}><Text style={ss.link}>{creating ? '提交中' : '关闭'}</Text></TouchableOpacity></View>
            {step > 1 ? <TouchableOpacity disabled={creating} style={ss.back} onPress={() => { setStep(step - 1); setFormError(''); }}><Text style={ss.link}>‹ 上一步 · {step === 2 ? '重新选择场馆' : '重新选择房间'}</Text></TouchableOpacity> : null}
            <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={ss.modalScroll}>
              {step === 1 ? catalogLoading || catalogError || !buildings.length ? <StateView loading={catalogLoading} error={catalogError} empty="暂无可预约场馆" onRetry={loadBuildings} /> : buildings.map(building => <TouchableOpacity key={String(building.id)} style={ss.option} onPress={() => chooseBuilding(building)}><Text style={ss.optionTitle}>{building.name || building.nameE || '图书馆'}</Text><Text style={ss.optionDetail}>{building.seTime || '选择场馆查看房间'}</Text></TouchableOpacity>) : null}
              {step === 2 ? <>
                <Text style={ss.selected}>{selectedBuilding?.name || selectedBuilding?.nameE}</Text><Text style={ss.label}>起始日期</Text><TextInput style={ss.input} value={dateFrom} onChangeText={changeDateFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" maxLength={10} accessibilityLabel="任务起始日期" />
                <Text style={ss.note}>下方显示此日期可查询的房间{roomTotal > 0 ? `，已显示 ${rooms.length} / ${roomTotal} 个区域` : ''}。</Text>
                {roomsLoading || !rooms.length ? <StateView loading={roomsLoading} error={roomsError} empty="该日期暂无可选房间，请换日期或场馆" onRetry={loadRooms} /> : <>{roomsError ? <StateView error={roomsError} onRetry={loadMoreRooms} /> : null}{rooms.map(room => <TouchableOpacity key={String(room.id)} style={ss.option} onPress={() => { setSelectedRoom(room); setStep(3); setFormError(''); }}><Text style={ss.optionTitle}>{room.name || room.nameE}</Text><Text style={ss.optionDetail}>{room.floorName} · 空闲 {room.seatFree ?? 0} / {room.seatTotal ?? 0}</Text></TouchableOpacity>)}{rooms.length < roomTotal ? <TouchableOpacity style={ss.moreRooms} disabled={roomsLoadingMore} onPress={loadMoreRooms}><Text style={ss.link}>{roomsLoadingMore ? '加载中…' : '加载更多房间'}</Text></TouchableOpacity> : null}</>}
              </> : null}
              {step === 3 ? <>
                <View style={ss.selection}><Text style={ss.optionTitle}>{selectedBuilding?.name || selectedBuilding?.nameE} · {selectedRoom?.name || selectedRoom?.nameE}</Text><Text style={ss.optionDetail}>从 {dateFrom} 开始</Text></View>
                <Text style={ss.label}>结束日期</Text><TextInput editable={!creating} style={ss.input} value={dateTo} onChangeText={value => { setDateTo(value); setFormError(''); }} placeholder="YYYY-MM-DD" maxLength={10} accessibilityLabel="任务结束日期" />
                <View style={ss.timeRow}><View style={ss.timeField}><Text style={ss.label}>开始时间</Text><TextInput editable={!creating} style={ss.input} value={startTime} onChangeText={value => { setStartTime(value); setFormError(''); }} placeholder="08:00" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel="开始时间" /></View><View style={ss.timeField}><Text style={ss.label}>结束时间</Text><TextInput editable={!creating} style={ss.input} value={endTime} onChangeText={value => { setEndTime(value); setFormError(''); }} placeholder="21:30" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel="结束时间" /></View></View>
                <Text style={ss.label}>偏好座位号（可选）</Text><TextInput editable={!creating} style={ss.input} value={preferredSeats} onChangeText={setPreferredSeats} placeholder="例如 75, 80，留空由服务选择" accessibilityLabel="偏好座位号" /><Text style={ss.note}>多个座位用中文或英文逗号分隔，重复项会自动合并。</Text>
                {formError ? <Text style={ss.formError} accessibilityRole="alert">{formError}</Text> : null}
                <TouchableOpacity disabled={creating} style={[ss.submit, creating && { opacity: 0.6 }]} onPress={handleCreate}>{creating ? <ActivityIndicator color="#fff" /> : <Text style={ss.submitText}>创建定时任务</Text>}</TouchableOpacity>
              </> : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, headerButton: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12 }, white: { color: '#fff', fontWeight: '600' }, summary: { backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, summaryText: { color: colors.muted, fontSize: 13 }, execute: { paddingVertical: 8, paddingHorizontal: 10 }, list: { padding: 16, paddingBottom: 28, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }, cardOff: { backgroundColor: '#f9fafc' }, row: { flexDirection: 'row', alignItems: 'center' }, status: { fontSize: 12, fontWeight: '600' }, taskAction: { paddingVertical: 10, paddingHorizontal: 10 }, link: { color: colors.primary, fontSize: 13 }, cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 8 }, cardInfo: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5 }, cardTime: { color: colors.primary, fontSize: 17, fontWeight: '600', marginTop: 8 }, results: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }, resultHint: { color: colors.muted, fontSize: 11, marginBottom: 6 }, resultRow: { flexDirection: 'row', paddingVertical: 5, gap: 10 }, resultDate: { color: colors.muted, fontSize: 12, width: 44 }, resultText: { flex: 1, fontSize: 12, lineHeight: 18 },
  moreRooms: { alignItems: 'center', padding: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,30,50,0.45)', justifyContent: 'flex-end' }, modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, maxHeight: '88%' }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text }, stepText: { color: colors.muted, fontSize: 12, marginTop: 5 }, back: { paddingVertical: 14 }, modalScroll: { paddingBottom: 12 }, option: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginVertical: 5 }, optionTitle: { color: colors.text, fontSize: 15, fontWeight: '600' }, optionDetail: { color: colors.muted, fontSize: 12, marginTop: 6 }, selected: { color: colors.primary, fontSize: 15, fontWeight: '600', marginTop: 6 }, selection: { backgroundColor: '#eef5ff', borderRadius: 12, padding: 14 }, label: { color: colors.text, fontWeight: '600', fontSize: 13, marginTop: 16, marginBottom: 8 }, input: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontSize: 16, color: colors.text }, timeRow: { flexDirection: 'row', gap: 12 }, timeField: { flex: 1 }, note: { color: colors.muted, fontSize: 11, lineHeight: 18, marginVertical: 10 }, formError: { color: colors.danger, fontSize: 13, marginTop: 14, lineHeight: 20 }, submit: { backgroundColor: colors.primary, borderRadius: 13, paddingVertical: 15, alignItems: 'center', marginTop: 18 }, submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
