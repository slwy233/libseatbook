const test = require('node:test');
const assert = require('node:assert/strict');
const { uiHarness, deferred, text, button, input } = require('./helpers/uiHarness.cjs');

const seatRoute = { params: { roomId: 'room-a', roomName: '自习室A', buildingName: '图书馆A', floorName: '一层', date: '2026-10-08' } };

async function fillLogin(h, username = 'student', password = 'password') {
  await h.act(() => {
    input(h.root, '学号').props.onChangeText(username);
    input(h.root, '密码').props.onChangeText(password);
  });
}

test('Login automatic success persists token with incremented session then resets Main', async t => {
  const loginCalls = [];
  const h = uiHarness({ api: { login: async (...args) => { loginCalls.push(args); return { token: 'login-token', userInfo: { name: '同学' } }; } } });
  t.after(() => h.unmount());
  await h.mount('LoginScreen');
  await fillLogin(h);
  const before = h.storage.getSessionVersion();
  await h.act(() => input(h.root, '密码').props.onSubmitEditing());
  assert.equal(loginCalls.length, 1);
  assert.equal(loginCalls[0][4].persistToken, false);
  assert.equal(await h.storage.getToken(), 'login-token');
  assert.equal(h.storage.getSessionVersion(), before + 1);
  assert.equal(h.resets.length, 1);
  assert.equal(h.resets[0].routes[0].name, 'Main');
});

test('Login manual submission without CAPTCHA does not call login', async t => {
  let loginCalls = 0;
  const pendingCaptcha = deferred();
  const h = uiHarness({ api: {
    getCaptcha: () => pendingCaptcha.promise,
    login: async () => { loginCalls++; return { token: 'token' }; },
  } });
  t.after(() => h.unmount());
  await h.mount('LoginScreen', { route: { params: { forceReLogin: true } } });
  await fillLogin(h);
  await h.act(() => input(h.root, '密码').props.onSubmitEditing());
  assert.equal(loginCalls, 0);
  assert.equal(h.resets.length, 0);
  assert.ok(h.root.findAllByType('Text').some(node => text(node).includes('请获取验证码并输入')));
  pendingCaptcha.resolve({ captchaId: 'id', captchaImage: 'image' });
  await h.act();
});

test('Login ignores late CAPTCHA response after username changes', async t => {
  const first = deferred(), second = deferred();
  const accounts = [];
  const h = uiHarness({ api: { getCaptcha: account => { accounts.push(account); return account === '111' ? first.promise : second.promise; } } });
  t.after(() => h.unmount());
  await h.mount('LoginScreen', { route: { params: { forceReLogin: true } } });
  await h.act(() => input(h.root, '学号').props.onChangeText('111'));
  await h.act(() => input(h.root, '学号').props.onChangeText('222'));
  await h.act(() => second.resolve({ captchaId: 'second', captchaImage: 'second-image' }));
  await h.act(() => first.resolve({ captchaId: 'first', captchaImage: 'first-image' }));
  assert.deepEqual(accounts, ['111', '222']);
  assert.equal(h.root.findByType('Image').props.source.uri, 'data:image/png;base64,second-image');
});

test('SeatMap discards late start times from previously closed seat dialog', async t => {
  const first = deferred(), second = deferred();
  const h = uiHarness({ api: { getStartTimes: id => id === 'seat-a' ? first.promise : second.promise } });
  t.after(() => h.unmount());
  await h.mount('SeatMapScreen', { route: seatRoute });
  await h.act(() => { h.root.findByProps({ accessibilityLabel: '1号座位，空闲' }).props.onPress(); });
  await h.act(() => button(h.root, '关闭').props.onPress());
  await h.act(() => { h.root.findByProps({ accessibilityLabel: '2号座位，空闲' }).props.onPress(); });
  await h.act(() => second.resolve({ status: true, data: [['540', '09:00']] }));
  await h.act(() => first.resolve({ status: true, data: [['480', '08:00']] }));
  const times = h.root.findAllByType('TouchableOpacity').map(text);
  assert.ok(times.includes('09:00'));
  assert.ok(!times.includes('08:00'));
  assert.ok(text(h.root).includes('2 号座位'));
});

test('SeatMap ignores late end times after another start time is selected', async t => {
  const first = deferred(), second = deferred();
  const h = uiHarness({ api: {
    getStartTimes: async () => ({ status: true, data: [['480', '08:00'], ['540', '09:00']] }),
    getEndTimes: (_, __, start) => start === 480 ? first.promise : second.promise,
  } });
  t.after(() => h.unmount());
  await h.mount('SeatMapScreen', { route: seatRoute });
  await h.act(() => h.root.findByProps({ accessibilityLabel: '1号座位，空闲' }).props.onPress());
  await h.act(() => { button(h.root, '08:00').props.onPress(); });
  await h.act(() => { button(h.root, '09:00').props.onPress(); });
  await h.act(() => second.resolve({ status: true, data: [['660', '11:00']] }));
  await h.act(() => first.resolve({ status: true, data: [['600', '10:00']] }));
  const times = h.root.findAllByType('TouchableOpacity').map(text);
  assert.ok(times.includes('11:00'));
  assert.ok(!times.includes('10:00'));
});

test('SeatMap same booking callback invoked twice submits only one booking', async t => {
  const pending = deferred();
  const calls = [];
  const h = uiHarness({ api: { bookSeat: (...args) => { calls.push(args); return pending.promise; } } });
  t.after(() => h.unmount());
  await h.mount('SeatMapScreen', { route: seatRoute });
  await h.act(() => h.root.findByProps({ accessibilityLabel: '1号座位，空闲' }).props.onPress());
  await h.act(() => button(h.root, '08:00').props.onPress());
  await h.act(() => button(h.root, '10:00').props.onPress());
  const callback = button(h.root, '确认预约').props.onPress;
  await h.act(() => { callback(); callback(); });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['seat-a', '2026-10-08', 480, 600]);
  await h.act(() => pending.resolve({ status: true }));
  assert.equal(h.alerts.filter(args => args[0] === '预约成功').length, 1);
});

test('RoomList date change isolates out-of-order list and navigation date', async t => {
  const first = deferred(), second = deferred();
  const calls = [];
  const h = uiHarness({ api: { findRoomDuration: (id, date, options) => { calls.push({ id, date, options }); return calls.length === 1 ? first.promise : second.promise; } } });
  t.after(() => h.unmount());
  await h.mount('RoomListScreen', { route: { params: { buildingId: 'building-a', buildingName: '图书馆A', floors: [] } } });
  await h.act(() => button(h.root, '明天').props.onPress());
  await h.act(() => second.resolve({ status: true, data: { pageList: [{ id: 'new-room', name: '明日房间' }], totalCount: 1 } }));
  await h.act(() => first.resolve({ status: true, data: { pageList: [{ id: 'old-room', name: '旧日房间' }], totalCount: 1 } }));
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].date, calls[1].date);
  assert.equal(h.root.findByType('FlatList').props.data[0].id, 'new-room');
  await h.act(() => button(h.root, '明日房间').props.onPress());
  assert.equal(h.navigations[0][1].date, calls[1].date);
});

test('Schedule invalid time blocks create at the rendered form', async t => {
  let creates = 0;
  const h = uiHarness({ schedule: { createSchedule: async () => { creates++; return { status: true }; } } });
  t.after(() => h.unmount());
  await h.mount('ScheduleScreen');
  await h.act(() => button(h.root, '+ 新建').props.onPress());
  await h.act(() => button(h.root, '图书馆A').props.onPress());
  await h.act(() => button(h.root, '自习室A').props.onPress());
  await h.act(() => input(h.root, '开始时间').props.onChangeText('22:00'));
  await h.act(() => button(h.root, '创建定时任务').props.onPress());
  assert.equal(creates, 0);
  assert.ok(h.root.findAllByType('Text').some(node => text(node).includes('结束时间必须晚于开始时间')));
});
