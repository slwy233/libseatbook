const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, deferred, response } = require('./helpers/apiHarness.cjs');

async function loggedHarness() {
  const h = createHarness();
  h.storage = h.load('src/utils/storage.js');
  await h.storage.saveToken('old-token');
  await h.storage.saveCredentials('student', 'password');
  h.auth = h.load('src/utils/authManager.js');
  h.client = h.load('src/api/client.js');
  h.navigation = [];
  h.auth.setGlobalNavRef({ current: { resetRoot: state => h.navigation.push(state) } });
  return h;
}
function defaultService(url) {
  if (url.includes('getSysSet')) return response({ status: true, data: { hmac: 0 } });
  if (url.includes(':8910')) return response({ text: 'abcd' });
  if (url.includes('/auth/user')) return response({ status: true, data: { token: 'fresh-token' } });
  return response({ status: true, data: {} });
}

for (const code of [20003, '20003']) {
  test(`expiry ${JSON.stringify(code)} refreshes and preserves unrelated retry business error`, async () => {
    const h = await loggedHarness();
    h.environment.fetch = async (url, options) => {
      if (url.includes('currentUseMake')) return response(options.headers.token === 'old-token'
        ? { status: false, code } : { status: false, code: 40001, message: '当前无可预约座位' });
      return defaultService(url);
    };
    await assert.rejects(h.client.getCurrentMake(), e => e.code === 40001 && e.message === '当前无可预约座位');
    assert.equal(await h.storage.getToken(), 'fresh-token');
    assert.equal(h.navigation.length, 0);
  });
}

test('concurrent expiration shares one relogin and configuration request', async () => {
  const h = await loggedHarness();
  let authCalls = 0, configCalls = 0;
  h.environment.fetch = async (url, options) => {
    if (url.includes('getSysSet')) configCalls++;
    if (url.includes('/auth/user')) authCalls++;
    if (url.includes('currentUseMake')) return response(options.headers.token === 'old-token'
      ? { status: false, code: 20003 } : { status: true, data: { id: 'booking' } });
    return defaultService(url);
  };
  const results = await Promise.all([h.client.getCurrentMake(), h.client.getCurrentMake(), h.client.getCurrentMake()]);
  assert.equal(results.length, 3);
  assert.equal(authCalls, 1);
  assert.equal(configCalls, 1);
});

test('late expiry response from old token reuses fresh token without another relogin', async () => {
  const h = await loggedHarness();
  const late = deferred();
  let oldCalls = 0, authCalls = 0;
  h.environment.fetch = async (url, options) => {
    if (url.includes('/auth/user')) authCalls++;
    if (url.includes('currentUseMake')) {
      if (options.headers.token === 'old-token') {
        if (++oldCalls === 2) return late.promise;
        return response({ status: false, code: '20003' });
      }
      return response({ status: true });
    }
    return defaultService(url);
  };
  const first = h.client.getCurrentMake();
  const second = h.client.getCurrentMake();
  await first;
  late.resolve(response({ status: false, code: 20003 }));
  await second;
  assert.equal(authCalls, 1);
});

test('retry expiry clears session, retains credentials and navigates through root ref', async () => {
  const h = await loggedHarness();
  h.environment.fetch = async url => url.includes('currentUseMake')
    ? response({ status: false, code: 20003 }) : defaultService(url);
  await assert.rejects(h.client.getCurrentMake(), e => e.code === 'TOKEN_EXPIRED');
  assert.equal(await h.storage.getToken(), null);
  assert.equal((await h.storage.getCredentials()).username, 'student');
  assert.equal(h.navigation[0].routes[0].name, 'Login');
});

test('failed auto recovery clears and navigates; unsubscribe and notify=false are honored', async () => {
  const h = await loggedHarness();
  let notifications = 0;
  const unsubscribe = h.auth.onTokenExpired(() => notifications++);
  unsubscribe();
  h.environment.fetch = async url => {
    if (url.includes('currentUseMake')) return response({ status: false, code: 20003 });
    if (url.includes(':8910')) throw new Error('Network request failed');
    return defaultService(url);
  };
  await assert.rejects(h.client.getCurrentMake(), e => e.code === 'TOKEN_EXPIRED');
  assert.equal(await h.storage.getToken(), null);
  assert.equal(h.navigation.length, 1);
  assert.equal(notifications, 0);
  await h.storage.saveToken('new-token');
  h.auth.onTokenExpired(() => notifications++);
  await h.auth.forceLogout(false, { notify: false, forgetCredentials: true });
  assert.equal(notifications, 0);
  assert.equal((await h.storage.getCredentials()).username, null);
});

test('logout during pending relogin prevents late token writeback', async () => {
  const h = await loggedHarness();
  const loginStarted = deferred(), loginResult = deferred();
  h.environment.fetch = async (url) => {
    if (url.includes('/auth/user')) { loginStarted.resolve(); return loginResult.promise; }
    if (url.includes('currentUseMake')) return response({ status: false, code: 20003 });
    return defaultService(url);
  };
  const pending = h.client.getCurrentMake();
  const rejected = assert.rejects(pending, e => e.code === 'SESSION_CHANGED');
  await loginStarted.promise;
  await h.auth.forceLogout(false, { notify: false, forgetCredentials: true });
  loginResult.resolve(response({ status: true, data: { token: 'late-token' } }));
  await rejected;
  assert.equal(await h.storage.getToken(), null);
});

test('old session response cannot clear or reset newly signed-in user', async () => {
  const h = await loggedHarness();
  const started = deferred(), delayed = deferred();
  h.environment.fetch = async url => {
    if (url.includes('currentUseMake')) { started.resolve(); return delayed.promise; }
    return defaultService(url);
  };
  const pending = h.client.getCurrentMake();
  const rejected = assert.rejects(pending, e => e.code === 'SESSION_CHANGED');
  await started.promise;
  await h.storage.saveToken('different-user-token');
  delayed.resolve(response({ status: false, code: 20003 }));
  await rejected;
  assert.equal(await h.storage.getToken(), 'different-user-token');
  assert.equal(h.navigation.length, 0);
});

test('login never persists a missing token response', async () => {
  const h = await loggedHarness();
  h.environment.fetch = async url => url.includes('/auth/user')
    ? response({ status: true, data: {} }) : defaultService(url);
  await assert.rejects(h.client.login('student', 'password', '', ''), e => e.code === 'INVALID_RESPONSE');
  assert.equal(await h.storage.getToken(), 'old-token');
});

test('HTTP, malformed JSON, network and timeout errors stay distinct; booking is not retried', async () => {
  const h = await loggedHarness();
  const http = h.load('src/api/http.js');
  h.environment.fetch = async () => response({ message: '维护中' }, 503);
  await assert.rejects(http.requestJSON('mock'), e => e.code === 'HTTP_ERROR' && e.httpStatus === 503);
  h.environment.fetch = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError(); } });
  await assert.rejects(http.requestJSON('mock'), e => e.code === 'INVALID_JSON');
  h.environment.fetch = async () => { throw new Error('network'); };
  await assert.rejects(http.requestJSON('mock'), e => e.code === 'NETWORK_ERROR');
  h.environment.fetch = async () => new Promise(() => {});
  await assert.rejects(http.requestJSON('mock', {}, 10), e => e.code === 'TIMEOUT');
  let bookingCalls = 0;
  h.environment.fetch = async url => {
    if (url.includes('freeBook')) { bookingCalls++; throw new Error('network'); }
    return defaultService(url);
  };
  await assert.rejects(h.client.bookSeat('1', '2026-10-08', 480, 600), e => e.code === 'NETWORK_ERROR');
  assert.equal(bookingCalls, 1);
});

test('schedule validates missing credentials, business errors, list shape and inputs', async () => {
  const h = createHarness();
  const schedule = h.load('src/api/scheduleApi.js');
  const storage = h.load('src/utils/storage.js');
  const fields = { roomId: '1', dateFrom: '2026-10-08', dateTo: '2026-10-09', startMinute: 480, endMinute: 600 };
  await assert.rejects(schedule.createSchedule(fields), e => e.code === 'MISSING_CREDENTIALS');
  await storage.saveCredentials('student', 'password');
  await assert.rejects(schedule.createSchedule({ ...fields, endMinute: 1 }), e => e.code === 'INVALID_INPUT');
  await assert.rejects(schedule.createSchedule({ ...fields, dateFrom: '2026-02-30' }), e => e.code === 'INVALID_INPUT');
  h.environment.fetch = async () => response({ status: false, message: '任务不存在' });
  await assert.rejects(schedule.deleteSchedule('1'), e => e.message === '任务不存在');
  h.environment.fetch = async () => response({ status: true, data: {} });
  await assert.rejects(schedule.getSchedules(), e => e.code === 'INVALID_RESPONSE');
  let payload;
  h.environment.fetch = async (_, options) => { payload = JSON.parse(options.body); return response({ status: true }); };
  await schedule.createSchedule({ ...fields, preferredSeats: ' 1, , 1,2 ' });
  assert.deepEqual(payload.preferredSeats, ['1', '2']);
  assert.equal(payload.encryptedUsername, 'encrypted:student');
});

test('OCR stops immediately after network failure and respects overall deadline', async () => {
  const h = createHarness();
  const ocr = h.load('src/utils/ocr.js');
  let captchaCalls = 0;
  h.environment.fetch = async () => { throw new Error('network'); };
  const result = await ocr.autoLoginWithCaptcha(async () => { captchaCalls++; return { captchaImage: 'image' }; }, async () => ({}), 8);
  assert.equal(result.needManual, true);
  assert.equal(captchaCalls, 1);
  const timed = await ocr.autoLoginWithCaptcha(() => new Promise(() => {}), () => ({}), 8, null, { deadlineMs: 10 });
  assert.equal(timed.needManual, true);
  assert.match(timed.message, /超时/);
});

test('corrupt storage and missing userInfo safely fall back, refresh keeps session generation', async () => {
  const h = createHarness();
  const storage = h.load('src/utils/storage.js');
  h.memory.set('@seat_system_info', '{broken');
  h.memory.set('@seat_user_info', '{broken');
  h.memory.set('@seat_scheduled', '{broken');
  assert.equal(await storage.getSystemInfo(), null);
  assert.equal(await storage.getUserInfo(), null);
  assert.equal((await storage.getScheduledBookings()).length, 0);
  await storage.saveUserInfo(undefined);
  await storage.saveToken('token');
  const version = storage.getSessionVersion();
  await storage.saveToken('refresh', { refresh: true, expectedVersion: version });
  assert.equal(storage.getSessionVersion(), version);
  await storage.clearSession();
  assert.equal(await storage.saveToken('stale', { refresh: true, expectedVersion: version }), false);
  assert.equal(await storage.getToken(), null);
});

test('logout serializes removal after in-flight credential writes and rejects stale saves', async () => {
  const h = await loggedHarness();
  const started = deferred(), complete = deferred();
  const originalSet = h.asyncStorage.setItem;
  h.asyncStorage.setItem = async (key, value) => {
    if (key === '@seat_username') { started.resolve(); await complete.promise; }
    return originalSet(key, value);
  };
  const version = h.storage.getSessionVersion();
  const saving = h.storage.saveCredentials('late-student', 'late-password', version);
  await started.promise;
  const logout = h.auth.forceLogout(false, { forgetCredentials: true });
  complete.resolve();
  await Promise.all([saving, logout]);
  assert.equal((await h.storage.getCredentials()).username, null);
  assert.equal((await h.storage.getCredentials()).password, null);
  assert.equal(await h.storage.saveCredentials('stale', 'stale', version), false);
});

test('OCR server error payload falls back after one attempt', async () => {
  const h = createHarness();
  const ocr = h.load('src/utils/ocr.js');
  h.environment.fetch = async () => response({ error: 'OCR backend failed' });
  let attempts = 0;
  const result = await ocr.autoLoginWithCaptcha(async () => { attempts++; return { captchaImage: 'image' }; }, async () => ({}), 8);
  assert.equal(attempts, 1);
  assert.equal(result.needManual, true);
});
