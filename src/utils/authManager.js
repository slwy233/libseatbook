/**
 * 登录状态管理器
 * 监听token过期，自动重登录
 */
import { login, getCaptcha } from '../api/client';
import { autoLoginWithCaptcha } from './ocr';
import { getCredentials, getToken, saveToken, removeToken, clearAll } from './storage';

let _onExpired = null;
let _globalNavRef = null;

export function setGlobalNavRef(ref) { _globalNavRef = ref; }

export function onTokenExpired(callback) { _onExpired = callback; }

/**
 * 强制退出：清状态 + 导航到登录
 */
export function forceLogout(needManual = false) {
  clearAll().then(() => {
    // 先导航，再弹窗
    if (_globalNavRef && _globalNavRef.isReady()) {
      _globalNavRef.reset({
        index: 0,
        routes: [{ name: 'Login', params: { forceReLogin: needManual } }],
      });
    }
    // 延迟弹窗，确保导航完成
    setTimeout(() => {
      if (_onExpired) _onExpired(needManual);
    }, 500);
  });
}

/**
 * 检查token是否存在
 */
export async function isLoggedIn() {
  const token = await getToken();
  return !!token;
}

/**
 * 自动重登录 — 10次OCR重试
 * 成功：返回true，token已更新
 * 失败：返回false，需清理状态
 */
export async function autoReLogin() {
  const creds = await getCredentials();
  if (!creds.username || !creds.password) {
    return { success: false, needManual: true, message: '未找到已保存的账号' };
  }

  const result = await autoLoginWithCaptcha(
    async () => await getCaptcha(creds.username),
    async (cid, ctext) => await login(creds.username, creds.password, cid, ctext),
    10, // 10次OCR重试
    null  // 静默，不显示进度
  );

  if (result.success && result.result) {
    await saveToken(result.result.token);
    return { success: true };
  }

  return result;
}

/**
 * token过期时自动重登
 * 外部API调用检测到TOKEN_EXPIRED时调用此函数
 */
let _reloginPromise = null; // 防止并发重登

export async function handleTokenExpired() {
  // 防止并发
  if (_reloginPromise) return _reloginPromise;

  _reloginPromise = (async () => {
    try {
      const result = await autoReLogin();
      if (result.success) {
        return { success: true };
      }

      // 自动重登失败 — 强制退出
      await clearAll();
      forceLogout(result.needManual);
      return { success: false, needManual: result.needManual, message: result.message };
    } catch (e) {
      await clearAll();
      forceLogout(true);
      return { success: false, needManual: true, message: e.message };
    } finally {
      _reloginPromise = null;
    }
  })();

  return _reloginPromise;
}
