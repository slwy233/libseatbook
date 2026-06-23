import { clearSession } from './storage';

let tokenExpiredCallback = null;
let autoReLoginHandler = null;
let reloginPromise = null;
let notifyingExpired = false;

export function onTokenExpired(callback) {
  tokenExpiredCallback = callback;
}

export function registerAutoReLoginHandler(handler) {
  autoReLoginHandler = handler;
}

export function isTokenExpiredError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  return message === 'TOKEN_EXPIRED';
}

async function notifyTokenExpired(payload = {}) {
  if (notifyingExpired) {
    return;
  }

  notifyingExpired = true;

  try {
    await clearSession();

    if (typeof tokenExpiredCallback === 'function') {
      await tokenExpiredCallback({
        needManual: true,
        message: '登录状态已过期，请重新登录',
        ...payload,
      });
    }
  } finally {
    setTimeout(() => {
      notifyingExpired = false;
    }, 0);
  }
}

export async function handleTokenExpired() {
  if (reloginPromise) {
    return reloginPromise;
  }

  reloginPromise = (async () => {
    if (typeof autoReLoginHandler !== 'function') {
      const result = {
        success: false,
        needManual: true,
        message: '未注册自动重登处理器',
      };
      await notifyTokenExpired(result);
      return result;
    }

    try {
      const result = await autoReLoginHandler();

      if (result?.success) {
        return { success: true };
      }

      const failedResult = {
        success: false,
        needManual: result?.needManual !== false,
        message: result?.message || '自动重新登录失败',
      };

      await notifyTokenExpired(failedResult);
      return failedResult;
    } catch (error) {
      const failedResult = {
        success: false,
        needManual: true,
        message: error?.message || '自动重新登录失败',
      };

      await notifyTokenExpired(failedResult);
      return failedResult;
    } finally {
      reloginPromise = null;
    }
  })();

  return reloginPromise;
}
