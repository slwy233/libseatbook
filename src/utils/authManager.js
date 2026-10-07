/** Session expiry recovery, shared by concurrent API calls. */
import { login, getCaptcha } from '../api/client';
import { autoLoginWithCaptcha } from './ocr';
import { getCredentials, getToken, saveToken, clearSession, getSessionVersion, isSessionCurrent } from './storage';

const listeners = new Set();
let globalNavRef = null;
let reloginFlight = null;

export function setGlobalNavRef(ref) { globalNavRef = ref; }
export function onTokenExpired(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function forceLogout(needManual = false, options = {}) {
  const { notify = true, forgetCredentials = false, expectedVersion, expectedToken } = options;
  if (expectedVersion !== undefined && !isSessionCurrent(expectedVersion)) return false;
  if (expectedToken !== undefined && await getToken() !== expectedToken) return false;
  // clearSession changes the generation immediately, before awaiting storage writes.
  const clearing = clearSession({ forgetCredentials, expectedVersion });
  const clearedVersion = getSessionVersion();
  const cleared = await clearing;
  if (!cleared || !isSessionCurrent(clearedVersion)) return false;
  if (notify) {
    listeners.forEach(callback => {
      try { callback(needManual); } catch (_) { /* one subscriber must not prevent root navigation */ }
    });
  }
  if (!isSessionCurrent(clearedVersion)) return false;
  const navigation = globalNavRef?.current || globalNavRef;
  if (navigation && (!navigation.isReady || navigation.isReady())) {
    const state = { index: 0, routes: [{ name: 'Login', params: { forceReLogin: needManual } }] };
    if (navigation.resetRoot) navigation.resetRoot(state);
    else if (navigation.reset) navigation.reset(state);
  }
  return true;
}

export async function isLoggedIn() { return !!(await getToken()); }

export async function autoReLogin(version = getSessionVersion()) {
  const creds = await getCredentials();
  if (!isSessionCurrent(version)) return { success: false, cancelled: true };
  if (!creds?.username || !creds?.password) {
    return { success: false, needManual: true, message: '未找到已保存的账号' };
  }
  const result = await autoLoginWithCaptcha(
    () => getCaptcha(creds.username),
    async (cid, ctext) => {
      if (!isSessionCurrent(version)) throw new Error('SESSION_CHANGED');
      return login(creds.username, creds.password, cid, ctext, { persistToken: false });
    },
    5,
    null,
    { deadlineMs: 25000, shouldContinue: () => isSessionCurrent(version) }
  );
  if (!isSessionCurrent(version)) return { success: false, cancelled: true };
  if (result.success && result.result?.token) {
    const saved = await saveToken(result.result.token, { refresh: true, expectedVersion: version });
    return saved ? { success: true } : { success: false, cancelled: true };
  }
  return result;
}

export async function handleTokenExpired(expiredToken, version = getSessionVersion()) {
  if (!isSessionCurrent(version)) return { success: false, cancelled: true };
  const currentToken = await getToken();
  if (!isSessionCurrent(version)) return { success: false, cancelled: true };
  // A late response from the old token should reuse the token already refreshed.
  if (expiredToken && currentToken && currentToken !== expiredToken) return { success: true };
  if (reloginFlight?.version === version) return reloginFlight.promise;
  const flight = { version };
  flight.promise = (async () => {
    let result;
    try { result = await autoReLogin(version); }
    catch (error) { result = { success: false, needManual: true, message: error.message }; }
    if (!isSessionCurrent(version) || result.cancelled) return { success: false, cancelled: true };
    if (result.success) return { success: true };
    await forceLogout(true, { expectedVersion: version });
    return { ...result, needManual: true };
  })().finally(() => {
    if (reloginFlight === flight) reloginFlight = null;
  });
  reloginFlight = flight;
  return flight.promise;
}
