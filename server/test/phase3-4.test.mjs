// server/test/phase3-4.test.mjs —— 场2 阶段3/4 验收测试
// 用法：node server/test/phase3-4.test.mjs
// 边界：repository/publisher 全部在系统临时目录跑；storage 守卫用 localStorage 垫片；
//       本文件不启动 HTTP 服务、不触碰 dispatch-data 真实运行数据。
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Repository, RepositoryError } from '../repository.mjs';
import { Publisher } from '../publisher.mjs';
import { validateDispatchDefinition, validateOperation } from '../schema.mjs';

let passed = 0;
let failed = 0;
const trash = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '→', e.message);
  }
}
async function tempDir(tag) {
  const d = await mkdtemp(path.join(tmpdir(), `tc-${tag}-`));
  trash.push(d);
  return d;
}
const expectRepoError = async (promise, kind) => {
  try {
    await promise;
  } catch (e) {
    if (e instanceof RepositoryError && e.kind === kind) return e;
    throw new Error(`期望 ${kind}，实际抛了 ${e.kind ?? e.message}`);
  }
  throw new Error(`期望抛 ${kind}，但成功了`);
};

const sampleDef = () => ({
  schemaVersion: 1,
  date: '2026-10-25',
  timezone: 'Asia/Shanghai',
  tasks: [
    { id: 'a-1', dispatchKey: 'k-alpha', title: '任务A', minutes: 30, why: 'why', steps: ['s1', 's2'], prompt: 'p', acceptance: 'acc', contentRevision: 1, codeEvidence: [] },
    { id: 'b-1', dispatchKey: 'k-beta', title: '任务B', minutes: 45, acceptance: 'acc2' },
  ],
});

// ---------- schema ----------
await test('schema：合法定义通过，acceptance 缺失只警告', () => {
  const r = validateDispatchDefinition(sampleDef());
  assert.ok(r.ok, r.errors?.join(';'));
});
await test('schema：缺 dispatchKey / 重复 id / 空任务 / 坏日期 均拒绝', () => {
  const d = sampleDef();
  delete d.tasks[0].dispatchKey;
  assert.ok(!validateDispatchDefinition(d).ok);
  const d2 = sampleDef();
  d2.tasks[1].id = 'a-1';
  assert.ok(!validateDispatchDefinition(d2).ok);
  const d3 = sampleDef();
  d3.tasks = [];
  assert.ok(!validateDispatchDefinition(d3).ok);
  const d4 = sampleDef();
  d4.date = '2026/10/25';
  assert.ok(!validateDispatchDefinition(d4).ok);
});
await test('schema：操作包校验（delay 缺时长 / verdict 非法 / review 缺字段）', () => {
  assert.ok(!validateOperation({ operationId: 'o1', expectedVersion: 0, type: 'delay', payload: {} }).ok);
  assert.ok(!validateOperation({ operationId: 'o1', expectedVersion: 0, type: 'confirm_ai_review', payload: { reviewId: 'r', verdict: 'nope' } }).ok);
  assert.ok(!validateOperation({ operationId: 'o1', expectedVersion: 0, type: 'import_ai_review', payload: { source: 's' } }).ok);
  assert.ok(validateOperation({ operationId: 'o1', expectedVersion: 0, type: 'accept', payload: {} }).ok);
});

// ---------- repository ----------
const rdir = await tempDir('repo');
const repo = await new Repository(rdir).init();
const defA = sampleDef().tasks[0];
const acceptOp = { operationId: 'op-acc-1', expectedVersion: 0, type: 'accept', payload: {} };

await test('repo：写成功可读回（accept→v1，deadline=now+minutes）', async () => {
  const r = await repo.applyOperation('k-alpha', acceptOp, defA);
  assert.equal(r.version, 1);
  assert.equal(r.replayed, false);
  const snap = repo.snapshot('k-alpha');
  assert.equal(snap.execution, 'accepted');
  assert.ok(snap.deadline > Date.now() + 29 * 60000 && snap.deadline < Date.now() + 31 * 60000);
});
await test('repo：同 operationId 同内容重放返回原结果，不涨版本', async () => {
  const r = await repo.applyOperation('k-alpha', acceptOp, defA);
  assert.equal(r.replayed, true);
  assert.equal(r.version, 1);
});
await test('repo：同 operationId 不同内容 → operation_id_reuse', () =>
  expectRepoError(repo.applyOperation('k-alpha', { ...acceptOp, payload: { x: 1 } }, defA), 'operation_id_reuse'));
await test('repo：expectedVersion 不匹配 → version_conflict(带当前版本)', async () => {
  const e = await expectRepoError(repo.applyOperation('k-alpha', { operationId: 'op-2', expectedVersion: 5, type: 'shelve', payload: {} }, defA), 'version_conflict');
  assert.equal(e.detail.current, 1);
});
await test('repo：未发布 key 且无定义 → unknown_task', () =>
  expectRepoError(repo.applyOperation('no-such-key', { operationId: 'op-3', expectedVersion: 0, type: 'accept', payload: {} }, null), 'unknown_task'));
await test('repo：非法迁移（complete 前必须 accept）→ validation', () =>
  expectRepoError(repo.applyOperation('k-beta', { operationId: 'op-4', expectedVersion: 0, type: 'complete', payload: {} }, sampleDef().tasks[1]), 'validation'));
await test('repo(评审5)：非法迁移不留下内存空壳', async () => {
  const r = await new Repository(await tempDir('ghost')).init();
  await expectRepoError(r.applyOperation('k-beta', { operationId: 'g-1', expectedVersion: 0, type: 'complete', payload: {} }, sampleDef().tasks[1]), 'validation');
  assert.equal(r.snapshot('k-beta'), null, '非法迁移不得建档');
});
await test('repo：重启后数据在（新实例同目录）', async () => {
  const again = await new Repository(rdir).init();
  const snap = again.snapshot('k-alpha');
  assert.equal(snap.version, 1);
  assert.equal(snap.execution, 'accepted');
});
await test('repo：状态/版本/幂等记录同快照（裸 JSON 里两者都在）', async () => {
  const raw = await readFile(path.join(rdir, 'state.json'), 'utf8');
  assert.ok(raw.includes('"operations"') && raw.includes('op-acc-1') && raw.includes('k-alpha'));
});
await test('repo：payload 字段顺序不同不算内容不同（幂等成立）', async () => {
  const r = await new Repository(rdir).init();
  const fb = { operationId: 'op-fb-1', expectedVersion: 1, type: 'submit_feedback', payload: { text: 't', difficulty: 3 } };
  await r.applyOperation('k-alpha', fb, defA);
  const reordered = { operationId: 'op-fb-1', expectedVersion: 1, type: 'submit_feedback', payload: { difficulty: 3, text: 't' } };
  const replay = await r.applyOperation('k-alpha', reordered, defA);
  assert.equal(replay.replayed, true);
});

const wdir = await tempDir('wfail');
await test('repo：模拟替换失败 → write_failed 且不产生 state.json', async () => {
  const r = await new Repository(wdir, { failOnWrite: true }).init();
  await expectRepoError(r.applyOperation('k-alpha', acceptOp, defA), 'write_failed');
  await assert.rejects(readFile(path.join(wdir, 'state.json')));
});
await test('repo：有旧数据时替换失败 → 报错且旧文件内容原封不动', async () => {
  const good = await new Repository(wdir).init();
  await good.applyOperation('k-alpha', acceptOp, defA);
  const before = await readFile(path.join(wdir, 'state.json'), 'utf8');
  const bad = new Repository(wdir, { failOnWrite: true });
  await bad.init();
  await expectRepoError(bad.applyOperation('k-alpha', { operationId: 'op-more', expectedVersion: 1, type: 'delay', payload: { extendMinutes: 5 } }, defA), 'write_failed');
  const after = await readFile(path.join(wdir, 'state.json'), 'utf8');
  assert.equal(after, before);
});

const cdir = await tempDir('corrupt');
await test('repo：主文件损坏 → 从 .bak 恢复，数据不丢', async () => {
  const r0 = await new Repository(cdir).init();
  await r0.applyOperation('k-alpha', acceptOp, defA); // 产生 state.json + state.json.bak(空)
  await r0.applyOperation('k-alpha', { operationId: 'op-d1', expectedVersion: 1, type: 'delay', payload: { extendMinutes: 5 } }, defA); // .bak 现为 v1
  await writeFile(path.join(cdir, 'state.json'), '{ 不是JSON', 'utf8');
  const healed = await new Repository(cdir).init();
  assert.ok(!healed.broken);
  assert.equal(healed.snapshot('k-alpha').version, 1);
});
await test('repo：主备双损 → 只读报错，文件不被清空', async () => {
  await writeFile(path.join(cdir, 'state.json'), 'garbage-primary', 'utf8');
  await writeFile(path.join(cdir, 'state.json.bak'), 'garbage-backup', 'utf8');
  const r = await new Repository(cdir).init();
  assert.ok(r.broken, '应进入 broken 只读模式');
  await expectRepoError(r.applyOperation('k-alpha', acceptOp, defA), 'corrupted');
  assert.equal(await readFile(path.join(cdir, 'state.json'), 'utf8'), 'garbage-primary', '坏文件必须原样保留');
});
await test('repo(评审1)：恢复模式下 tmp 写入真实失败，不拿坏主文件覆盖好备份', async () => {
  const d = await tempDir('rec');
  const r0 = await new Repository(d).init();
  await r0.applyOperation('k-alpha', acceptOp, defA);
  await r0.applyOperation('k-alpha', { operationId: 'op-p2', expectedVersion: 1, type: 'delay', payload: { extendMinutes: 5 } }, defA);
  await writeFile(path.join(d, 'state.json'), 'CORRUPTED', 'utf8'); // 主坏，bak=v1 好
  const bakBefore = await readFile(path.join(d, 'state.json.bak'), 'utf8');
  // 把 tmp 路径占成目录：失败发生在「备份决策之后」的 tmp 打开阶段——旧缺陷版本会先把 CORRUPTED 拷进 bak
  await mkdir(path.join(d, 'state.json.tmp'));
  const r1 = await new Repository(d).init();
  assert.ok(r1.recoveredFromBackup);
  await assert.rejects(r1.applyOperation('k-alpha', { operationId: 'op-p3', expectedVersion: 1, type: 'delay', payload: { extendMinutes: 5 } }, defA));
  assert.equal(await readFile(path.join(d, 'state.json.bak'), 'utf8'), bakBefore, 'tmp 写失败时好备份必须逐字节原样');
  assert.equal(await readFile(path.join(d, 'state.json'), 'utf8'), 'CORRUPTED', '主文件未被半截覆盖');
  await rm(path.join(d, 'state.json.tmp'), { recursive: true }); // 撤掉人为障碍（测试自建）
  const healed = await new Repository(d).init(); // 仍是恢复模式
  await healed.applyOperation('k-alpha', { operationId: 'op-p4', expectedVersion: 1, type: 'delay', payload: { extendMinutes: 5 } }, defA);
  const st = JSON.parse(await readFile(path.join(d, 'state.json'), 'utf8'));
  assert.equal(st.tasks['k-alpha'].version, 2, '恢复后写入应基于 bak 版本');
  const bakNow = JSON.parse(await readFile(path.join(d, 'state.json.bak'), 'utf8'));
  assert.equal(bakNow.tasks['k-alpha'].version, 2, '备份必须刷新为新快照（不是旧 v1）');
  assert.equal(healed.recoveredFromBackup, false, '成功写入后退出恢复模式');
});

// ---------- publisher ----------
const pdir = await tempDir('pub');
const pub = await new Publisher(pdir).init();
let committedGen = null;

await test('pub：preview 通过并给出 hash 与新增差异', async () => {
  const p = await pub.preview(sampleDef());
  assert.ok(p.ok, p.errors?.join(';'));
  assert.ok(p.hash);
  assert.deepEqual(p.diff.added.sort(), ['k-alpha', 'k-beta']);
});
await test('pub：坏定义 preview ok:false + errors，且未写任何文件', async () => {
  const bad = sampleDef();
  delete bad.tasks[0].title;
  const p = await pub.preview(bad);
  assert.ok(!p.ok);
  await assert.rejects(readFile(path.join(pdir, 'manifest.json')));
});
await test('pub：commit 成功（manifest+definition+无脚本 tasks.html）', async () => {
  const p = await pub.preview(sampleDef());
  const c = await pub.commit(sampleDef(), { previewHash: p.hash });
  assert.equal(c.status, 200);
  committedGen = c.generationId;
  const manifest = await pub.current();
  assert.equal(manifest.generationId, committedGen);
  assert.equal(manifest.tasks.length, 2);
  const html = await readFile(path.join(pdir, 'published', committedGen, 'tasks.html'), 'utf8');
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('任务A'));
});
await test('pub：重复发布同一内容 → alreadyPublished，不新增目录', async () => {
  const p = await pub.preview(sampleDef());
  const c = await pub.commit(sampleDef(), { previewHash: p.hash });
  assert.equal(c.alreadyPublished, true);
  assert.equal(c.generationId, committedGen);
});
await test('pub：预览后定义被改 → preview_hash_mismatch，manifest 不变', async () => {
  const p = await pub.preview(sampleDef());
  const changed = sampleDef();
  changed.tasks[0].title = '任务A（改）';
  const c = await pub.commit(changed, { previewHash: p.hash });
  assert.equal(c.status, 409);
  assert.equal((await pub.current()).generationId, committedGen);
});
await test('pub：发布中断（afterStageBuild）→ manifest 仍指旧版，无半套', async () => {
  const interrupted = new Publisher(pdir, { failAfter: 'afterStageBuild' });
  await interrupted.init();
  const changed = sampleDef();
  changed.tasks[0].title = '任务A（改）';
  const p = await interrupted.preview(changed);
  await assert.rejects(interrupted.commit(changed, { previewHash: p.hash }));
  assert.equal((await interrupted.current()).generationId, committedGen, 'manifest 必须仍指向上一版');
});
await test('pub：合法修订发布 → 新 generation，旧目录保留可追溯', async () => {
  const changed = sampleDef();
  changed.tasks[0].title = '任务A（修订）';
  changed.tasks[0].contentRevision = 2;
  const p = await pub.preview(changed);
  assert.ok(p.diff.changed.includes('k-alpha'));
  const c = await pub.commit(changed, { previewHash: p.hash });
  assert.equal(c.status, 200);
  assert.notEqual(c.generationId, committedGen);
  await readFile(path.join(pdir, 'published', committedGen, 'definition.json'), 'utf8'); // 旧版还在
});

// ---------- T-3 守卫（localStorage 垫片，不碰浏览器） ----------
await test('T-3：读到更高版本 → 数据返回展示、上写锁、saveData 拒绝', async () => {
  const cur = (await import('../../js/storage.js?sv')).SCHEMA_VERSION;
  const store = new Map([['taskCardData', JSON.stringify({ version: cur + 1, tasks: [{ id: 'x' }], lastResetDate: '2026-10-25' })]]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const mod = await import('../../js/storage.js?lock');
  const data = mod.loadData();
  assert.equal(data.version, cur + 1, '数据应原样返回供只读展示');
  assert.equal(mod.isSchemaLocked(), true);
  assert.equal(mod.saveData({ tasks: [], lastResetDate: 'x' }), false, '锁定期必须拒写');
  assert.equal(store.get('taskCardData').includes(`"version":${cur + 1}`), true, '磁盘数据不得被覆盖');
  delete globalThis.localStorage;
});
await test('T-3：v2 正常读写、不锁', async () => {
  const store2 = new Map([['taskCardData', JSON.stringify({ version: 2, tasks: [], lastResetDate: null })]]);
  globalThis.localStorage = {
    getItem: (k) => (store2.has(k) ? store2.get(k) : null),
    setItem: (k, v) => store2.set(k, String(v)),
    removeItem: (k) => store2.delete(k),
  };
  const mod = await import('../../js/storage.js?v2');
  assert.equal(mod.loadData().version, mod.SCHEMA_VERSION);
  assert.equal(mod.isSchemaLocked(), false);
  assert.equal(mod.saveData({ tasks: [], lastResetDate: null }), true);
  delete globalThis.localStorage;
});

// ---------- 清理 ----------
for (const d of trash) await rm(d, { recursive: true, force: true });
console.log(`SUMMARY pass=${passed} fail=${failed}`);
process.exit(failed ? 1 : 0);
