/**
 * 验证码 OCR - 使用本地 ddddocr 服务
 */

// 阿里云 ddddocr 服务器
const OCR_SERVER = 'http://39.106.98.187:8910';

/**
 * OCR识别: 发送图片到本地ddddocr服务
 */
async function ocrImage(base64Image) {
  try {
    const resp = await fetch(OCR_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
    });
    const json = await resp.json();
    return json; // { raw, text, isMath, answer }
  } catch (e) {
    console.log('[OCR] 服务不可达:', e.message);
    return null;
  }
}

/**
 * 识别验证码
 */
export async function recognizeCaptcha(base64Image) {
  const result = await ocrImage(base64Image);
  if (!result) return '';
  if (result.text) return result.text;
  // 降级: 有raw但没解析出来
  if (result.raw && result.raw.length >= 2) {
    return result.raw.replace(/[^a-zA-Z0-9\-]/g, '').substring(0, 6);
  }
  return '';
}

/**
 * 自动登录
 */
export async function autoLoginWithCaptcha(
  getCaptchaFn,
  loginFn,
  maxRetries = 5,
  onProgress = null
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (onProgress) onProgress(attempt, 'fetching', `获取验证码 (${attempt}/${maxRetries})...`);
    let captchaData;
    try {
      captchaData = await getCaptchaFn();
    } catch (e) {
      if (onProgress) onProgress(attempt, 'error', '获取验证码失败');
      continue;
    }

    if (onProgress) onProgress(attempt, 'ocr', 'ddddocr识别中...');
    let captchaText;
    try {
      captchaText = await recognizeCaptcha(captchaData.captchaImage);
    } catch (e) {
      captchaText = '';
    }

    if (!captchaText || captchaText.length < 1) {
      if (onProgress) onProgress(attempt, 'ocr_fail', '未识别，重试...');
      continue;
    }

    if (onProgress) onProgress(attempt, 'login', `验证码: ${captchaText}，登录中...`);
    try {
      const result = await loginFn(captchaData.captchaId, captchaText);
      if (result && result.token) {
        if (onProgress) onProgress(attempt, 'success', '登录成功!');
        return { success: true, needManual: false, result, message: '登录成功' };
      }
      if (onProgress) onProgress(attempt, 'retry', '验证码错误，重试...');
    } catch (e) {
      const msg = e.message || '';
      if (/密码|学号|账号|用户|不存在|禁用/.test(msg)) {
        return { success: false, needManual: false, message: msg };
      }
      if (onProgress) onProgress(attempt, 'retry', msg);
    }
  }

  return {
    success: false,
    needManual: true,
    message: `自动识别 ${maxRetries} 次均失败，请手动输入`,
  };
}
