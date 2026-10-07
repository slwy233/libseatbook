/** A bounded request. Write operations are never retried after transport errors. */
export function apiError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export async function requestJSON(url, options = {}, timeoutMs = 15000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(apiError('请求超时，请检查操作结果后再试', 'TIMEOUT'));
      controller?.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      let response;
      try {
        response = await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
      } catch (error) {
        throw apiError('网络连接失败，请检查网络后重试', 'NETWORK_ERROR', { cause: error });
      }
      let body;
      const status = response.status;
      try {
        body = await response.json();
      } catch (error) {
        if (response.ok === false || status >= 400) {
          throw apiError(`请求失败 HTTP ${status}`, 'HTTP_ERROR', { httpStatus: status, cause: error });
        }
        throw apiError('服务返回了无法解析的响应', 'INVALID_JSON', { httpStatus: status, cause: error });
      }
      if (response.ok === false || status >= 400) {
        throw apiError(body?.message || body?.error || `请求失败 HTTP ${status}`, 'HTTP_ERROR', {
          httpStatus: status, responseBody: body,
        });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw apiError('服务返回了无效的响应', 'INVALID_RESPONSE', { httpStatus: status });
      }
      return body;
    })(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function assertBusinessSuccess(body, fallback = '请求失败') {
  if (body.status === false || body.success === false || body.error) {
    throw apiError(body.message || body.error || fallback, body.code || 'BUSINESS_ERROR', { responseBody: body });
  }
  return body;
}
