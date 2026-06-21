import React, { useState, useCallback } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { getCurrentMake, getBuildingFloorDate, cancelBooking } from '../api/client';
import { getUserInfo } from '../utils/storage';
import { minutesToTimeStr, todayDateStr } from '../utils/time';

export default function HomeScreen({ navigation }) {
  const [userInfo, setUserInfo] = useState(null);
  const [currentBooking, setCurrentBooking] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      const [info, makeResp, buildingResp] = await Promise.all([
        getUserInfo(),
        getCurrentMake(),
        getBuildingFloorDate(),
      ]);

      setUserInfo(info);

      if (makeResp.status && makeResp.data && makeResp.data.id) {
        setCurrentBooking(makeResp.data);
      } else {
        setCurrentBooking(null);
      }

      if (buildingResp.status && buildingResp.data) {
        setBuildings(buildingResp.data.buildings || []);
      }
    } catch (e) {
      if (e.message === 'TOKEN_EXPIRED') {
        Alert.alert('登录过期', '请重新登录', [
          { text: '确定', onPress: () => navigation.replace('Login') },
        ]);
        return;
      }
      console.log('加载数据失败:', e.message);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCancel = (bookingId) => {
    Alert.alert('取消预约', '确定要取消当前预约吗？', [
      { text: '再想想', style: 'cancel' },
      {
        text: '确定取消',
        style: 'destructive',
        onPress: async () => {
          setCanceling(true);
          try {
            const resp = await cancelBooking(bookingId);
            if (resp.status) {
              Alert.alert('成功', '已取消预约');
              setCurrentBooking(null);
              loadData();
            } else {
              Alert.alert('失败', resp.message || '取消失败');
            }
          } catch (e) {
            Alert.alert('错误', e.message);
          } finally {
            setCanceling(false);
          }
        },
      },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('退出登录', '确定要退出吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => navigation.replace('Login'),
      },
    ]);
  };

  const renderBookingCard = () => {
    if (!currentBooking) {
      return (
        <View style={styles.noBookingCard}>
          <Text style={styles.noBookingIcon}>🪑</Text>
          <Text style={styles.noBookingText}>当前没有预约</Text>
          <Text style={styles.noBookingHint}>快去选座吧</Text>
        </View>
      );
    }

    const b = currentBooking;
    const isReserve = b.status === 'RESERVE';
    const isSigned = b.status === 'SIGNED';

    return (
      <View style={[styles.bookingCard, isReserve && styles.bookingCardActive]}>
        <View style={styles.bookingHeader}>
          <Text style={styles.bookingStatus}>
            {isReserve ? '🔵 已预约' : isSigned ? '🟢 履约中' : '⚪ ' + b.status}
          </Text>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => handleCancel(b.id)}
            disabled={canceling}
          >
            {canceling ? (
              <ActivityIndicator size="small" color="#ff4d4f" />
            ) : (
              <Text style={styles.cancelBtnText}>取消</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.bookingBody}>
          <View style={styles.bookingRow}>
            <Text style={styles.bookingLabel}>座位号</Text>
            <Text style={styles.bookingValue}>{b.seatLabel}号</Text>
          </View>
          <View style={styles.bookingRow}>
            <Text style={styles.bookingLabel}>位置</Text>
            <Text style={styles.bookingValue}>
              {b.buildName || '图书馆'} {b.floorName || ''} {b.roomName || ''}
            </Text>
          </View>
          <View style={styles.bookingRow}>
            <Text style={styles.bookingLabel}>日期</Text>
            <Text style={styles.bookingValue}>{b.makeDateStr}</Text>
          </View>
          <View style={styles.bookingRow}>
            <Text style={styles.bookingLabel}>时间</Text>
            <Text style={styles.bookingValue}>
              {b.makeBeginStr} - {b.makeEndStr}
            </Text>
          </View>
          <View style={styles.bookingRow}>
            <Text style={styles.bookingLabel}>时长</Text>
            <Text style={styles.bookingValue}>
              {Math.round((b.makeEnd - b.makeBegin) / 60 * 10) / 10} 小时
            </Text>
          </View>
          {b.message ? (
            <View style={styles.bookingMessage}>
              <Text style={styles.bookingMessageText}>💡 {b.message}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const renderBuildingItem = ({ item }) => (
    <TouchableOpacity
      style={styles.buildingItem}
      onPress={() =>
        navigation.navigate('RoomList', {
          buildingId: item.id,
          buildingName: item.name || '图书馆',
          buildingNameE: item.nameE || 'library',
          floors: item.floors || [],
        })
      }
    >
      <View style={styles.buildingIcon}>
        <Text style={styles.buildingIconText}>🏛️</Text>
      </View>
      <View style={styles.buildingInfo}>
        <Text style={styles.buildingName}>{item.name || '图书馆'}</Text>
        <Text style={styles.buildingTime}>
          ⏰ {item.seTime || '08:00 - 21:50'}
        </Text>
        <Text style={styles.buildingFloors}>
          📍 {item.floors?.length || 0} 层可用
        </Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 用户信息栏 */}
      <View style={styles.userBar}>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{userInfo?.fullName || '同学'}</Text>
          <Text style={styles.userDept}>
            {userInfo?.collegeDepName || ''} · {userInfo?.username || ''}
          </Text>
        </View>
        <View style={styles.userStats}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{userInfo?.scorePoint ?? userInfo?.scoreNum ?? 300}</Text>
            <Text style={styles.statLabel}>积分</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{userInfo?.breachNum ?? 0}</Text>
            <Text style={styles.statLabel}>违约</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>退出</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={buildings}
        keyExtractor={(item) => item.id}
        renderItem={renderBuildingItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <>
            {renderBookingCard()}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>选择楼栋</Text>
            </View>
          </>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  userBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1677FF',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  userDept: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  userStats: {
    flexDirection: 'row',
    marginRight: 12,
    gap: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statNum: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
  },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  logoutText: {
    color: '#fff',
    fontSize: 12,
  },
  listContent: {
    padding: 16,
  },
  // 预约卡片
  noBookingCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  noBookingIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  noBookingText: {
    fontSize: 16,
    color: '#666',
  },
  noBookingHint: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  bookingCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  bookingCardActive: {
    borderLeftColor: '#1677FF',
  },
  bookingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bookingStatus: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  cancelBtnText: {
    color: '#ff4d4f',
    fontSize: 14,
    fontWeight: '600',
  },
  bookingBody: {
    gap: 6,
  },
  bookingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bookingLabel: {
    color: '#999',
    fontSize: 13,
  },
  bookingValue: {
    color: '#333',
    fontSize: 13,
    fontWeight: '500',
  },
  bookingMessage: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  bookingMessageText: {
    color: '#888',
    fontSize: 12,
  },
  // 楼栋列表
  sectionHeader: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  buildingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  buildingIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f0f5ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  buildingIconText: {
    fontSize: 22,
  },
  buildingInfo: {
    flex: 1,
  },
  buildingName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  buildingTime: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  buildingFloors: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
  },
  arrow: {
    fontSize: 24,
    color: '#ccc',
  },
});
