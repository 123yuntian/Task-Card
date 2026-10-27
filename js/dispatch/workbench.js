/**
 * js/dispatch/workbench.js — 今日派活工作台（today.html 与 index.html 的「今日派活」面板共用）
 * 约束：
 *  - 所有文本一律 textContent / 属性赋值，不拼 innerHTML；历史说明页只经 sandbox="" 的 iframe 展示。
 *  - 不写循环定时器（P-003）；刷新由加载、窗口聚焦、手动按钮、操作完成触发。toast 用一次性 setTimeout。
 *  - 每个任务块只创建一次，刷新只更新槽位内容；反馈输入框创建后不再重建，且节点顺序不变时不重排，
 *    所以输入到一半的草稿、焦点和滚动位置不会因刷新丢失。
 *  - 服务端状态操作成功后，读取最新执行快照，经 upsertDispatchTask 按 dispatchKey
 *    投影成看板 'dp:' 卡，再由 applyTaskCommand 确认执行态并报告本地保存结果。
 *    页面加载不批量导入；看板按钮只写本地，反向同步留待阶段7。
 */

import { fetchToday, fetchGenerations, postOperation } from './api.js';
import { init, upsertDispatchTask, applyTaskCommand } from '../store.js';

const EXEC_LABEL = { available: '待接取', accepted: '进行中', done: '已完成', failed: '已失败', shelved: '已搁置' };
const ACCEPT_LABEL = {
  not_submitted: '尚未提交验收',
  pending: '有 AI 验收意见，等你确认',
  passed: '验收通过',
  changes_requested: '验收要求修改',
};
const REVIEW_LABEL = { pending: '待确认', passed: '通过', changes_requested: '要求修改' };
const OP_LABEL = {
  accept: '接取', complete: '完成', fail: '标记失败', shelve: '搁置', delay: '延时', expire: '超时失败',
  submit_feedback: '提交反馈', import_ai_review: '导入验收意见', confirm_ai_review: '确认验收',
};

const pad = (n) => String(n).padStart(2, '0');
// P-006：给人看的时间一律本地字段拼接，不用 toISOString
const fmtClock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtDateTime = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

function newOperationId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// AGENTS.md §3.6：复制用 execCommand，失败再退到 clipboard API
async function copyText(text) {
  const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;left:-9999px;top:0;opacity:0' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (!ok && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
  }
  return ok;
}

let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/**
 * 挂载工作台。container 必须是独立容器（today.html 的 #app，或 index.html 的 #dispatch-panel），
 * 绝不能是 render.js 会整块重建的 #task-container / #failed-list。
 * isActive：容器不可见时返回 false，窗口聚焦时就不做无谓刷新。
 */
export function mount(container, { isActive = () => true } = {}) {
  const statusBar = h('div', { class: 'wb-status', role: 'status', 'aria-live': 'polite' });
  const noticeEl = h('section', { class: 'wb-section wb-notice', hidden: true });
  const goalEl = h('section', { class: 'wb-section wb-goal', hidden: true });
  const tasksEl = h('div', { class: 'wb-tasks' });
  const docSec = h('details', { class: 'wb-section wb-doc' },
    h('summary', { text: '完整说明（发布原文，只读）' }),
    h('p', { class: 'wb-muted', text: '以下是发布器生成的历史 HTML，在禁脚本沙箱里展示，仅用于核对原文；复制与反馈请用上方各任务区。' }));
  const historySec = buildHistorySection();
  container.append(h('div', { class: 'wb-root' }, statusBar, noticeEl, goalEl, tasksEl, docSec, historySec.el));

  const blocks = new Map();     // dispatchKey -> 任务块（只创建一次；刷新只更新槽位）
  const pendingIds = new Map(); // 同一操作重试复用 operationId，服务端按幂等重放
  let snapshot = null;          // 最近一次成功取到的 /api/today（断连时保留上次内容）
  let connected = false;
  let syncing = false;
  let rerun = false;
  let lastSyncAt = null;
  let docGeneration = null;
  let docFrame = null;

  /** 状态行：同步状态 + 发布日期 + 内容修订号（要求的三项都在这一行） */
  function updateStatus() {
    const parts = [];
    if (syncing) parts.push('同步中…');
    else if (connected) parts.push(`已连接 · 上次同步 ${lastSyncAt ? fmtClock(lastSyncAt) : '—'}`);
    else parts.push('未连接本地服务（GitHub Pages 纯静态模式无派活数据）');
    if (snapshot?.published) {
      parts.push(`发布日期 ${snapshot.date}`, `内容修订 r${snapshot.contentRevision}`,
        `版本 ${snapshot.generationId}`, `发布于 ${fmtDateTime(snapshot.publishedAt ?? 0)}`);
    }
    statusBar.replaceChildren(h('span', { text: parts.join(' · ') }));
  }

  async function refresh() {
    if (syncing) { rerun = true; return; }
    syncing = true; updateStatus();
    const data = await fetchToday();
    syncing = false;
    connected = data.ok;
    if (data.ok) { snapshot = data; lastSyncAt = Date.now(); renderAll(); }
    updateStatus(); // 成败都刷新状态行；断连时保留上次视图，只改这一行
    if (rerun) { rerun = false; refresh(); }
  }

  function renderAll() {
    if (!snapshot.published) { renderEmpty(); return; }
    noticeEl.hidden = true;
    renderGoal();
    reconcileBlocks();
    renderDoc();
    historySec.update(snapshot, connected);
  }

  function renderEmpty() {
    goalEl.hidden = true; tasksEl.replaceChildren(); docSec.hidden = true;
    noticeEl.hidden = false;
    noticeEl.replaceChildren(
      h('h3', { text: `今日尚未发布（${snapshot.date}，服务端 Asia/Shanghai）` }),
      h('p', { text: '今天还没有发布任何派活内容；这里不会拿别的日期的任务冒充今天。等发布后再来，或到本地服务窗口用发布命令导入。' }),
    );
    historySec.update(snapshot, connected);
    historySec.load(); // 空态时直接展开历史，给出路
  }

  function renderGoal() {
    const ts = snapshot.tasks;
    const doneCount = ts.filter(t => t.execution.execution === 'done').length;
    const planMin = ts.reduce((s, t) => s + (t.definition.minutes || 0), 0);
    const fedMin = ts.reduce((s, t) => s + (t.execution.feedback ?? []).reduce((x, f) => x + (f.actualMinutes || 0), 0), 0);
    const itemized = ts.map(t => `「${t.definition.title}」${EXEC_LABEL[t.execution.execution] || t.execution.execution}`).join('；');
    goalEl.hidden = false;
    goalEl.replaceChildren(
      h('h3', { text: `今日目标与用时：${ts.length} 项 · 计划 ${planMin} 分钟 · 已完成 ${doneCount}/${ts.length} · 实际反馈累计 ${fedMin} 分钟` }),
      h('p', { class: 'wb-muted', text: itemized }),
    );
  }

  function renderDoc() {
    if (docGeneration === snapshot.generationId) return;
    docGeneration = snapshot.generationId;
    docSec.hidden = false;
    docFrame = h('iframe', {
      sandbox: '', class: 'wb-doc-frame', title: '派活说明（沙箱只读）',
      src: `/api/generations/${encodeURIComponent(snapshot.generationId)}/tasks.html`,
    });
    const old = docSec.querySelector('.wb-doc-frame');
    if (old) old.replaceWith(docFrame); else docSec.append(docFrame);
  }

  function reconcileBlocks() {
    const keys = new Set();
    snapshot.tasks.forEach((item, i) => {
      const key = item.definition.dispatchKey;
      keys.add(key);
      let b = blocks.get(key);
      if (!b) { b = buildBlock(item, i); blocks.set(key, b); }
      updateBlock(b, item, i);
    });
    for (const [k, b] of blocks) if (!keys.has(k)) { b.el.remove(); blocks.delete(k); }
    const want = snapshot.tasks.map(t => blocks.get(t.definition.dispatchKey).el);
    const same = tasksEl.children.length === want.length
      && Array.from(tasksEl.children).every((el, i) => el === want[i]);
    if (!same) tasksEl.replaceChildren(...want); // 顺序有变才重挂，避免无谓 blur/滚动跳动
  }

  /** 单个任务块：结构固定为 概要 → 步骤与提示词 → 操作按钮 → 验证条件 → 反馈与验收 → 最近活动 */
  function buildBlock(item, order) {
    const def = item.definition;
    const badge = h('span', { class: `wb-badge wb-exec-${item.execution.execution}`,
      text: EXEC_LABEL[item.execution.execution] || item.execution.execution });
    const stepsSlot = h('div', { class: 'wb-slot wb-steps-slot' });
    const actionsSlot = h('div', { class: 'wb-slot wb-actions' });
    const acceptSlot = h('div', { class: 'wb-slot wb-accept-slot' });
    const fb = buildFeedback(def);
    const activitySlot = h('ul', { class: 'wb-activity' });
    const el = h('details', { class: 'wb-task', open: item.execution.execution !== 'done', 'data-key': def.dispatchKey },
      h('summary', { class: 'wb-task-summary' }, h('span', { class: 'wb-task-title', text: def.title }), badge),
      stepsSlot, actionsSlot, acceptSlot, fb.el, h('h4', { text: '最近活动' }), activitySlot,
    );
    return { el, key: def.dispatchKey, badge, stepsSlot, actionsSlot, acceptSlot, fb, activitySlot, item, order, sig: '', lastExec: '' };
  }

  function buildFeedback(def) {
    const ta = h('textarea', { class: 'wb-input wb-fb-text', rows: 3,
      placeholder: '执行记录 / 遇到什么问题 / 怎么解决的（会随任务归档，写给第二天的自己）' });
    const difficulty = h('select', { class: 'wb-input wb-fb-diff', 'aria-label': '难度 1-5，可选' },
      h('option', { value: '', text: '难度（可选 1-5）' }),
      ...[1, 2, 3, 4, 5].map(n => h('option', { value: n, text: `${'★'.repeat(n)}（${n}）` })),
    );
    const actual = h('input', { class: 'wb-input wb-fb-min', type: 'number', min: '0', max: '1440',
      placeholder: '实际用时（分钟，可选）', 'aria-label': '实际用时分钟数，可选' });
    const list = h('ul', { class: 'wb-fb-list' });
    const reviews = h('div', { class: 'wb-reviews' });
    const btn = h('button', { class: 'wb-btn wb-btn-ghost', type: 'button', text: '提交反馈' });
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const text = ta.value.trim();
      if (!text && !difficulty.value && actual.value === '') { toast('至少填一项再提交反馈'); return; }
      const payload = {};
      if (text) payload.text = text;
      if (difficulty.value) payload.difficulty = Number(difficulty.value);
      if (actual.value !== '') payload.actualMinutes = Number(actual.value);
      btn.disabled = true; btn.textContent = '提交中...';
      const r = await send(def.dispatchKey, 'submit_feedback', payload);
      btn.disabled = false; btn.textContent = '提交反馈';
      if (r.ok) { ta.value = ''; difficulty.value = ''; actual.value = ''; }
    });
    const el = h('section', { class: 'wb-feedback' },
      h('h4', { text: '反馈与验收' }), reviews, list,
      h('div', { class: 'wb-fb-form' }, difficulty, actual, btn), ta,
    );
    return { el, ta, difficulty, actual, list, reviews };
  }

  async function send(key, type, payload = {}) {
    const block = blocks.get(key);
    if (!block) return { ok: false };
    const sig = JSON.stringify(payload);
    const cacheKey = `${key}|${type}|${block.item.execution.version}|${sig}`;
    let opId = pendingIds.get(cacheKey);
    if (!opId) { opId = newOperationId(); pendingIds.set(cacheKey, opId); }
    const op = { operationId: opId, expectedVersion: block.item.execution.version, type, payload };
    const result = await postOperation(key, op);
    if (result.ok) {
      pendingIds.delete(cacheKey);
      if (['accept', 'complete', 'fail', 'delay', 'shelve'].includes(type)) {
        const latest = await fetchToday();
        const item = latest.ok && latest.published
          ? latest.tasks.find(t => t.definition.dispatchKey === key) : null;
        if (!item) {
          toast('已同步服务端，但无法读取最新状态，本地尚未同步');
          refresh();
          return { ok: true, saved: false };
        }
        // today.html 不运行 app.js，写入前先加载原有任务，避免用空内存覆盖看板。
        init();
        upsertDispatchTask(item.definition, item.execution);
        const local = applyTaskCommand({
          type, dispatchKey: key,
          payload: { ...payload, deadline: result.data.result?.deadline ?? item.execution.deadline, execution: item.execution },
        });
        toast(local.saved === false ? '已同步服务端，但本地保存失败' : `${OP_LABEL[type] || type}成功`);
        refresh();
        return { ok: true, saved: local.saved };
      }
      toast(`${OP_LABEL[type] || type}成功`);
      refresh();
      return { ok: true };
    }
    // 只保留「网络失败」的重试同号（可安全重放）；服务端明确拒绝的换新号，避免触发 operation_id_reuse
    if (result.error !== 'network') pendingIds.delete(cacheKey);
    const hint = {
      version_conflict: '任务状态已被别处更新，已重新拉取，请重试',
      unknown_task: '任务不在当日发布清单里，已重新拉取',
      network: '本地服务未连接，稍后请重试（离线补交在阶段7）',
    }[result.error] || result.error;
    toast(`${OP_LABEL[type] || type}失败：${hint}`);
    if (result.error === 'version_conflict' || result.error === 'unknown_task') refresh();
    return { ok: false };
  }

  function updateBlock(b, item, order) {
    const def = item.definition;
    const exec = item.execution;
    b.item = item; b.order = order;
    b.badge.className = `wb-badge wb-exec-${exec.execution}`;
    b.badge.textContent = EXEC_LABEL[exec.execution] || exec.execution;
    if (b.lastExec !== 'done' && exec.execution === 'done') b.el.open = false; // 完成那一刻折叠，之后尊重手动开关
    b.lastExec = exec.execution;
    renderSteps(b, def);
    renderActions(b, item);
    renderAccept(b, item);
    renderFeedback(b, exec, def);
    renderActivity(b, exec);
  }

  function renderSteps(b, def) {
    const steps = Array.isArray(def.steps) ? def.steps : (def.steps ? [def.steps] : []);
    const sig = JSON.stringify([def.title, def.why, steps, def.prompt]);
    if (sig === b.sig) return;
    b.sig = sig;
    const kids = [];
    if (def.why) kids.push(h('p', { class: 'wb-why', text: `为什么做：${def.why}` }));
    if (steps.length) kids.push(h('ol', { class: 'wb-steps', title: '任务步骤' },
      ...steps.map(s => h('li', { text: s }))));
    if (def.prompt) {
      kids.push(h('div', { class: 'wb-prompt-row' },
        h('pre', { class: 'wb-prompt', text: def.prompt }),
        h('button', {
          class: 'wb-btn wb-btn-copy', type: 'button', text: '复制提示词',
          onclick: async () => toast((await copyText(def.prompt)) ? '提示词已复制' : '复制失败，请手动选择 pre 里的文本'),
        }),
      ));
    } else {
      kids.push(h('p', { class: 'wb-muted', text: '本任务没有附带提示词。' }));
    }
    b.stepsSlot.replaceChildren(...kids);
  }

  function renderActions(b, item) {
    const { definition: def, execution: exec } = item;
    const kids = [h('span', { class: 'wb-meta',
      text: `预计 ${def.minutes} 分钟 · 内容修订 r${def.contentRevision ?? 1} · ${def.dispatchKey}` })];
    if (exec.execution === 'available') {
      kids.push(h('button', { class: 'wb-btn wb-btn-primary', type: 'button', text: '接取任务',
        onclick: () => send(def.dispatchKey, 'accept') }));
    } else if (exec.execution === 'accepted') {
      const overdue = exec.deadline && Date.now() > exec.deadline;
      if (exec.deadline) kids.push(h('span', { class: `wb-deadline${overdue ? ' wb-overdue' : ''}`,
        text: overdue ? `已超过截止 ${fmtDateTime(exec.deadline)}` : `截止 ${fmtDateTime(exec.deadline)}` }));
      kids.push(
        h('button', { class: 'wb-btn', type: 'button', text: '标记失败', onclick: () => send(def.dispatchKey, 'fail') }),
        h('button', { class: 'wb-btn wb-btn-primary', type: 'button', text: '完成', onclick: () => send(def.dispatchKey, 'complete') }),
      );
    } else if (exec.execution === 'done') {
      kids.push(h('span', { class: 'wb-muted', text: exec.completedAt ? `完成于 ${fmtDateTime(exec.completedAt)}` : '' }));
    } else if (exec.execution === 'failed') {
      kids.push(h('span', { class: 'wb-muted', text: exec.failedAt ? `失败于 ${fmtDateTime(exec.failedAt)}` : '' }));
    } else if (exec.execution === 'shelved') {
      kids.push(h('span', { class: 'wb-muted', text: `已搁置${exec.shelveReason ? `：${exec.shelveReason}` : ''}` }));
    }
    if (!connected) kids.push(h('span', { class: 'wb-muted', text: '· 服务未连接，操作暂不可用' }));
    b.actionsSlot.replaceChildren(...kids);
    for (const btn of b.actionsSlot.querySelectorAll('button')) btn.disabled = !connected;
  }

  function renderAccept(b, item) {
    const { definition: def, execution: exec } = item;
    const lines = [`验收条件：${def.acceptance || '（发布时未填，导入后需补）'}`];
    lines.push(`验收状态：${ACCEPT_LABEL[exec.acceptanceStatus] || exec.acceptanceStatus}`);
    for (const r of exec.reviews ?? []) {
      const stale = r.relatedContentRevision !== (def.contentRevision ?? 1);
      lines.push(`AI 意见 [${REVIEW_LABEL[r.status] || r.status}] 来自 ${r.source}，针对 r${r.relatedContentRevision}`
        + `${stale ? '（旧修订，仅供参考）' : ''}${r.decidedAt ? `，${fmtDateTime(r.decidedAt)} 已确认` : '，待确认'}`);
    }
    lines.push('注：「完成」只代表本次执行结束，是否达标以验收确认为准；确认按钮在阶段 8 接入。');
    b.acceptSlot.replaceChildren(...lines.map(t => h('p', { class: 'wb-accept-line', text: t })));
  }

  function renderFeedback(b, exec, def) {
    b.fb.list.replaceChildren(
      ...(exec.feedback ?? []).map(fb => h('li', {},
        h('span', { class: 'wb-muted', text: fmtDateTime(fb.at) }),
        fb.difficulty != null ? ` 难度 ${fb.difficulty}/5` : '',
        fb.actualMinutes != null ? ` 用时 ${fb.actualMinutes} 分钟` : '',
        fb.text ? h('div', { class: 'wb-fb-text', text: fb.text }) : null,
      )),
    );
    if (!(exec.feedback ?? []).length) b.fb.list.append(h('li', { class: 'wb-muted', text: '还没有提交过反馈。' }));
  }

  function renderActivity(b, exec) {
    const items = [];
    for (const hist of exec.history ?? []) {
      items.push({ at: hist.at, text: OP_LABEL[hist.type] || hist.type, extra: hist.type === 'delay' ? ` +${hist.extendMinutes} 分钟` : '' });
    }
    for (const fb of exec.feedback ?? []) items.push({ at: fb.at, text: '提交反馈' });
    for (const r of exec.reviews ?? []) items.push({ at: r.importedAt, text: `导入验收意见（r${r.relatedContentRevision}）` });
    items.sort((x, y) => y.at - x.at);
    b.activitySlot.replaceChildren(...items.slice(0, 8).map(it => h('li', {},
      h('span', { class: 'wb-muted', text: `${fmtDateTime(it.at)} · ` }), it.text + (it.extra || ''))));
    if (!items.length) b.activitySlot.append(h('li', { class: 'wb-muted', text: '暂无活动记录。' }));
  }


  window.addEventListener('focus', () => { if (isActive()) refresh(); });
  refresh();
  return { refresh };
}

/** 历史版本区：入口常驻页面底部；列表懒加载；点开任一版本 → 只读沙箱 iframe，明确标注非今日 */
function buildHistorySection() {
  const status = h('p', { class: 'wb-muted' });
  const listEl = h('ul', { class: 'wb-history-list' });
  const viewerLabel = h('p', { class: 'wb-history-label', hidden: true });
  let viewerFrame = null;
  let loaded = false;
  const el = h('details', { class: 'wb-section wb-history' },
    h('summary', { text: '历史发布（只读，非今日）' }), status, listEl, viewerLabel);

  async function load() {
    if (loaded) return;
    status.textContent = '加载历史...';
    const gens = await fetchGenerations();
    loaded = true;
    if (gens === null) { status.textContent = '服务未连接，暂时取不到历史。'; return; }
    if (!gens.length) { status.textContent = '还没有任何历史发布。'; return; }
    status.textContent = `共 ${gens.length} 个版本（新→旧）。点开只作查看，不会当作今日任务。`;
    listEl.replaceChildren(...gens.map(g => h('li', {},
      h('button', {
        class: 'wb-btn wb-btn-ghost wb-history-item', type: 'button',
        text: `${g.date} · ${g.taskCount} 项${g.current ? ' · 当前版' : ''}（${g.generationId}）`,
        onclick: () => show(g),
      }),
    )));
  }

  function show(g) {
    if (viewerFrame) viewerFrame.remove();
    viewerLabel.hidden = false;
    viewerLabel.textContent = `正在查看 ${g.date} 的历史版本 ${g.generationId} —— 这不是今天的任务，只读不可操作。`;
    viewerFrame = h('iframe', {
      sandbox: '', class: 'wb-doc-frame wb-history-frame', title: `历史派活 ${g.date}（沙箱只读）`,
      src: `/api/generations/${encodeURIComponent(g.generationId)}/tasks.html`,
    });
    el.append(viewerFrame);
  }

  return { el, load, update(snap, conn) {
    // 空态已自动 load；有今日内容时仍保留入口，但提示当前正看的可能过期
    if (!conn) status.textContent = '（服务未连接，历史列表可能不是最新）';
    else if (!loaded) status.textContent = '展开可查看以前发布过的版本。';
  } };
}

// index.html 侧的「今日派活」面板接线：按钮懒挂载；容器独立于 #task-container，显示/隐藏不销毁 DOM，
// 折叠期间输入的草稿在重新展开后仍在
export function setupPanel(toggleBtn, panel) {
  let mounted = false;
  let api = null;
  toggleBtn.addEventListener('click', async () => {
    const willShow = panel.hidden;
    panel.hidden = !willShow;
    toggleBtn.setAttribute('aria-expanded', String(willShow));
    if (willShow) {
      if (!mounted) {
        mounted = true;
        api = mount(panel, { isActive: () => !panel.hidden });
      } else {
        api.refresh();
      }
    }
  });
}



