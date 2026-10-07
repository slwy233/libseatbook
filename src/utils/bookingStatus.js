export function getBookingStatus(status) {
  const states = {
    RESERVE: { label: '已预约', color: '#1677FF', bg: '#eaf2ff' },
    SIGNED: { label: '履约中', color: '#269967', bg: '#e8f7ef' },
    CANCEL: { label: '已取消', color: '#64748b', bg: '#f1f4f8' },
    AWAY: { label: '暂离', color: '#b7791f', bg: '#fff6df' },
    COMPLETE: { label: '已完成', color: '#269967', bg: '#e8f7ef' },
    STOP: { label: '已结束', color: '#64748b', bg: '#f1f4f8' },
  };
  return states[status] || { label: status || '未知状态', color: '#64748b', bg: '#f1f4f8' };
}
