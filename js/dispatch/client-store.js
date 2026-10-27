// js/dispatch/client-store.js — 离线待同步的 IndexedDB 本地存储层（派活重构阶段 7 上半 B3a）
//
// 含两块存储：
//   snapshots —— 最近一次成功拉到的今日任务快照（固定 key 'today'），断网时页面仍有内容可渲染；
//   queue     —— 离线期间暂存的待同步操作（keyPath 'operationId'），来电后按入队顺序逐条补提交。
//
// 约定：纯浏览器原生 API，零第三方依赖；数据库打开失败、事务失败一律向上抛错，
// 不许静默吞掉 —— 上层要靠这个异常判断「到底存上了没有」。

const DB_NAME = 'task-card-dispatch';
const DB_VERSION = 1;

// 模块级缓存：开成功后页面存活期内复用同一连接；开失败不缓存，下次调用可重试
let dbPromise = null;

// 所有导出函数统一从这里拿 db 实例；打开失败必须 reject，不许吞
function openDb() {
  if (dbPromise) return dbPromise;
  const p = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snapshots')) {
        // 不用 keyPath，用外部 key —— 快照永远只有一个固定 'today'
        db.createObjectStore('snapshots');
      }
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'operationId' });
      }
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open 失败'));
    // 其它标签页还握着旧版本连接时升级会被卡住 —— 必须让上层知道，不能干等
    req.onblocked = () => reject(new Error('indexedDB.open 被旧版本连接阻塞（其它标签页？）'));
    req.onsuccess = () => resolve(req.result);
  });
  // 失败不永久缓存：reject 照常抛给调用方，这里只把缓存清掉，给下次调用一次重开的机会
  p.catch(() => { dbPromise = null; });
  dbPromise = p;
  return p;
}

// 存最近一次成功拉到的最新任务快照 + 保存时间，返回 savedAt
export async function saveSnapshot(tasks, meta) {
  const db = await openDb();
  const savedAt = Date.now();
  return new Promise((resolve, reject) => {
    // 每次操作新开事务；成败以事务 oncomplete 为准，单个 request 成功不代表落盘
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put({ tasks, savedAt, meta }, 'today');
    tx.oncomplete = () => resolve(savedAt);
    tx.onerror = () => reject(tx.error ?? new Error('saveSnapshot 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('saveSnapshot 事务被中止'));
  });
}

// 读回 { tasks, savedAt } | null
export async function loadSnapshot() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let value = null;
    const tx = db.transaction('snapshots', 'readonly');
    const req = tx.objectStore('snapshots').get('today');
    req.onsuccess = () => { value = req.result ?? null; }; // 只负责取值；成败仍以事务为准
    tx.oncomplete = () => resolve(value ? { tasks: value.tasks, savedAt: value.savedAt } : null);
    tx.onerror = () => reject(tx.error ?? new Error('loadSnapshot 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('loadSnapshot 事务被中止'));
  });
}

// 入队 { operationId, key, type, payload, enqueuedAt }；同一 operationId 重复入队幂等，不产生两条
export async function enqueue(op) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let existing = null;
    let written = null;
    // get + put 放同一个事务：判断「是否已入队」和写入之间不留窗口
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const getReq = store.get(op.operationId);
    getReq.onsuccess = () => {
      existing = getReq.result ?? null;
      // 已存在：原样保留，enqueuedAt 不被新时间覆盖，不重写
      if (!existing) {
        written = { ...op, enqueuedAt: op.enqueuedAt ?? Date.now() };
        store.put(written);
      }
    };
    tx.oncomplete = () => resolve(existing ?? written);
    tx.onerror = () => reject(tx.error ?? new Error('enqueue 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('enqueue 事务被中止'));
  });
}

// 按 enqueuedAt 升序返回全部待同步操作
export async function listQueue() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let items = [];
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => { items = req.result; };
    tx.oncomplete = () => resolve(items.sort((a, b) => a.enqueuedAt - b.enqueuedAt));
    tx.onerror = () => reject(tx.error ?? new Error('listQueue 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('listQueue 事务被中止'));
  });
}

// 按 operationId 移除一条
export async function dequeue(operationId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(operationId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('dequeue 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('dequeue 事务被中止'));
  });
}

// 返回队列当前条数
export async function queueSize() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let size = 0;
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').count();
    req.onsuccess = () => { size = req.result; };
    tx.oncomplete = () => resolve(size);
    tx.onerror = () => reject(tx.error ?? new Error('queueSize 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('queueSize 事务被中止'));
  });
}

// 清空两个 store，供 __selftest 开场和收尾各调一次：可重复跑、不留垃圾。
// 用 clear() 不用 deleteDatabase —— 后者会把连接关掉，后面的操作全废
async function clearStores() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['snapshots', 'queue'], 'readwrite');
    tx.objectStore('snapshots').clear();
    tx.objectStore('queue').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('clear 事务失败'));
    tx.onabort = () => reject(tx.error ?? new Error('clear 事务被中止'));
  });
}

// 自测：跑一遍存储层行为，返回 [{ name, ok, detail }]。
// 自身不许抛错 —— 单项里的调用炸了就记 ok:false 带上错误信息，其它项继续跑
export async function __selftest() {
  const results = [];
  const step = async (name, fn) => {
    try {
      const { ok, detail } = await fn();
      results.push({ name, ok, detail });
    } catch (err) {
      results.push({ name, ok: false, detail: `调用抛错：${err?.message ?? err}` });
    }
  };

  await step('开场清库', async () => {
    await clearStores();
    return { ok: true, detail: 'snapshots 与 queue 两个 store 已 clear' };
  });

  const tasks = [{ id: 'st-t1', title: '自测任务一' }, { id: 'st-t2', title: '自测任务二' }];
  await step('存快照再读回，任务数与内容一致', async () => {
    const savedAt = await saveSnapshot(tasks, { date: 'selftest' });
    const back = await loadSnapshot();
    const ok = !!back && back.savedAt === savedAt
      && back.tasks.length === tasks.length
      && JSON.stringify(back.tasks) === JSON.stringify(tasks);
    return { ok, detail: ok ? '存 2 条读回 2 条，内容逐字段一致' : `期望读回同样的 2 条，得到 ${JSON.stringify(back)}` };
  });

  await step('清库后立刻读快照，应返回 null', async () => {
    await clearStores();
    const snap = await loadSnapshot();
    return { ok: snap === null, detail: `期望 null 得到 ${snap === null ? 'null' : JSON.stringify(snap)}` };
  });

  await step('入队 3 条，listQueue 升序返回 3 条', async () => {
    // 显式给 enqueuedAt：连续入队可能落在同一毫秒，不显式给，升序断言就随机了
    await enqueue({ operationId: 'st-1', key: 'k-1', type: 'accept', payload: {}, enqueuedAt: 100 });
    await enqueue({ operationId: 'st-2', key: 'k-2', type: 'complete', payload: {}, enqueuedAt: 200 });
    await enqueue({ operationId: 'st-3', key: 'k-3', type: 'fail', payload: {}, enqueuedAt: 300 });
    const list = await listQueue();
    const ids = list.map((o) => o.operationId).join(',');
    const ok = list.length === 3 && ids === 'st-1,st-2,st-3';
    return { ok, detail: ok ? '3 条，顺序 st-1→st-2→st-3（enqueuedAt 升序）' : `期望 3 条且顺序 st-1,st-2,st-3，得到 ${list.length} 条：${ids}` };
  });

  await step('同 operationId 重复入队，条数不变且 enqueuedAt 不被覆盖', async () => {
    await enqueue({ operationId: 'st-2', key: 'k-2', type: 'delay', payload: {}, enqueuedAt: 999 });
    const size = await queueSize();
    const dup = (await listQueue()).find((o) => o.operationId === 'st-2');
    const ok = size === 3 && !!dup && dup.enqueuedAt === 200 && dup.type === 'complete';
    return { ok, detail: ok ? 'queueSize 仍 3，st-2 保持第一次的 enqueuedAt=200、type=complete' : `期望 3 条且 st-2 保持 enqueuedAt=200/type=complete，得到 ${size} 条、st-2=${dup ? `enqueuedAt=${dup.enqueuedAt},type=${dup.type}` : '不存在'}` };
  });

  await step('dequeue 一条，剩 2 条且删的正是那条', async () => {
    await dequeue('st-2');
    const list = await listQueue();
    const ids = list.map((o) => o.operationId).join(',');
    const ok = list.length === 2 && ids === 'st-1,st-3';
    return { ok, detail: ok ? '剩 st-1 / st-3，删掉的正是 st-2' : `期望剩 st-1,st-3，得到 ${list.length} 条：${ids}` };
  });

  await step('收尾再清库，queueSize 归零', async () => {
    await clearStores();
    const size = await queueSize();
    return { ok: size === 0, detail: `清库后 queueSize 期望 0 得到 ${size}` };
  });

  return results;
}
