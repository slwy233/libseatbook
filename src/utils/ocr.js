const OCR_SERVER = 'http://39.106.98.187:8910';

function normalizeBase64Image(base64Image) {
  if (!base64Image) {
    return '';
  }

  if (base64Image.startsWith('data:')) {
    const parts = base64Image.split(',');
    return parts.length > 1 ? parts[1] : '';
  }

  return base64Image;
}

async function ocrImage(base64Image) {
  const image = normalizeBase64Image(base64Image);
  if (!image) {
    return null;
  }

  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), 15000)
    : null;

  try {
    const response = await fetch(OCR_SERVER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image }),
      signal: controller?.signal,
    });

    return await response.json();
  } catch (error) {
    console.log('[OCR] 服务调用失败:', error?.message || error);
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function cleanOcrText(text) {
  return String(text || '')
    .replace(/[\s\r\n]/g, '')
    .replace(/[^0-9a-zA-Z\-]/g, '')
    .slice(0, 8);
}

export async function recognizeCaptcha(base64Image) {
  const result = await ocrImage(base64Image);
  if (!result) {
    return '';
  }

  if (result.isMath && result.answer !== undefined && result.answer !== null) {
    return String(result.answer).trim();
  }

  if (result.text) {
    return cleanOcrText(result.text);
  }

  if (result.raw) {
    return cleanOcrText(result.raw);
  }

  return '';
}

export async function autoLoginWithCaptcha(
  getCaptchaFn,
  loginFn,
  maxRetries = 5,
  onProgress = null
) {
  let lastCaptchaData = null;
  let lastMessage = '';

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    if (onProgress) {
      onProgress(attempt, 'fetching', `获取验证码 (${attempt}/${maxRetries})...`);
    }

    let captchaData;
    try {
      captchaData = await getCaptchaFn();
      lastCaptchaData = captchaData;
    } catch (error) {
      lastMessage = error?.message || '获取验证码失败';
      if (onProgress) {
        onProgress(attempt, 'fetch_failed', lastMessage);
      }
      continue;
    }

    if (onProgress) {
      onProgress(attempt, 'ocr', `验证码识别中 (${attempt}/${maxRetries})...`);
    }

    let captchaText = '';
    try {
      captchaText = await recognizeCaptcha(captchaData.captchaImage);
    } catch (error) {
      captchaText = '';
    }

    if (!captchaText) {
      lastMessage = 'OCR识别失败';
      if (onProgress) {
        onProgress(attempt, 'ocr_failed', `${lastMessage}，准备重试...`);
      }
      continue;
    }

    if (onProgress) {
      onProgress(attempt, 'login', `识别结果 ${captchaText}，尝试登录...`);
    }

    try {
      const result = await loginFn(captchaData.captchaId, captchaText);

      if (result?.token) {
        if (onProgress) {
          onProgress(attempt, 'success', '登录成功');
        }

        return {
          success: true,
          needManual: false,
          result,
          message: '登录成功',
        };
      }

      lastMessage = '登录失败';
    } catch (error) {
      const message = error?.message || '登录失败';
      lastMessage = message;

      if (/密码|学号|账号|用户|不存在|禁用/.test(message)) {
        return {
          success: false,
          needManual: false,
          message,
        };
      }

      if (onProgress) {
        onProgress(attempt, 'retry', `${message}，准备重试...`);
      }
    }
  }

  return {
    success: false,
    needManual: true,
    captchaId: lastCaptchaData?.captchaId || '',
    captchaImage: lastCaptchaData?.captchaImage || null,
    message: lastMessage || `自动识别 ${maxRetries} 次均失败，请手动输入验证码`,
  };
}
