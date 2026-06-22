import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Alert,
  Modal, TextInput, ActivityIndicator, ScrollView,
} from 'react-native';
import { getBuildingFloorDate, findRoomDuration } from '../api/client';
import { createSchedule, getSchedules, deleteSchedule, toggleSchedule, executeSchedules } from '../api/scheduleApi';
import { todayDateStr, tomorrowDateStr } from '../utils/time';

export default function ScheduleScreen({ navigation }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // 表单
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

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const resp = await getSchedules();
      if (resp.status && resp.data) {
        setTasks(resp.data);
      }
    } catch (e) {
      Alert.alert('错误', '无法连接定时预约服务');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = async () => {
    setShowModal(true);
    setStep(1);
    setSelectedBuilding(null);
    setSelectedRoom(null);
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = d.toISOString().slice(0, 10);
    setDateFrom(tomorrow);
    setDateTo(tomorrow);
    try {
      const resp = await getBuildingFloorDate();
      if (resp.status && resp.data) setBuildings(resp.data.buildings || []);
    } catch (e) { Alert.alert('错误', e.message); }
  };

  const loadRooms = async (buildingId) => {
    try {
      const resp = await findRoomDuration(buildingId, dateFrom, { pageSize: 50 });
      if (resp.status && resp.data) setRooms(resp.data.pageList || []);
    } catch (e) { Alert.alert('错误', e.message); }
  };

  const handleCreate = async () => {
    if (!selectedBuilding || !selectedRoom) return Alert.alert('提示', '请选择场馆和房间');
    const startMinute = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
    const endMinute = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
    if (endMinute <= startMinute) return Alert.alert('提示', '结束时间必须晚于开始时间');

    try {
      const resp = await createSchedule({
        dateFrom, dateTo,
        buildingName: selectedBuilding.name || '图书馆',
        roomName: selectedRoom.name || selectedRoom.nameE,
        roomId: selectedRoom.id,
        startMinute, endMinute, startTime, endTime,
        preferredSeats,
      });
      if (resp.status) {
        setShowModal(false);
        loadTasks();
        Alert.alert('成功', `定时预约已创建: ${dateFrom} ~ ${dateTo}`);
      } else {
        Alert.alert('失败', resp.message || '创建失败');
      }
    } catch (e) { Alert.alert('错误', e.message); }
  };

  const handleDelete = (id) => {
    Alert.alert('删除任务', '确定删除？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { await deleteSchedule(id); loadTasks(); } },
    ]);
  };

  const handleToggle = async (id, enabled) => {
    await toggleSchedule(id, !enabled);
    loadTasks();
  };

  const handleExecuteNow = async () => {
    try {
      await executeSchedules();
      loadTasks();
      Alert.alert('执行完成', '已检查并执行所有到期任务');
    } catch (e) { Alert.alert('错误', e.message); }
  };

  const renderResultRow = (date, result) => {
    const e = result || '⏳ 待执行';
    const color = e.startsWith('✅') ? '#52c41a' : e.startsWith('❌') ? '#ff4d4f' : e.startsWith('⚠️') ? '#faad14' : '#999';
    return (
      <View key={date} style={ss.resultRow}>
        <Text style={ss.resultDate}>{date.slice(5)}</Text>
        <Text style={[ss.resultText, { color }]} numberOfLines={1}>{e}</Text>
      </View>
    );
  };

  const renderTask = ({ item }) => {
    const results = item.results || {};
    const allDates = [];
    const d = new Date(item.dateFrom);
    const end = new Date(item.dateTo);
    while (d <= end) {
      allDates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }

    return (
      <View style={[ss.card, !item.enabled && ss.cardOff]}>
        <View style={ss.cardHeader}>
          <View style={[ss.dot, { backgroundColor: item.enabled ? '#52c41a' : '#d9d9d9' }]} />
          <Text style={ss.status}>{item.enabled ? '启用' : '暂停'}</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => handleToggle(item.id, item.enabled)}>
            <Text style={ss.toggleBtn}>{item.enabled ? '暂停' : '启用'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item.id)}>
            <Text style={ss.delBtn}>删除</Text>
          </TouchableOpacity>
        </View>

        <Text style={ss.cardTitle}>{item.buildingName} · {item.roomName}</Text>
        <Text style={ss.cardInfo}>📅 {item.dateFrom} ~ {item.dateTo} · ⏰ {item.startTime} ~ {item.endTime}</Text>
        {item.preferredSeats?.length > 0 ? (
          <Text style={ss.cardInfo}>🎯 偏好: {item.preferredSeats.join(', ')}号</Text>
        ) : null}

        <View style={ss.resultBox}>
          {allDates.map(date => renderResultRow(date, results[date]))}
        </View>
      </View>
    );
  };

  if (loading) {
    return <View style={ss.loading}><ActivityIndicator size="large" color="#1677FF" /></View>;
  }

  return (
    <View style={ss.container}>
      <View style={ss.header}>
        <Text style={ss.title}>定时预约</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={ss.execBtn} onPress={handleExecuteNow}>
            <Text style={ss.execBtnText}>▶ 执行</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ss.addBtn} onPress={openCreate}>
            <Text style={ss.addBtnText}>+ 新建</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTask}
        contentContainerStyle={ss.list}
        ListEmptyComponent={
          <View style={ss.empty}>
            <Text style={ss.emptyIcon}>⏰</Text>
            <Text style={ss.emptyText}>暂无定时任务</Text>
            <Text style={ss.emptyHint}>创建任务后服务器每天凌晨5点自动预约</Text>
            <TouchableOpacity style={ss.createBtn} onPress={openCreate}>
              <Text style={ss.createBtnText}>创建第一个任务</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* 新建 Modal */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <View style={ss.mOverlay}>
          <View style={ss.mContent}>
            <View style={ss.mHeader}>
              <Text style={ss.mTitle}>{['选择场馆', '选择房间', '设置日期时段'][step - 1]}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}><Text style={ss.mClose}>✕</Text></TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              {step === 1 && buildings.map(b => (
                <TouchableOpacity key={b.id} style={ss.sel}
                  onPress={() => { setSelectedBuilding(b); setStep(2); loadRooms(b.id); }}>
                  <Text style={ss.selText}>🏛️ {b.name || b.nameE}</Text>
                  <Text style={ss.selSub}>{b.seTime} · {b.floors?.length || 0}层</Text>
                </TouchableOpacity>
              ))}

              {step === 2 && rooms.map(r => (
                <TouchableOpacity key={r.id} style={ss.sel}
                  onPress={() => { setSelectedRoom(r); setStep(3); }}>
                  <Text style={ss.selText}>{r.name || r.nameE}</Text>
                  <Text style={ss.selSub}>{r.floorName} · 空闲 {r.seatFree}/{r.seatTotal}</Text>
                </TouchableOpacity>
              ))}

              {step === 3 && (
                <View style={{ padding: 4 }}>
                  <Text style={ss.label}>起始日期</Text>
                  <TextInput style={ss.input} value={dateFrom} onChangeText={setDateFrom}
                    placeholder="YYYY-MM-DD" />
                  <Text style={ss.label}>结束日期</Text>
                  <TextInput style={ss.input} value={dateTo} onChangeText={setDateTo}
                    placeholder="YYYY-MM-DD" />
                  <Text style={ss.label}>开始时间</Text>
                  <TextInput style={ss.input} value={startTime} onChangeText={setStartTime}
                    placeholder="08:00" keyboardType="numbers-and-punctuation" />
                  <Text style={ss.label}>结束时间</Text>
                  <TextInput style={ss.input} value={endTime} onChangeText={setEndTime}
                    placeholder="21:30" keyboardType="numbers-and-punctuation" />
                  <Text style={ss.label}>偏好座位号（可选，逗号分隔）</Text>
                  <TextInput style={ss.input} value={preferredSeats}
                    onChangeText={setPreferredSeats} placeholder="例如: 75,80" />
                  <TouchableOpacity style={ss.submitBtn} onPress={handleCreate}>
                    <Text style={ss.submitText}>创建定时任务</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1677FF', paddingTop: 50, paddingBottom: 14, paddingHorizontal: 16,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  execBtn: { backgroundColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  execBtnText: { color: '#fff', fontSize: 13 },

  list: { padding: 16 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04,
    shadowRadius: 6, elevation: 2,
  },
  cardOff: { opacity: 0.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 13, color: '#666' },
  toggleBtn: { fontSize: 13, color: '#1677FF', marginRight: 12 },
  delBtn: { fontSize: 13, color: '#ff4d4f' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 4 },
  cardInfo: { fontSize: 13, color: '#666', marginTop: 2 },

  resultBox: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 8 },
  resultDate: { fontSize: 12, color: '#999', width: 40, fontFamily: 'monospace' },
  resultText: { fontSize: 12, flex: 1 },

  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#999' },
  emptyHint: { fontSize: 13, color: '#bbb', marginTop: 8, marginBottom: 20 },
  createBtn: { backgroundColor: '#1677FF', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f7fa' },

  // Modal
  mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  mContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  mTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  mClose: { fontSize: 20, color: '#999', padding: 4 },
  sel: { paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  selText: { fontSize: 15, fontWeight: '500', color: '#333' },
  selSub: { fontSize: 12, color: '#999', marginTop: 2 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: '#fafafa', marginBottom: 8 },
  submitBtn: { backgroundColor: '#1677FF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 20 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
