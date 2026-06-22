import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentMake, cancelBooking } from '../api/client';
import { getUserInfo, removeToken, getToken } from '../utils/storage';

export default function HomeScreen({ navigation }) {
  const [userInfo, setUserInfo] = useState(null);
  const [currentBooking, setCurrentBooking] = useState(null);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const loadData = async () => {
    // 用户信息从登录时保存的AsyncStorage读取
    const info = await getUserInfo();
    if (info) setUserInfo(info);

    // 尝试加载当前预约 — HMAC已破解！
    try {
      const resp = await getCurrentMake();
      if (resp.status && resp.data && resp.data.id) {
        setCurrentBooking(resp.data);
      }
    } catch (e) {
      console.log('获取当前预约失败:', e.message);
    }
  };

  const handleLogout = () => {
    Alert.alert('退出登录', '确定要退出吗？', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => {
        await removeToken();
        navigation.replace('Login');
      }},
    ]);
  };

  const Stat = ({ label, value }) => (
    <View style={styles.statItem}>
      <Text style={styles.statNum}>{value ?? '--'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* 用户信息栏 */}
      <View style={styles.userBar}>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{userInfo?.fullName || '同学'}</Text>
          <Text style={styles.userDept}>{userInfo?.collegeDepName || ''} · {userInfo?.username || ''}</Text>
        </View>
        <View style={styles.userStats}>
          <Stat label="积分" value={userInfo?.scoreNum} />
          <Stat label="违约" value={userInfo?.breachNum} />
          <Stat label="预约" value={userInfo?.totalMake} />
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>退出</Text>
        </TouchableOpacity>
      </View>

      {/* 当前预约 */}
      <View style={styles.body}>
        {currentBooking ? (
          <View style={styles.bookingCard}>
            <Text style={styles.bookingStatus}>🔵 已预约</Text>
            <Text style={styles.bookingDetail}>
              {currentBooking.seatLabel}号 · {currentBooking.buildName}{' '}
              {currentBooking.floorName} {currentBooking.roomName}
            </Text>
            <Text style={styles.bookingTime}>
              📅 {currentBooking.makeDateStr} ⏰ {currentBooking.makeBeginStr}-{currentBooking.makeEndStr}
            </Text>
          </View>
        ) : (
          <View style={styles.noBooking}>
            <Text style={styles.noBookingIcon}>🪑</Text>
            <Text style={styles.noBookingText}>当前没有预约</Text>
          </View>
        )}

        {/* 快捷入口 */}
        <Text style={styles.sectionTitle}>快捷操作</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Book')}>
          <Text style={styles.actionIcon}>🪑</Text>
          <View style={styles.actionInfo}>
            <Text style={styles.actionTitle}>预约选座</Text>
            <Text style={styles.actionDesc}>查看空闲座位并预约</Text>
          </View>
          <Text style={styles.actionArrow}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('My')}>
          <Text style={styles.actionIcon}>📋</Text>
          <View style={styles.actionInfo}>
            <Text style={styles.actionTitle}>我的预约</Text>
            <Text style={styles.actionDesc}>查看预约记录和签到信息</Text>
          </View>
          <Text style={styles.actionArrow}>›</Text>
        </TouchableOpacity>

        <Text style={styles.tip}>💡 预约选座和我的预约使用学校官方页面</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  userBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1677FF',
    paddingHorizontal: 16, paddingTop: 50, paddingBottom: 14,
  },
  userInfo: { flex: 1 },
  userName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  userDept: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  userStats: { flexDirection: 'row', marginRight: 12, gap: 12 },
  statItem: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8 },
  logoutText: { color: '#fff', fontSize: 12 },

  body: { flex: 1, padding: 16 },

  bookingCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#1677FF' },
  bookingStatus: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 8 },
  bookingDetail: { fontSize: 14, color: '#333', marginBottom: 4 },
  bookingTime: { fontSize: 13, color: '#888' },

  noBooking: { backgroundColor: '#fff', borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 16 },
  noBookingIcon: { fontSize: 40, marginBottom: 6 },
  noBookingText: { fontSize: 15, color: '#999' },

  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 16, marginBottom: 10,
  },
  actionIcon: { fontSize: 28, marginRight: 14 },
  actionInfo: { flex: 1 },
  actionTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  actionDesc: { fontSize: 13, color: '#888', marginTop: 2 },
  actionArrow: { fontSize: 24, color: '#ccc' },
  tip: { fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 20 },
});
