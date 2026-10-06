/**
 * js/render.js — 视图层
 * 职责：
 *  1. 订阅 store 的 'change' 事件做全量渲染（UI 是状态的投影）；
 *  2. 订阅 timer 的 tick 事件，仅就地刷新倒计时文本（避免整卡重建）；
 *  3. 事件委托：所有点击事件统一委托在 document.body 上，
 *     通过 data-action（操作类型）和 data-id（任务 id）识别目标；
 *  4. 负责模态框（延时选择 / 搁置原因 / 倒计时结束）、轻提示 toast、
 *     键盘快捷键（A 接取 / C 完成 / D 延时）与数据导出。
 *
 * 约束：本模块只能通过 store 暴露的方法修改数据，严禁直接改任务对象。
 */

import * as store from './store.js';
import * as timer from './timer.js';

/* ================= 常量与模块内状态 ================= */

/** 优先级 -> 文案与样式类映射 */
const PRIORITY = {
    high:   { text: '高', cls: 'priority-high' },
    medium: { text: '中', cls: 'priority-medium' },
    low:    { text: '低', cls: 'priority-low' }
};

/** DOM 挂载点引用（init 时缓存） */
let boardEl, failedEl, modalRoot, toastEl;

/** 当前"选中"的任务 id（鼠标悬停或点击卡片，供快捷键使用） */
let selectedId = null;

/**
 * 当前打开的模态框描述。
 * 形如 { type: 'delay' | 'shelve' | 'expired', taskId, fromExpired? }
 */
let currentModal = null;

/** 倒计时结束待处理的任务 id 队列（多个任务同时过期时逐个弹窗） */
const expiredQueue = [];

/** toast 自动隐藏定时器 */
let toastTimer = null;

/* ================= 初始化 ================= */

/** 初始化视图层：缓存挂载点、订阅事件、绑定委托监听、首次渲染 */
export function init() {
    boardEl   = document.getElementById('task-container');
    failedEl  = document.getElementById('failed-list');
    modalRoot = document.getElementById('modal-root');
    toastEl   = document.getElementById('toast');

    // 数据变化 -> 全量重渲染
    store.on('change', renderAll);
    // 倒计时结束 -> 进入过期弹窗队列
    store.on('task:expired', onTaskExpired);
    // 每秒 tick -> 就地刷新倒计时文本
    timer.onTick(updateCountdowns);

    // 事件委托：所有点击统一在 body 上处理
    document.body.addEventListener('click', handleClick);
    // 悬停选中卡片（键盘快捷键的作用目标）
    document.body.addEventListener('mouseover', handleHover);
    // 键盘快捷键
    document.addEventListener('keydown', handleKeydown);

    renderAll();
}

/* ================= 工具函数 ================= */

/** HTML 转义，防止用户输入（如搁置原因）注入 */
function esc(str = '') {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/** 毫秒 -> HH:MM:SS（倒计时不存剩余秒数，统一由 deadline - now 实时计算） */
function formatRemaining(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/* ================= 渲染 ================= */

/** 全量渲染：主看板（available/accepted/done）+ 失败任务栏（failed/shelved） */
function renderAll() {
    const tasks = store.getTasks();
    const active = tasks.filter(t => ['available', 'accepted', 'done'].includes(t.status));
    const failed = tasks.filter(t => ['failed', 'shelved'].includes(t.status));

    boardEl.innerHTML = active.map(cardHTML).join('') || '<p class="empty">暂无任务</p>';
    failedEl.innerHTML = failed.map(failedCardHTML).join('') || '<p class="empty">暂无失败任务</p>';

    // 重建 DOM 后立即刷新一次倒计时，避免闪烁
    updateCountdowns(Date.now());
}

/** 主看板任务卡片 HTML */
function cardHTML(task) {
    const p = PRIORITY[task.priority] || PRIORITY.medium;
    const blockers = store.getBlockers(task);
    const blocked = task.status === 'available' && blockers.length > 0;
    // 预估番茄钟数：按 25 分钟一个番茄钟向上取整
    const pomodoros = Math.max(1, Math.ceil(task.suggestedTime / 25));

    return `
    <div class="task-card status-${task.status}${selectedId === task.id ? ' selected' : ''}${blocked ? ' blocked' : ''}" data-id="${task.id}">
        <span class="priority-badge ${p.cls}" title="优先级">${p.text}</span>
        <div class="goal">${esc(task.goal)}</div>
        <div class="section">
            <div class="section-label">建议：</div>
            <div class="section-content">${esc(task.suggestion)}</div>
        </div>
        <div class="section">
            <div class="section-label">具体措施：</div>
            <div class="section-content">${esc(task.measures)}</div>
        </div>
        <div class="section">
            <div class="section-label">知识点：</div>
            <div class="section-content">${esc(task.knowledge)}</div>
        </div>
        ${blocked ? `<div class="blocked-hint">被「${blockers.map(t => esc(t.goal)).join('、')}」阻塞</div>` : ''}
        <div class="card-footer">
            <span class="time">建议 ${task.suggestedTime} 分钟</span>
            <span class="pomodoro">🍅 x${pomodoros}</span>
        </div>
        <div class="buttons">${buttonsHTML(task)}</div>
    </div>`;
}

/** 按状态生成按钮区：倒计时显示在原"接取"按钮位置，点击即可延时 */
function buttonsHTML(task) {
    switch (task.status) {
        case 'available':
            return `
                <button class="btn-accept" data-action="accept" data-id="${task.id}">接取</button>
                <button class="btn-complete" disabled>完成</button>`;
        case 'accepted':
            return `
                <button class="btn-delay" data-action="delay" data-id="${task.id}"
                        data-countdown="${task.id}" title="点击延时">--:--:--</button>
                <button class="btn-complete" data-action="complete" data-id="${task.id}">完成</button>
                <button class="btn-shelve" data-action="shelve" data-id="${task.id}">搁置</button>`;
        case 'done':
            return `
                <button class="btn-accept" disabled>已接取</button>
                <button class="btn-complete" disabled>已完成</button>`;
        default:
            return '';
    }
}

/** 失败任务栏卡片 HTML */
function failedCardHTML(task) {
    const when = task.failedAt ? new Date(task.failedAt).toLocaleString('zh-CN') : '-';
    return `
    <div class="task-card failed-card" data-id="${task.id}">
        <div class="goal">${esc(task.goal)}</div>
        <div class="fail-info">${task.status === 'shelved' ? '已搁置' : '已失败'} · ${when}</div>
        ${task.status === 'shelved'
            ? `<div class="fail-info">搁置原因：${esc(task.shelveReason) || '（未填写）'}</div>`
            : ''}
        <div class="buttons">
            <button class="btn-reaccept" data-action="reaccept" data-id="${task.id}">重新接取</button>
        </div>
    </div>`;
}

/** 每秒 tick：就地更新所有倒计时按钮的文本（不重建 DOM） */
function updateCountdowns(now) {
    for (const task of store.getTasks()) {
        if (task.status !== 'accepted' || !task.deadline) continue;
        const el = boardEl.querySelector(`[data-countdown="${CSS.escape(task.id)}"]`);
        if (el) el.textContent = formatRemaining(task.deadline - now);
    }
}

/* ================= 事件委托 ================= */

/** body 级点击委托：通过 data-action / data-id 分发 */
function handleClick(e) {
    // 点击卡片即选中（供快捷键使用）
    const card = e.target.closest('.task-card');
    if (card) {
        selectedId = card.dataset.id;
        markSelected();
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    switch (action) {
        case 'accept':
            acceptWithFeedback(id);
            break;
        case 'complete':
            store.completeTask(id);
            break;
        case 'delay':
            openDelayModal(id);
            break;
        case 'shelve':
            openShelveModal(id);
            break;
        case 'reaccept':
            store.reacceptTask(id);
            break;
        case 'export':
            exportJSON();
            break;
        case 'modal-cancel':
            closeModal();
            break;
        case 'modal-delay':
            applyModalDelay(Number(btn.dataset.min));
            break;
        case 'modal-shelve':
            // 过期弹窗中选择"搁置" -> 切换到搁置原因弹窗（队列流程不中断）
            if (currentModal) openShelveModal(currentModal.taskId, true);
            break;
        case 'modal-shelve-confirm':
            confirmShelve();
            break;
    }
}

/** 悬停卡片时更新选中态 */
function handleHover(e) {
    const card = e.target.closest('.task-card');
    if (card && card.dataset.id !== selectedId) {
        selectedId = card.dataset.id;
        markSelected();
    }
}

/**
 * 键盘快捷键：A 接取 / C 完成 / D 延时。
 * 作用于当前选中卡片；输入框聚焦或模态框打开时不响应。
 */
function handleKeydown(e) {
    if (currentModal || !selectedId) return;
    if (e.target.matches('input, textarea')) return;

    const task = store.getTask(selectedId);
    if (!task) return;

    const key = e.key.toLowerCase();
    if (key === 'a' && task.status === 'available') {
        acceptWithFeedback(selectedId);
    } else if (key === 'c' && task.status === 'accepted') {
        store.completeTask(selectedId);
    } else if (key === 'd' && task.status === 'accepted') {
        openDelayModal(selectedId);
    }
}

/** 接取并给出阻塞反馈（点击与快捷键共用） */
function acceptWithFeedback(id) {
    const result = store.acceptTask(id);
    if (!result.ok && result.reason === 'blocked') {
        const names = result.blockers.map(t => t.goal).join('、');
        toast(`无法接取：被「${names}」阻塞`);
    }
}

/** 高亮当前选中卡片 */
function markSelected() {
    document.querySelectorAll('.task-card.selected').forEach(el => el.classList.remove('selected'));
    if (!selectedId) return;
    const el = document.querySelector(`.task-card[data-id="${CSS.escape(selectedId)}"]`);
    if (el) el.classList.add('selected');
}

/* ================= 模态框 ================= */

/** 生成模态框外壳 HTML */
function overlayHTML(inner) {
    return `<div class="modal-overlay"><div class="modal">${inner}</div></div>`;
}

/** 延时弹窗：延时 30 分钟 / 1 小时 */
function openDelayModal(taskId) {
    currentModal = { type: 'delay', taskId };
    modalRoot.innerHTML = overlayHTML(`
        <h3>选择延时时长</h3>
        <div class="modal-buttons">
            <button data-action="modal-delay" data-min="30">延时 30 分钟</button>
            <button data-action="modal-delay" data-min="60">延时 1 小时</button>
            <button class="ghost" data-action="modal-cancel">取消</button>
        </div>`);
}

/**
 * 搁置弹窗：可选填写搁置原因。
 * @param {string} taskId
 * @param {boolean} fromExpired 是否来自"倒计时结束"流程（影响确认后的队列推进）
 */
function openShelveModal(taskId, fromExpired = false) {
    currentModal = { type: 'shelve', taskId, fromExpired };
    modalRoot.innerHTML = overlayHTML(`
        <h3>搁置任务</h3>
        <p class="modal-tip">可填写搁置原因（可选）：</p>
        <input id="shelve-reason-input" type="text" placeholder="例如：等待外部依赖…" maxlength="50">
        <div class="modal-buttons">
            <button data-action="modal-shelve-confirm">确认搁置</button>
            <button class="ghost" data-action="modal-cancel">取消</button>
        </div>`);
    const input = modalRoot.querySelector('#shelve-reason-input');
    if (input) input.focus();
}

/** store 广播的过期事件：入队，空闲时弹出 */
function onTaskExpired({ id }) {
    expiredQueue.push(id);
    if (!currentModal) showNextExpired();
}

/** 逐个弹出"倒计时结束"模态框（延时 / 搁置，二选一，不提供取消） */
function showNextExpired() {
    const id = expiredQueue.shift();
    if (!id) return;
    const task = store.getTask(id);
    if (!task) { showNextExpired(); return; }

    currentModal = { type: 'expired', taskId: id };
    modalRoot.innerHTML = overlayHTML(`
        <h3>任务「${esc(task.goal)}」倒计时结束</h3>
        <p class="modal-tip">任务已标记为失败，你可以选择：</p>
        <div class="modal-buttons">
            <button data-action="modal-delay" data-min="30">延时 30 分钟</button>
            <button data-action="modal-delay" data-min="60">延时 1 小时</button>
            <button class="danger" data-action="modal-shelve">搁置</button>
        </div>`);
}

/** 模态框中确认延时：failed 任务会被 store.delayTask 复活为进行中 */
function applyModalDelay(min) {
    if (!currentModal) return;
    const wasExpired = currentModal.type === 'expired';
    store.delayTask(currentModal.taskId, min * 60 * 1000);
    closeModal();
    if (wasExpired) showNextExpired(); // 推进过期队列
}

/** 模态框中确认搁置 */
function confirmShelve() {
    if (!currentModal) return;
    const input = modalRoot.querySelector('#shelve-reason-input');
    const reason = input ? input.value.trim() : '';
    const { taskId, fromExpired } = currentModal;
    store.shelveTask(taskId, reason);
    closeModal();
    if (fromExpired) showNextExpired();
}

/** 关闭模态框；若过期队列仍有待处理项则继续弹出 */
function closeModal() {
    currentModal = null;
    modalRoot.innerHTML = '';
    if (expiredQueue.length) showNextExpired();
}

/* ================= 轻提示与导出 ================= */

/** 底部轻提示，3 秒自动消失 */
function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

/** 导出全部任务数据为 task-data.json 并触发下载 */
function exportJSON() {
    const blob = new Blob([store.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'task-data.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 task-data.json');
}
