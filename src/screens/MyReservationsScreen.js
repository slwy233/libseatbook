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
import { getCurrentMake, getLastMake, cancelBooking } from '../api/client';
import { isTokenExpiredError } from '../utils/authManager';

export default function MyReservationsScreen({ navigation }) {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelingId, setCancelingId] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      const [currentResp, historyResp] = await Promise.all([
        getCurrentMake(),
        getLastMake(),
      ]);

      if (currentResp.status && currentResp.data && currentResp.data.id) {
        setCurrent(currentResp.data);
      } else {
        setCurrent(null);
      }

      if (historyResp.status && historyResp.data) {
        setHistory(historyResp.data);
      }
    } catch (e) {
      if (isTokenExpiredError(e)) {
        return;
      }
      console.log('加载预约数据失败:', e.message);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleCancel = (bookingId) => {
    Alert.alert('取消预约', '确定要取消该预约吗？', [
      { text: '再想想', style: 'cancel' },
      {
        text: '确定取消',
        style: 'destructive',
        onPress: async () => {
          setCancelingId(bookingId);
          try {
            const resp = await cancelBooking(bookingId);
            if (resp.status) {
              Alert.alert('成功', '预约已取消');
              loadData();
            } else {
              Alert.alert('失败', resp.message || '取消失败');
            }
          } catch (e) {
      if (isTokenExpiredError(e)) {
        return;
      }
            Alert.alert('错误', e.message);
          } finally {
            setCancelingId(null);
          }
        },
      },
    ]);
  };

  const getStatusInfo = (status) => {
    switch (status) {
      case 'RESERVE':
        return { label: '已预约', color: '#1677FF', bg: '#e6f4ff' };
      case 'SIGNED':
        return { label: '履约中', color: '#52c41a', bg: '#f6ffed' };
      case 'CANCEL':
        return { label: '已取消', color: '#999', bg: '#f5f5f5' };
      case 'AWAY':
        return { label: '暂离', color: '#faad14', bg: '#fffbe6' };
      case 'COMPLETE':
        return { label: '已完成', color: '#52c41a', bg: '#f6ffed' };
      case 'STOP':
        return { label: '已结束', color: '#999', bg: '#f5f5f5' };
      default:
        return { label: status || '未知', color: '#999', bg: '#f5f5f5' };
    }
  };

  const renderBookingItem = ({ item }) => {
    const statusInfo = getStatusInfo(item.status);
    const isCanceling = cancelingId === item.id;

    return (
      <View style={[styles.card, item.status === 'CANCEL' && styles.cardCancelled]}>
        <View style={styles.cardHeader}>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
            <Text style={[styles.statusText, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
          </View>

          {(item.status === 'RESERVE') && (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => handleCancel(item.id)}
              disabled={isCanceling}
            >
              {isCanceling ? (
                <ActivityIndicator size="small" color="#ff4d4f" />
              ) : (
                <Text style={styles.cancelBtnText}>取消预约</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>座位号</Text>
            <Text style={styles.cardValue}>{item.seatLabel}号</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>位置</Text>
            <Text style={styles.cardValue}>
              {item.buildName || ''} {item.floorName || ''} {item.roomName || ''}
            </Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>日期</Text>
            <Text style={styles.cardValue}>{item.makeDateStr}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>时间</Text>
            <Text style={styles.cardValue}>
              {item.makeBeginStr} ~ {item.makeEndStr}
            </Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>时长</Text>
            <Text style={styles.cardValue}>
              {Math.round((item.makeEnd - item.makeBegin) / 60 * 10) / 10} 小时
            </Text>
          </View>
          {item.message ? (
            <Text style={styles.cardMessage}>💡 {item.message}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  const renderSectionHeader = (title, count) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count} 条记录</Text>
    </View>
  );

  const allData = [];
  if (current) allData.push({ type: 'current', data: current });
  allData.push(...history.map((h) => ({ type: 'history', data: h })));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的预约</Text>
      </View>

      <FlatList
        data={allData}
        keyExtractor={(item) => item.data.id}
        renderItem={({ item, index }) => (
          <>
            {index === 0 && renderSectionHeader('当前预约', current ? 1 : 0)}
            {index === (current ? 1 : 0) &&
              renderSectionHeader('历史记录', history.length)}
            {(() => {
              // 判断是否刚过了"当前预约"部分
              const isHistory = current
                ? index > 0
                : index >= 0;
              return null;
            })()}
            {renderBookingItem({ item: item.data })}
          </>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>暂无预约记录</Text>
            <TouchableOpacity
              style={styles.goBookBtn}
              onPress={() => navigation.navigate('Home')}
            >
              <Text style={styles.goBookBtnText}>去预约座位</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    backgroundColor: '#1677FF',
    paddingTop: 50,
    paddingBottom: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  sectionCount: {
    fontSize: 12,
    color: '#999',
  },
  card: {
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
  cardCancelled: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cancelBtnText: {
    color: '#ff4d4f',
    fontSize: 13,
    fontWeight: '600',
  },
  cardBody: {
    gap: 6,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardLabel: {
    color: '#999',
    fontSize: 13,
  },
  cardValue: {
    color: '#333',
    fontSize: 13,
    fontWeight: '500',
  },
  cardMessage: {
    fontSize: 12,
    color: '#888',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
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
    marginBottom: 16,
  },
  goBookBtn: {
    backgroundColor: '#1677FF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  goBookBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
