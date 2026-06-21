import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getBuildingFloorDate,
  findRoomDuration,
  getFreeSeats,
  getStartTimes,
  getEndTimes,
  bookSeat,
} from '../api/client';
import {
  saveScheduledBookings,
  getScheduledBookings,
} from '../utils/storage';
import { todayDateStr, tomorrowDateStr, minutesToTimeStr } from '../utils/time';

export default function ScheduledScreen({ navigation }) {
  const [scheduledTasks, setScheduledTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // 表单状态
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedDate, setSelectedDate] = useState(tomorrowDateStr());
  const [selectedStartTime, setSelectedStartTime] = useState('');
  const [selectedEndTime, setSelectedEndTime] = useState('');
  const [preferredSeats, setPreferredSeats] = useState('');
  const [step, setStep] = useState(1); // 1=选楼, 2=选室, 3=选时间

  useFocusEffect(
    useCallback(() => {
      loadTasks();
    }, [])
  );

  const loadTasks = async () => {
    const tasks = await getScheduledBookings();
    setScheduledTasks(tasks);
  };

  const loadBuildings = async () => {
    try {
      const resp = await getBuildingFloorDate();
      if (resp.status && resp.data) {
        setBuildings(resp.data.buildings || []);
      }
    } catch (e) {
      Alert.alert('错误', e.message);
    }
  };

  const loadRooms = async (buildingId) => {
    setLoading(true);
    try {
      const resp = await findRoomDuration(buildingId, selectedDate);
      if (resp.status && resp.data) {
        setRooms(resp.data.pageList || []);
      }
    } catch (e) {
      Alert.alert('错误', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = async () => {
    setShowModal(true);
    setStep(1);
    setSelectedBuilding(null);
    setSelectedRoom(null);
    setSelectedStartTime('');
    setSelectedEndTime('');
    setPreferredSeats('');
    await loadBuildings();
  };

  const handleSelectBuilding = (building) => {
    setSelectedBuilding(building);
    setStep(2);
    loadRooms(building.id);
  };

  const handleSelectRoom = (room) => {
    setSelectedRoom(room);
    setStep(3);
  };

  const handleCreateTask = async () => {
    if (!selectedBuilding || !selectedRoom) {
      Alert.alert('提示', '请选择楼栋和房间');
      return;
    }

    if (!selectedStartTime || !selectedEndTime) {
      Alert.alert('提示', '请填写开始和结束时间 (HH:MM 格式)');
      return;
    }

    const task = {
      id: Date.now().toString(),
      buildingId: selectedBuilding.id,
      buildingName: selectedBuilding.name || selectedBuilding.nameE,
      roomId: selectedRoom.id,
      roomName: selectedRoom.name || selectedRoom.nameE,
      roomNameE: selectedRoom.nameE,
      date: selectedDate,
      startTime: selectedStartTime,
      endTime: selectedEndTime,
      preferredSeats: preferredSeats || '',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastResult: null,
    };

    const updated = [...scheduledTasks, task];
    await saveScheduledBookings(updated);
    setScheduledTasks(updated);
    setShowModal(false);
    Alert.alert('定时任务已创建', `将在 ${selectedDate} ${selectedStartTime} 前自动预约`);
  };

  const handleToggleTask = async (taskId) => {
    const updated = scheduledTasks.map((t) =>
      t.id === taskId ? { ...t, enabled: !t.enabled } : t
    );
    await saveScheduledBookings(updated);
    setScheduledTasks(updated);
  };

  const handleDeleteTask = (taskId) => {
    Alert.alert('删除任务', '确定删除该定时任务？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const updated = scheduledTasks.filter((t) => t.id !== taskId);
          await saveScheduledBookings(updated);
          setScheduledTasks(updated);
        },
      },
    ]);
  };

  const handleRunNow = async (task) => {
    setLoading(true);
    try {
      // 1. 获取空闲座位
      const seatsResp = await getFreeSeats(task.roomId, task.date);
      if (!seatsResp.status || !seatsResp.data) {
        throw new Error('获取座位失败');
      }

      const freeSeats = Object.values(seatsResp.data).filter(
        (s) => s.status === 'FREE'
      );

      if (freeSeats.length === 0) {
        throw new Error('没有空闲座位');
      }

      // 2. 如果有偏好座位，优先选择
      let targetSeat = freeSeats[0];
      if (task.preferredSeats) {
        const preferred = task.preferredSeats.split(',').map((s) => s.trim());
        const found = freeSeats.find((s) => preferred.includes(s.label));
        if (found) targetSeat = found;
      }

      // 3. 计算时间
      const startMin =
        parseInt(task.startTime.split(':')[0]) * 60 +
        parseInt(task.startTime.split(':')[1]);
      const endMin =
        parseInt(task.endTime.split(':')[0]) * 60 +
        parseInt(task.endTime.split(':')[1]);

      // 4. 预约
      const bookResp = await bookSeat(
        targetSeat.id,
        task.date,
        startMin,
        endMin
      );

      if (bookResp.status) {
        const updated = scheduledTasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                lastRun: new Date().toISOString(),
                lastResult: `✅ 成功: ${targetSeat.label}号 ${task.startTime}-${task.endTime}`,
              }
            : t
        );
        await saveScheduledBookings(updated);
        setScheduledTasks(updated);
        Alert.alert('预约成功 🎉', `座位: ${targetSeat.label}号\n时间: ${task.startTime}-${task.endTime}`);
      } else {
        throw new Error(bookResp.message || '预约失败');
      }
    } catch (e) {
      const updated = scheduledTasks.map((t) =>
        t.id === task.id
          ? { ...t, lastRun: new Date().toISOString(), lastResult: `❌ ${e.message}` }
          : t
      );
      await saveScheduledBookings(updated);
      setScheduledTasks(updated);
      Alert.alert('预约失败', e.message);
    } finally {
      setLoading(false);
    }
  };

  const renderTaskItem = ({ item }) => (
    <View style={[styles.taskCard, !item.enabled && styles.taskCardDisabled]}>
      <View style={styles.taskHeader}>
        <View style={styles.taskStatus}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.enabled ? '#52c41a' : '#d9d9d9' },
            ]}
          />
          <Text style={styles.taskStatusText}>
            {item.enabled ? '启用' : '禁用'}
          </Text>
        </View>
        <View style={styles.taskActions}>
          <TouchableOpacity
            style={styles.runBtn}
            onPress={() => handleRunNow(item)}
            disabled={loading}
          >
            <Text style={styles.runBtnText}>▶ 立即执行</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toggleBtn}
            onPress={() => handleToggleTask(item.id)}
          >
            <Text style={styles.toggleBtnText}>
              {item.enabled ? '暂停' : '启用'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.taskBody}>
        <View style={styles.taskRow}>
          <Text style={styles.taskLabel}>位置</Text>
          <Text style={styles.taskValue}>
            {item.buildingName} {item.roomName}
          </Text>
        </View>
        <View style={styles.taskRow}>
          <Text style={styles.taskLabel}>日期</Text>
          <Text style={styles.taskValue}>{item.date}</Text>
        </View>
        <View style={styles.taskRow}>
          <Text style={styles.taskLabel}>时间</Text>
          <Text style={styles.taskValue}>
            {item.startTime} - {item.endTime}
          </Text>
        </View>
        {item.preferredSeats ? (
          <View style={styles.taskRow}>
            <Text style={styles.taskLabel}>偏好座位</Text>
            <Text style={styles.taskValue}>{item.preferredSeats}</Text>
          </View>
        ) : null}
        {item.lastResult ? (
          <View style={styles.taskResult}>
            <Text style={styles.taskResultText}>{item.lastResult}</Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        style={styles.deleteTaskBtn}
        onPress={() => handleDeleteTask(item.id)}
      >
        <Text style={styles.deleteTaskText}>删除任务</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>定时预约</Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleOpenModal}>
          <Text style={styles.addBtnText}>+ 新建</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={scheduledTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTaskItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>⏰</Text>
            <Text style={styles.emptyText}>暂无定时任务</Text>
            <Text style={styles.emptyHint}>
              创建定时任务，系统将在指定时间自动预约座位
            </Text>
            <TouchableOpacity style={styles.createBtn} onPress={handleOpenModal}>
              <Text style={styles.createBtnText}>创建第一个定时任务</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* 新建任务 Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {step === 1 ? '选择楼栋' : step === 2 ? '选择房间' : '设置时间'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Step 指示器 */}
            <View style={styles.stepIndicator}>
              {[1, 2, 3].map((s) => (
                <View
                  key={s}
                  style={[styles.stepDot, step >= s && styles.stepDotActive]}
                />
              ))}
            </View>

            {loading && (
              <ActivityIndicator
                size="large"
                color="#1677FF"
                style={{ marginVertical: 20 }}
              />
            )}

            {step === 1 &&
              !loading &&
              buildings.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.selectItem}
                  onPress={() => handleSelectBuilding(b)}
                >
                  <Text style={styles.selectItemText}>
                    🏛️ {b.name || b.nameE}
                  </Text>
                  <Text style={styles.selectItemSub}>
                    {b.seTime} · {b.floors?.length || 0} 层
                  </Text>
                </TouchableOpacity>
              ))}

            {step === 2 &&
              !loading &&
              rooms.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.selectItem}
                  onPress={() => handleSelectRoom(r)}
                >
                  <View style={styles.selectItemRow}>
                    <Text style={styles.selectItemText}>
                      {r.name || r.nameE}
                    </Text>
                    <Text style={styles.selectItemBadge}>
                      空闲 {r.seatFree}/{r.seatTotal}
                    </Text>
                  </View>
                  <Text style={styles.selectItemSub}>
                    {r.floorName} · {r.nameE}
                  </Text>
                </TouchableOpacity>
              ))}

            {step === 3 && (
              <View>
                <Text style={styles.formLabel}>预约日期</Text>
                <View style={styles.dateRow}>
                  {[
                    { label: '今天', value: todayDateStr() },
                    { label: '明天', value: tomorrowDateStr() },
                  ].map((d) => (
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

                <Text style={styles.formLabel}>开始时间 (HH:MM)</Text>
                <TextInput
                  style={styles.timeInput}
                  placeholder="例如: 08:00"
                  value={selectedStartTime}
                  onChangeText={setSelectedStartTime}
                  keyboardType="numbers-and-punctuation"
                />

                <Text style={styles.formLabel}>结束时间 (HH:MM)</Text>
                <TextInput
                  style={styles.timeInput}
                  placeholder="例如: 21:30"
                  value={selectedEndTime}
                  onChangeText={setSelectedEndTime}
                  keyboardType="numbers-and-punctuation"
                />

                <Text style={styles.formLabel}>偏好座位号 (可选, 逗号分隔)</Text>
                <TextInput
                  style={styles.timeInput}
                  placeholder="例如: 75, 80, 100"
                  value={preferredSeats}
                  onChangeText={setPreferredSeats}
                />

                <Text style={styles.formHint}>
                  💡 系统将在 {selectedDate}{' '}
                  凌晨自动执行预约 (需要App保持后台运行)
                </Text>

                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handleCreateTask}
                >
                  <Text style={styles.submitBtnText}>创建定时任务</Text>
                </TouchableOpacity>
              </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1677FF',
    paddingTop: 50,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  addBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  taskCard: {
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
  taskCardDisabled: {
    opacity: 0.5,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  taskStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  taskStatusText: {
    fontSize: 13,
    color: '#666',
  },
  taskActions: {
    flexDirection: 'row',
    gap: 8,
  },
  runBtn: {
    backgroundColor: '#1677FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  runBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  toggleBtnText: {
    fontSize: 12,
    color: '#666',
  },
  taskBody: {
    gap: 5,
  },
  taskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  taskLabel: {
    color: '#999',
    fontSize: 13,
  },
  taskValue: {
    color: '#333',
    fontSize: 13,
    fontWeight: '500',
  },
  taskResult: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  taskResultText: {
    fontSize: 12,
    color: '#888',
  },
  deleteTaskBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  deleteTaskText: {
    color: '#ff4d4f',
    fontSize: 13,
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
  emptyHint: {
    fontSize: 13,
    color: '#bbb',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 40,
  },
  createBtn: {
    backgroundColor: '#1677FF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  createBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
    maxHeight: '85%',
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
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e0e0e0',
  },
  stepDotActive: {
    backgroundColor: '#1677FF',
    width: 24,
  },
  selectItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  selectItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  selectItemSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  selectItemBadge: {
    fontSize: 12,
    color: '#52c41a',
    backgroundColor: '#f6ffed',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    marginTop: 12,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  dateBtn: {
    flex: 1,
    paddingVertical: 10,
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
  timeInput: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  formHint: {
    fontSize: 12,
    color: '#faad14',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  submitBtn: {
    backgroundColor: '#1677FF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
