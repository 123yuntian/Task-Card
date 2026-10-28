// server/repository.mjs —— 派活执行/反馈/验收状态的唯一真源（场2 阶段3）
// 可靠写入四件套：单进程串行写队列 + 同目录 tmp 写入 fsync + 原子替换 + 可验证备份。
// 业务状态、版本号、幂等记录在「同一份快照」里一次提交——要么都在，要么都不在。
// Windows 语义：rename 失败即报错并保留旧文件；绝不以「先删旧文件」作为常规手段。
import { mkdir, readFile, copyFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { validateOperation } from './schema.mjs';

const STATE_FORMAT = 1;

export class RepositoryError extends Error {
  // kind: validation | version_conflict | operation_id_reuse | unknown_task | stale_review | corrupted | write_failed
  constructor(kind, detail) {
    super(kind);
    this.kind = kind;
    this.detail = detail;
  }
}

// 键排序的稳定序列化：幂等比较用，payload 字段顺序不同不算内容不同
function sortedReplacer(_k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return v;
}

function canonicalOp(key, op) {
  // expectedVersion 不进指纹：离线重试带着旧版本号回来时，同内容必须仍判为重放而不是 operation_id_reuse
  return JSON.stringify(
    { key, type: op.type, payload: op.payload || {} },
    sortedReplacer,
  );
}

export class Repository {
  constructor(dataDir, { failOnWrite = false } = {}) {
    this.dataDir = dataDir; // failOnWrite 仅供测试模拟「替换失败」
    this.stateFile = path.join(dataDir, 'state.json');
    this.backupFile = path.join(dataDir, 'state.json.bak');
    this.failOnWrite = failOnWrite;
    this.recoveredFromBackup = false;
    this.state = null;
    this.broken = null; // 主备双损时置位：只读报错，禁止清空或覆盖
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    const primary = await this.#loadFile(this.stateFile);
    if (primary.ok) {
      this.state = primary.data;
      return this;
    }
    // 主文件损坏：从上一份备份恢复；两边都没有（首次运行）才允许空状态起家。
    // 任何情况下都不用空数据覆盖磁盘上已存在的文件。
    const backup = await this.#loadFile(this.backupFile);
    if (backup.ok) {
      console.error('[repository] state.json 损坏，已从 state.json.bak 恢复；下次成功写入将覆盖坏文件');
      this.state = backup.data;
      this.recoveredFromBackup = true; // 恢复模式下 #persist 会保护备份不被坏主文件覆盖
      return this;
    }
    if (!primary.exists && !backup.exists) {
      this.state = { formatVersion: STATE_FORMAT, tasks: {}, operations: {} };
      return this;
    }
    this.broken = { reason: 'state_and_backup_corrupted', primary: primary.error, backup: backup.error };
    this.state = { formatVersion: STATE_FORMAT, tasks: {}, operations: {} };
    console.error('[repository] state.json 与备份均损坏：进入只读报错模式，不清空、不覆盖任何文件');
    return this;
  }

  async #loadFile(file) {
    let raw;
    try {
      raw = await readFile(file, 'utf8');
    } catch (e) {
      return { ok: false, exists: false, error: e.code };
    }
    try {
      const data = JSON.parse(raw);
      if (data && data.formatVersion === STATE_FORMAT && typeof data.tasks === 'object' && typeof data.operations === 'object') {
        return { ok: true, data };
      }
      return { ok: false, exists: true, error: 'bad_shape' };
    } catch {
      return { ok: false, exists: true, error: 'bad_json' };
    }
  }

  #enqueue(work) {
    const run = this.queue.then(() => work());
    this.queue = run.catch(() => {}); // 失败不阻断后续排队
    return run;
  }

  // 对外唯一写入口：key=dispatchKey，def=当日发布定义里的任务（首次操作建档用，由 main 提供）
  applyOperation(key, op, def = null) {
    return this.#enqueue(() => this.#apply(key, op, def));
  }

  async #apply(key, op, def) {
    if (this.broken) throw new RepositoryError('corrupted', this.broken);
    const v = validateOperation(op);
    if (!v.ok) throw new RepositoryError('validation', v.errors);
    if (typeof key !== 'string' || !key.trim()) throw new RepositoryError('validation', ['dispatchKey 不能为空']);

    // 幂等先行：同 ID 同内容回原结果；同 ID 不同内容拒绝（重放优先于版本冲突判断）
    const prior = this.state.operations[op.operationId];
    if (prior) {
      if (prior.canonical === canonicalOp(key, op)) {
        return { replayed: true, version: prior.version, result: prior.result };
      }
      throw new RepositoryError('operation_id_reuse', { operationId: op.operationId });
    }

    let task = this.state.tasks[key];
    const isNew = !task;
    if (isNew) {
      // 未发布（或非当日）的 key 没有定义可建档 → 拒绝，防止凭空写状态
      if (!def) throw new RepositoryError('unknown_task', { key });
      task = {
        version: 0,
        execution: 'available',
        assignmentId: def.id,
        title: def.title,
        minutes: def.minutes,
        contentRevision: def.contentRevision ?? 1,
        acceptanceStatus: 'not_submitted',
        deadline: null,
        history: [],
        feedback: [],
        reviews: [],
      };
    }
    if (op.expectedVersion !== task.version) {
      throw new RepositoryError('version_conflict', { current: task.version, expected: op.expectedVersion });
    }
    const effect = this.#effect(task, op, def); // 校验全部通过才建档：非法迁移同样不留内存幽灵
    if (isNew) this.state.tasks[key] = task;
    const next = { ...task, ...effect.patch, version: task.version + 1 };
    const record = {
      key,
      type: op.type,
      canonical: canonicalOp(key, op),
      at: Date.now(),
      version: next.version,
      result: effect.result,
    };
    this.state.tasks[key] = next;
    this.state.operations[op.operationId] = record;
    try {
      await this.#persist(op.operationId);
    } catch (err) {
      // 写盘失败回滚内存，让客户端带同一 operationId 重试；磁盘上旧数据原封不动
      if (isNew) delete this.state.tasks[key];
      else this.state.tasks[key] = task;
      delete this.state.operations[op.operationId];
      throw err;
    }
    return { replayed: false, version: next.version, result: effect.result };
  }

  // 纯函数：给定当前任务与操作，产出补丁与结果摘要（不碰磁盘）
  #effect(task, op, def) {
    const now = Date.now();
    const p = op.payload || {};
    const hist = { at: now, type: op.type, operationId: op.operationId };
    const illegal = (msg) => new RepositoryError('validation', [msg]);
    switch (op.type) {
      case 'accept': {
        if (task.execution !== 'available') throw illegal(`accept 只能从 available 发起（当前 ${task.execution}）`);
        const minutes = def?.minutes ?? task.minutes ?? 30;
        const deadline = now + minutes * 60000;
        return { patch: { execution: 'accepted', acceptedAt: now, deadline, history: [...task.history, hist] }, result: { type: 'accept', deadline } };
      }
      case 'complete': {
        if (task.execution !== 'accepted') throw illegal(`complete 只能从 accepted 发起（当前 ${task.execution}）`);
        return { patch: { execution: 'done', completedAt: now, deadline: null, history: [...task.history, hist] }, result: { type: 'complete', completedAt: now } };
      }
      case 'fail': {
        if (task.execution !== 'accepted') throw illegal(`fail 只能从 accepted 发起（当前 ${task.execution}）`);
        return { patch: { execution: 'failed', failedAt: now, history: [...task.history, hist] }, result: { type: 'fail', failedAt: now } };
      }
      case 'shelve': {
        if (task.execution !== 'available' && task.execution !== 'accepted') throw illegal(`shelve 只能从 available/accepted 发起（当前 ${task.execution}）`);
        return { patch: { execution: 'shelved', shelvedAt: now, shelveReason: typeof p.reason === 'string' ? p.reason : '', history: [...task.history, hist] }, result: { type: 'shelve' } };
      }
      case 'delay': {
        if (task.execution !== 'accepted') throw illegal(`delay 只能在 accepted 期间发起（当前 ${task.execution}）`);
        if (!task.deadline) throw illegal('当前无 deadline，无法延时');
        const nd = task.deadline + p.extendMinutes * 60000;
        return { patch: { deadline: nd, history: [...task.history, { ...hist, extendMinutes: p.extendMinutes }] }, result: { type: 'delay', deadline: nd } };
      }
      case 'expire': {
        if (task.execution !== 'accepted') throw illegal(`expire 只能从 accepted 发起（当前 ${task.execution}）`);
        return { patch: { execution: 'failed', failedAt: now, expired: true, history: [...task.history, { ...hist, serverTimestamp: now }] }, result: { type: 'expire', failedAt: now } };
      }
      case 'submit_feedback': {
        const fb = { at: now, operationId: op.operationId };
        if (p.text !== undefined) fb.text = p.text;
        if (p.answers !== undefined) fb.answers = p.answers;
        if (p.difficulty !== undefined) fb.difficulty = p.difficulty;
        if (p.actualMinutes !== undefined) fb.actualMinutes = p.actualMinutes;
        return { patch: { feedback: [...task.feedback, fb] }, result: { type: 'submit_feedback' } };
      }
      case 'import_ai_review': {
        const review = {
          id: `rev-${now.toString(36)}-${op.operationId}`,
          source: p.source,
          originalText: p.originalText,
          relatedContentRevision: p.relatedContentRevision,
          commitHash: p.commitHash ?? null,
          importedAt: now,
          status: 'pending',
          decidedAt: null,
        };
        return { patch: { acceptanceStatus: 'pending', reviews: [...task.reviews, review] }, result: { type: 'import_ai_review', reviewId: review.id, status: 'pending' } };
      }
      case 'confirm_ai_review': {
        const review = task.reviews.find(r => r.id === p.reviewId);
        if (!review) throw illegal(`找不到验收意见 ${p.reviewId}`);
        if (review.relatedContentRevision !== (def?.contentRevision ?? task.contentRevision)) throw new RepositoryError('stale_review', { reviewId: review.id });
        const reviews = task.reviews.map(r => (r.id === p.reviewId ? { ...r, status: p.verdict, decidedAt: now } : r));
        return { patch: { acceptanceStatus: p.verdict, reviews, history: [...task.history, hist] }, result: { type: 'confirm_ai_review', reviewId: p.reviewId, verdict: p.verdict } };
      }
      default:
        throw illegal(`未知操作类型 ${op.type}`);
    }
  }

  // 原子落盘：备份旧版 → tmp 写入 + fsync → rename 覆盖。任何一步失败旧文件保留。
  async #persist(context) {
    if (this.failOnWrite) throw new RepositoryError('write_failed', { simulated: true, context });
    const json = JSON.stringify(this.state, null, 2);
    const tmp = this.stateFile + '.tmp';
    try {
      // 恢复模式下跳过预备份：磁盘主文件仍是坏内容，不能让它覆盖唯一的好备份（评审问题1）
      if (!this.recoveredFromBackup) {
        await copyFile(this.stateFile, this.backupFile); // ENOENT（首次写入）直接忽略
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw new RepositoryError('write_failed', { step: 'backup', error: e.message });
    }
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(json, 'utf8');
      await handle.sync(); // 先刷盘再替换：断电语义下最多丢这一次，不会出现半截文件被当成正式数据
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, this.stateFile); // Windows 上等价 MoveFileEx(REPLACE_EXISTING)；失败则旧文件原样保留
    } catch (e) {
      throw new RepositoryError('write_failed', { step: 'rename', error: e.message, hint: '旧 state.json 未动，tmp 保留供诊断' });
    }
    if (this.recoveredFromBackup) {
      // 主文件已换成好数据：把备份一并刷新，退出恢复模式
      this.recoveredFromBackup = false;
      try {
        await copyFile(this.stateFile, this.backupFile);
      } catch { /* 备份刷新失败不影响主数据正确性 */ }
    }
  }

  snapshot(key) {
    const t = this.state.tasks[key];
    return t ? structuredClone(t) : null;
  }
}
