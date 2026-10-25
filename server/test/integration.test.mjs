// server/test/integration.test.mjs —— 场2 集成验收：真实服务进程 + 沙箱数据目录
// 用法：node server/test/integration.test.mjs（任意日期、任意次数可重跑）
// 隔离：把 server/*.mjs 复制到 server/test/.tmp/sandbox-<pid>/server/ 再启动——main.mjs 按自身位置
// 定位 dispatch-data，所以服务只读写沙箱，真实 dispatch-data 与 8317 上的服务一概不碰。
// 服务绑 127.0.0.1:8321，结束只杀自有子进程；沙箱是纯临时目录，结束删除。
import { spawn } from 'node:child_process';
import { readFile, rm, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PORT = 8321;
const BASE = `http://127.0.0.1:${PORT}`;
const SANDBOX = path.join(ROOT, 'server', 'test', '.tmp', `sandbox-${process.pid}`);
const SANDBOX_DATA = path.join(SANDBOX, 'dispatch-data');
const REAL_DATA = path.join(ROOT, 'dispatch-data');
const SERVER_FILES = ['main.mjs', 'repository.mjs', 'publisher.mjs', 'schema.mjs'];

let passed = 0;
let failed = 0;
function test(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, detail ? `→ ${detail}` : ''); }
}
// 与服务端同口径：业务「今天」取 Asia/Shanghai
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// 真实数据指纹：测试前后逐项比对，证明沙箱没有漏写到真实目录
async function fingerprint() {
  const out = {};
  for (const f of ['manifest.json', 'state.json', 'state.json.bak']) {
    try {
      const p = path.join(REAL_DATA, f);
      out[f] = `${(await stat(p)).mtimeMs}|${(await readFile(p, 'utf8')).length}`;
    } catch { out[f] = 'absent'; }
  }
  return JSON.stringify(out);
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        const body = await r.json();
        if (body.pid === child.pid && body.app === 'task-card-dispatch') return true;
      }
    } catch { /* 未就绪 */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function call(p, { method = 'GET', token, origin, rawBody, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Dispatch-Token'] = token;
  if (origin) headers.Origin = origin;
  const opt = { method, headers };
  if (rawBody !== undefined) opt.body = rawBody;
  else if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + p, opt);
  let data = null;
  try { data = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, body: data };
}

const realBefore = await fingerprint();
await mkdir(path.join(SANDBOX, 'server'), { recursive: true });
for (const f of SERVER_FILES) await copyFile(path.join(ROOT, 'server', f), path.join(SANDBOX, 'server', f));

const child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'main.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', d => (serverLog += d));
child.stderr.on('data', d => (serverLog += d));

const KEY = 'tc-refactor-stage5-8';
try {
  const ready = await waitReady();
  test('服务启动就绪(8321，沙箱数据) + pid 归属校验', ready, serverLog.slice(-300));
  if (!ready) {
    console.error(`ABORT: 沙箱服务未就绪（超时/端口被占用/child.pid=${child.pid}）`);
    process.exitCode = 1;
    throw new Error('沙箱服务归属校验失败，停止后续 POST 请求');
  }

  // —— 约束二：空态必须 200 + published:false + tasks:[]，绝不是 404/500。沙箱每次全新，故每次都断言 ——
  const empty = await call('/api/today');
  test('/api/today 未发布空态 = 200 + published:false + tasks:[]',
    empty.status === 200 && empty.body?.published === false && Array.isArray(empty.body?.tasks) && empty.body.tasks.length === 0 && empty.body.date === today(),
    JSON.stringify(empty).slice(0, 200));

  // fixture 样例：date 覆盖为当天，保证任何日期运行都命中「今天已发布」分支
  const def = JSON.parse(await readFile(path.join(ROOT, 'server', 'test', 'fixtures', 'sample.json'), 'utf8'));
  delete def._readme;
  def.date = today();

  const { body: sess } = await call('/api/session');
  const TOKEN = sess?.token;
  test('GET /api/session 发放写令牌', Boolean(TOKEN));

  const health = await call('/api/health');
  test('health 200 + 应用标识', health.status === 200 && health.body?.app === 'task-card-dispatch');

  const pv = await call('/api/import/preview', { method: 'POST', body: def });
  test('preview 200 + ok + hash + added=2',
    pv.status === 200 && pv.body?.ok === true && pv.body?.hash && pv.body?.diff?.added?.length === 2,
    JSON.stringify(pv.body).slice(0, 200));

  const noToken = await call('/api/import/commit', { method: 'POST', body: { definition: def, previewHash: pv.body.hash } });
  test('commit 无令牌 = 401', noToken.status === 401);

  const badHash = await call('/api/import/commit', { method: 'POST', token: TOKEN, body: { definition: def, previewHash: 'deadbeef' } });
  test('commit 坏 hash = 409', badHash.status === 409);

  const cm = await call('/api/import/commit', { method: 'POST', token: TOKEN, body: { definition: def, previewHash: pv.body.hash } });
  test('commit 成功 200 + generationId', cm.status === 200 && Boolean(cm.body?.generationId), JSON.stringify(cm.body).slice(0, 200));

  const again = await call('/api/import/commit', { method: 'POST', token: TOKEN, body: { definition: def, previewHash: pv.body.hash } });
  test('重发同内容 = alreadyPublished + 同 generationId', again.status === 200 && again.body?.alreadyPublished === true && again.body?.generationId === cm.body?.generationId);

  const pv2 = await call('/api/import/preview', { method: 'POST', body: def });
  test('发布后再预览 = unchanged=2（差异计算对已发布版本）', pv2.body?.diff?.unchanged?.length === 2);

  const t = await call('/api/today');
  test('/api/today 已发布 = 200 + published:true + 2任务 + available 快照',
    t.status === 200 && t.body?.published === true && t.body?.tasks?.length === 2
      && t.body.tasks.every(x => x.execution?.execution === 'available') && t.body.generationId === cm.body?.generationId,
    JSON.stringify(t.body).slice(0, 200));

  const op = { operationId: 'it-accept-001', expectedVersion: 0, type: 'accept', payload: {} };
  const acc = await call(`/api/dispatches/${KEY}/operations`, { method: 'POST', token: TOKEN, body: op });
  test('operations accept = 200 + version 1', acc.status === 200 && acc.body?.version === 1 && acc.body?.replayed === false,
    JSON.stringify(acc.body).slice(0, 200));

  const rep = await call(`/api/dispatches/${KEY}/operations`, { method: 'POST', token: TOKEN, body: op });
  test('同 operationId 同内容重放 = replayed:true + version 不涨', rep.status === 200 && rep.body?.replayed === true && rep.body?.version === 1);

  const reuse = await call(`/api/dispatches/${KEY}/operations`, { method: 'POST', token: TOKEN, body: { ...op, payload: { x: 1 } } });
  test('同 operationId 不同内容 = 409', reuse.status === 409);

  const conflict = await call(`/api/dispatches/${KEY}/operations`, {
    method: 'POST', token: TOKEN, body: { operationId: 'it-c1', expectedVersion: 9, type: 'shelve', payload: {} },
  });
  test('版本冲突 = 409 + current=1', conflict.status === 409 && conflict.body?.current === 1);

  const unknown = await call('/api/dispatches/no-such-key/operations', {
    method: 'POST', token: TOKEN, body: { operationId: 'it-u1', expectedVersion: 0, type: 'accept', payload: {} },
  });
  test('未发布 key = 422', unknown.status === 422);

  const get1 = await call(`/api/dispatches/${KEY}`);
  test('GET 任务状态 = 200 + accepted + deadline>now',
    get1.status === 200 && get1.body?.execution?.execution === 'accepted' && get1.body.execution.deadline > Date.now());

  const badJson = await call('/api/import/preview', { method: 'POST', rawBody: '{bad' });
  test('坏 JSON = 400', badJson.status === 400);

  const big = await call('/api/import/preview', { method: 'POST', body: { fill: 'a'.repeat(300000) } });
  test('超限 300KB = 413', big.status === 413);

  const evil = await call('/api/import/preview', { method: 'POST', origin: 'http://evil.example', body: {} });
  test('伪 Origin = 403', evil.status === 403);

  const thtml = await fetch(`${BASE}/today.html`);
  test('today.html 静态文件期 404（场3 建）', thtml.status === 404);

  const after = await call('/api/today');
  test('/api/today 反映执行快照（accepted）',
    after.body?.tasks?.some(x => x.definition?.dispatchKey === KEY && x.execution?.execution === 'accepted') === true);

  const persisted = JSON.parse(await readFile(path.join(SANDBOX_DATA, 'state.json'), 'utf8'));
  test('沙箱 state.json 落盘：状态 + 幂等记录同快照', persisted.tasks?.[KEY]?.version === 1 && Boolean(persisted.operations?.['it-accept-001']));
} finally {
  // 子进程可能已提前退出（端口占用等），此时不能再等 exit 事件
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(r => child.once('exit', r));
    child.kill();
    await exited;
  }
  test('真实 dispatch-data 全程未被触碰（前后指纹一致）', (await fingerprint()) === realBefore, `before=${realBefore}`);
  await rm(SANDBOX, { recursive: true, force: true }); // 沙箱是本进程自建的纯临时目录
}
console.log(`SUMMARY pass=${passed} fail=${failed}`);
process.exitCode = failed ? 1 : 0;
