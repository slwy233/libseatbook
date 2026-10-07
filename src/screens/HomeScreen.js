import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentMake, getUserInfo as fetchUserInfo } from '../api/client';
import { getUserInfo, saveUserInfo, getSessionVersion, isSessionCurrent } from '../utils/storage';
import { forceLogout } from '../utils/authManager';
import { getSchedules } from '../api/scheduleApi';
import { todayDateStr } from '../utils/time';
import ScreenHeader from '../components/ScreenHeader';
import StateView from '../components/StateView';
import BookingCard from '../components/BookingCard';
import useBookingCancel from '../hooks/useBookingCancel';
import { colors } from '../theme';
export default function HomeScreen({ navigation }) {
  const [userInfo, setUserInfo] = useState(null);
  const [currentBooking, setCurrentBooking] = useState(null);
  const [scheduleSummary, setScheduleSummary] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);
  const loadData = useCallback(async (refresh = false) => {
    const id = ++request.current;
    const session = getSessionVersion();
    const active = () => request.current === id && isSessionCurrent(session);
    if (refresh) setRefreshing(true); else setLoading(true);
    const cached = await getUserInfo().catch(() => null);
    if (cached && active()) setUserInfo(cached);
    const [user, booking, schedules] = await Promise.allSettled([fetchUserInfo(), getCurrentMake(), getSchedules()]);
    if (!active()) return;
    const nextErrors = {};
    if (user.status === 'fulfilled') {
      setUserInfo(user.value.data);
      await saveUserInfo(user.value.data, session).catch(() => {});
    } else nextErrors.user = user.reason.message;
    if (!active()) return;
    if (booking.status === 'fulfilled') setCurrentBooking(booking.value.data?.id ? booking.value.data : null);
    else nextErrors.booking = booking.reason.message;
    if (schedules.status === 'fulfilled') {
      const today = todayDateStr();
      setScheduleSummary((Array.isArray(schedules.value.data) ? schedules.value.data : [])
        .filter(task => task.results?.[today])
        .slice(-3).map(task => ({ id: task.id, result: String(task.results[today]), room: task.roomName })));
    } else nextErrors.schedules = schedules.reason.message;
    setErrors(nextErrors); setLoading(false); setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { loadData(); return () => { request.current++; }; }, [loadData]));
  const { cancel, cancelingId } = useBookingCancel(() => loadData(true));
  const logout = () => Alert.alert('退出登录', '退出后将清除本机保存的账号和密码。服务器上的定时任务仍会继续执行，可先在“定时”中暂停。', [
    { text: '取消', style: 'cancel' },
    { text: '退出', style: 'destructive', onPress: async () => {
      try { await forceLogout(false, { notify: false, forgetCredentials: true }); }
      catch (e) { Alert.alert('退出失败', e.message); }
    } },
  ]);
  return (
    <View style={styles.container}>
      <ScreenHeader title={(userInfo?.fullName || '同学') + '，你好'} subtitle="天商书座 · 安排你的学习时间" action={<TouchableOpacity style={styles.logout} onPress={logout}><Text style={{ color: '#fff' }}>退出</Text></TouchableOpacity>} />
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}>
        <View style={styles.stats}>{[['积分', userInfo?.scoreNum], ['违约次数', userInfo?.breachNum], ['累计预约', userInfo?.totalMake]].map(([label, value]) => <View key={label} style={styles.stat}><Text style={styles.statValue}>{value ?? '—'}</Text><Text style={styles.statLabel}>{label}</Text></View>)}</View>
        {errors.user && <Text style={styles.note}>个人信息未能更新，当前显示上次缓存。</Text>}
        <View style={styles.section}><Text style={styles.sectionTitle}>当前预约</Text><TouchableOpacity onPress={() => navigation.navigate('My')}><Text style={styles.link}>全部记录 ›</Text></TouchableOpacity></View>
        {loading ? <StateView loading /> : errors.booking ? <StateView error={errors.booking} onRetry={() => loadData(true)} /> : currentBooking ? <BookingCard booking={currentBooking} onCancel={cancel} canceling={cancelingId !== null} /> : <View style={styles.empty}><Text style={styles.emptyTitle}>还没有当前预约</Text><Text style={styles.note}>找一处空闲座位，开始今天的学习。</Text><TouchableOpacity style={styles.primary} onPress={() => navigation.navigate('Book')}><Text style={styles.primaryText}>去选座</Text></TouchableOpacity></View>}
        <Text style={styles.sectionTitle}>学习安排</Text>
        <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Schedule')}><View style={styles.actionIcon}><Text style={{ fontSize: 26, color: colors.primary }}>◷</Text></View><View style={{ flex: 1 }}><Text style={styles.actionTitle}>定时预约</Text><Text style={styles.note}>按日期和时段设置服务器任务</Text></View><Text style={styles.arrow}>›</Text></TouchableOpacity>
        {errors.schedules ? <Text style={styles.note}>定时服务暂不可用，可在“定时”页面重新加载。</Text> : scheduleSummary.map(item => <View key={item.id} style={styles.result}><Text style={styles.resultRoom}>{item.room || '今日任务'}</Text><Text style={styles.resultText}>{item.result}</Text></View>)}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, body: { padding: 20, paddingBottom: 32 },
  logout: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)' },
  stats: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 18, paddingVertical: 20, marginBottom: 20 },
  stat: { flex: 1, alignItems: 'center' }, statValue: { fontSize: 25, fontWeight: '700', color: colors.text }, statLabel: { fontSize: 12, color: colors.muted, marginTop: 6 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }, sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginVertical: 8 }, link: { color: colors.primary, fontSize: 13, paddingVertical: 10 },
  note: { fontSize: 13, lineHeight: 20, color: colors.muted, marginTop: 6 },
  empty: { padding: 22, backgroundColor: '#fff', borderRadius: 18, marginBottom: 20, borderWidth: 1, borderColor: colors.border }, emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  primary: { backgroundColor: colors.primary, alignItems: 'center', borderRadius: 12, paddingVertical: 13, marginTop: 16 }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  action: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginTop: 10, flexDirection: 'row', gap: 14, alignItems: 'center' }, actionIcon: { backgroundColor: '#eaf2ff', width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, actionTitle: { fontSize: 16, fontWeight: '600', color: colors.text }, arrow: { fontSize: 24, color: colors.muted },
  result: { marginTop: 10, backgroundColor: '#fff', padding: 14, borderRadius: 12 }, resultRoom: { color: colors.muted, fontSize: 12 }, resultText: { color: colors.text, fontSize: 13, marginTop: 6, lineHeight: 20 },
});

