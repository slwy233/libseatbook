import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { getBookingStatus } from '../utils/bookingStatus';
import { colors } from '../theme';

export default function BookingCard({ booking, onCancel, canceling }) {
  const status = getBookingStatus(booking.status);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: status.bg }]}><Text style={{ color: status.color, fontWeight: '600' }}>{status.label}</Text></View>
        {booking.status === 'RESERVE' && onCancel && <TouchableOpacity disabled={canceling} onPress={() => onCancel(booking.id)} style={styles.cancel}>
          {canceling ? <ActivityIndicator color={colors.danger} /> : <Text style={{ color: colors.danger }}>取消预约</Text>}
        </TouchableOpacity>}
      </View>
      <Text style={styles.seat}>{booking.seatLabel || '—'}<Text style={styles.unit}> 号座位</Text></Text>
      <Text style={styles.location}>{[booking.buildName, booking.floorName, booking.roomName].filter(Boolean).join(' · ')}</Text>
      <View style={styles.time}><Text style={styles.date}>{booking.makeDateStr}</Text><Text style={styles.period}>{booking.makeBeginStr} – {booking.makeEndStr}</Text></View>
      {booking.message ? <Text style={styles.message}>{booking.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  cancel: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  seat: { fontSize: 30, fontWeight: '700', color: colors.text, marginTop: 10 },
  unit: { fontSize: 14, fontWeight: '400', color: colors.muted },
  location: { fontSize: 14, color: colors.muted, marginTop: 6, lineHeight: 21 },
  time: { borderTopWidth: 1, borderColor: colors.border, marginTop: 16, paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  date: { fontSize: 13, color: colors.muted },
  period: { fontSize: 14, color: colors.text, fontWeight: '600' },
  message: { marginTop: 12, fontSize: 13, lineHeight: 20, color: colors.muted },
});
