/**
 * 登录状态管理器
 * 监听token过期，自动重登录
 */
import { login, getCaptcha } from '../api/client';
import { autoLoginWithCaptcha } from './ocr';
import { getCredentials, getToken, saveToken, removeToken, clearAll } from './storage';

let _onExpired = null; // 过期回调 — 导航回Login页

/**
 * 设置登录过期回调
 */
export function onTokenExpired(callback) {
  _onExpired = callback;
}

/**
 * 检查token是否存在
 */
export async function isLoggedIn() {
  const token = await getToken();
  return !!token;
}

/**
 * 自动重登录 — 8次OCR重试
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
    8, // 8次重试
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

      // 自动重登失败 — 清除状态，回调
      await clearAll();

      if (_onExpired) {
        _onExpired(result.needManual);
      }

      return { success: false, needManual: result.needManual, message: result.message };
    } catch (e) {
      await clearAll();
      if (_onExpired) _onExpired(true);
      return { success: false, needManual: true, message: e.message };
    } finally {
      _reloginPromise = null;
    }
  })();

  return _reloginPromise;
}
