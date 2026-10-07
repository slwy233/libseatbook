import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { cancelBooking } from '../api/client';
import { getSessionVersion, isSessionCurrent } from '../utils/storage';
export default function useBookingCancel(onSuccess) {
  const busy = useRef(false);
  const mounted = useRef(true);
  const [cancelingId, setCancelingId] = useState(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const cancel = id => {
    if (busy.current) return;
    const session = getSessionVersion();
    Alert.alert('取消预约', '确定取消这条预约吗？', [
      { text: '保留预约', style: 'cancel' },
      { text: '确定取消', style: 'destructive', onPress: async () => {
        if (busy.current || !mounted.current || !isSessionCurrent(session)) return;
        busy.current = true; setCancelingId(id);
        try {
          await cancelBooking(id);
          if (mounted.current && isSessionCurrent(session)) await onSuccess();
        } catch (e) {
          if (mounted.current && isSessionCurrent(session) && e.message !== 'TOKEN_EXPIRED') Alert.alert('取消失败', e.message);
        } finally {
          busy.current = false;
          if (mounted.current) setCancelingId(null);
        }
      } },
    ]);
  };
  return { cancel, cancelingId };
}

