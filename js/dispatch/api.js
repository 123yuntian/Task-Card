/**
 * js/dispatch/api.js — 派活系统的 API 调用封装
 * 职责：GET /api/today、GET /api/generations、POST /api/dispatches/:key/operations、写令牌
 * 不包含状态管理与缓存。网络失败与「今日未发布」必须可区分：前者 ok:false，后者 ok:true + published:false。
 */

let sessionToken = null;

/** 领取本次服务会话的写令牌；服务重启后令牌失效，需要重新领取 */
export async function fetchSessionToken() {
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sessionToken = (await res.json()).token ?? null;
  } catch (err) {
    console.error('[dispatch/api] 领取会话令牌失败：', err);
    sessionToken = null;
  }
  return sessionToken;
}

/** 今日派活。成功：{ok:true, published, date, ...}；服务不可达：{ok:false, error} */
export async function fetchToday() {
  try {
    const res = await fetch('/api/today', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, ...(await res.json()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 历史发布列表（只读）；取不到返回 null，调用方据此区分「没有历史」和「服务未连接」 */
export async function fetchGenerations() {
  try {
    const res = await fetch('/api/generations', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data.generations) ? data.generations : [];
  } catch (err) {
    console.error('[dispatch/api] 获取历史发布失败：', err);
    return null;
  }
}

async function sendOnce(dispatchKey, operation) {
  const res = await fetch(`/api/dispatches/${encodeURIComponent(dispatchKey)}/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Dispatch-Token': sessionToken ?? '' },
    body: JSON.stringify(operation),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 响应按失败处理 */ }
  return { res, data };
}

/**
 * 发送一条操作命令。令牌缺失或被服务端拒绝（401，服务重启过）时重新领取后重发一次；
 * 两次用同一个 operationId，服务端按幂等重放，不会重复执行。
 */
export async function postOperation(dispatchKey, operation) {
  try {
    if (!sessionToken) await fetchSessionToken();
    let { res, data } = await sendOnce(dispatchKey, operation);
    if (res.status === 401) {
      await fetchSessionToken();
      ({ res, data } = await sendOnce(dispatchKey, operation));
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}`, detail: data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'network', message: err.message };
  }
}
