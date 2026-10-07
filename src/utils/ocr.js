/** CAPTCHA OCR with a bounded end-to-end fallback to manual entry. */
import { requestJSON, apiError } from '../api/http';
const OCR_SERVER = 'http://39.106.98.187:8910';

export async function recognizeCaptcha(base64Image, timeoutMs = 6000) {
  const result = await requestJSON(OCR_SERVER, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image }),
  }, timeoutMs);
  if (result.error) throw apiError('验证码识别服务暂不可用，请手动输入', 'OCR_UNAVAILABLE');
  if (typeof result.text === 'string' && result.text.trim()) return result.text.trim();
  if (typeof result.raw === 'string' && result.raw.length >= 2) {
    return result.raw.replace(/[^a-zA-Z0-9\-]/g, '').substring(0, 6);
  }
  return '';
}

function within(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(apiError('自动登录超时，请手动输入验证码', 'TIMEOUT')), ms);
  })]).finally(() => clearTimeout(timer));
}

export async function autoLoginWithCaptcha(
  getCaptchaFn, loginFn, maxRetries = 5, onProgress = null,
  { deadlineMs = 25000, shouldContinue = () => true } = {}
) {
  const deadline = Date.now() + deadlineMs;
  const progress = (attempt, stage, message) => onProgress?.(attempt, stage, message);
  const manual = message => ({ success: false, needManual: true, message });
  const remaining = () => Math.max(1, deadline - Date.now());
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!shouldContinue()) return { success: false, cancelled: true };
    if (Date.now() >= deadline) return manual('自动登录超时，请手动输入验证码');
    try {
      progress(attempt, 'fetching', `获取验证码 (${attempt}/${maxRetries})...`);
      const captcha = await within(Promise.resolve().then(getCaptchaFn), remaining());
      if (!shouldContinue()) return { success: false, cancelled: true };
      progress(attempt, 'ocr', '正在识别验证码...');
      const text = await recognizeCaptcha(captcha.captchaImage, Math.min(6000, remaining()));
      if (!shouldContinue()) return { success: false, cancelled: true };
      if (!text) {
        progress(attempt, 'ocr_fail', '未识别，重试...');
        continue;
      }
      if (Date.now() >= deadline) return manual('自动登录超时，请手动输入验证码');
      progress(attempt, 'login', '正在登录...');
      const result = await within(Promise.resolve().then(() => loginFn(captcha.captchaId, text)), remaining());
      if (!shouldContinue()) return { success: false, cancelled: true };
      if (result?.token) {
        progress(attempt, 'success', '登录成功');
        return { success: true, needManual: false, result, message: '登录成功' };
      }
      return manual('登录响应无效，请手动登录');
    } catch (error) {
      if (!shouldContinue()) return { success: false, cancelled: true };
      const message = error.message || '自动登录失败';
      if (['NETWORK_ERROR', 'HTTP_ERROR', 'INVALID_JSON', 'INVALID_RESPONSE', 'TIMEOUT', 'OCR_UNAVAILABLE'].includes(error.code)) {
        return manual(message);
      }
      // Only an explicit CAPTCHA mismatch merits another login attempt.
      if (!/验证码|captcha/i.test(message)) return manual(message);
      progress(attempt, 'retry', message);
    }
  }
  return manual(`自动识别 ${maxRetries} 次均失败，请手动输入验证码`);
}
