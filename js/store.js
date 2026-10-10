/**
 * js/store.js — 状态管理（应用的单一数据源）
 * 职责：
 *  1. 在内存中持有全部任务数据，是唯一可写的数据源；
 *  2. 提供任务的增删改查（CRUD）与状态机迁移方法；
 *  3. 内置极简发布/订阅：每次数据变化后先持久化，再广播 'change' 事件；
 *  4. 倒计时结束时额外广播 'task:expired' 事件（供视图层弹模态框）。
 *
 * 状态机：
 *   available（待接取）→ accepted（进行中）→ done（已完成）
 *        accepted --倒计时结束--> failed（失败）
 *        accepted/failed --手动搁置--> shelved（已搁置，归入失败栏）
 *        failed/shelved --重新接取--> available
 *
 * 倒计时设计：只存绝对截止时间戳 deadline，剩余时间由视图层实时计算：
 *   remaining = deadline - Date.now()
 */

import { loadData, saveData, loadLegacyStates, clearLegacy } from './storage.js';

/* ================= 事件总线（极简发布/订阅） ================= */

/** @type {Map<string, Set<Function>>} event -> 监听器集合 */
const listeners = new Map();

/**
 * 订阅事件。
 * @param {string} event 事件名（'change' | 'task:expired'）
 * @param {Function} handler 回调
 * @returns {Function} 取消订阅的函数
 */
export function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
}

/** 广播事件（内部使用） */
function emit(event, payload) {
    const set = listeners.get(event);
    if (set) set.forEach(fn => fn(payload));
}

/* ================= 内置示例任务 ================= */

/**
 * 首次启动（或数据损坏）时使用的默认任务。
 * pomodoros（番茄钟数）不在此存储，由视图层按 Math.ceil(suggestedTime / 25) 派生。
 */
const DEFAULT_TASKS = [
    {
        id: 't1',
        goal: '学习 JavaScript 基础',
        suggestion: '每天学习 30 分钟，结合实际项目练习',
        measures: '阅读 MDN 文档，完成 5 个练习题，写一个小应用',
        knowledge: '变量、函数、数组、对象、DOM 操作',
        suggestedTime: 30,
        priority: 'high',
        blockedBy: []
    },
    {
        id: 't2',
        goal: '完成 CSS 布局练习',
        suggestion: '从简单到复杂，逐步掌握各种布局方式',
        measures: '练习 Flexbox 和 Grid 布局，实现 3 个响应式页面',
        knowledge: 'Flexbox、Grid、响应式设计、媒体查询',
        suggestedTime: 45,
        priority: 'medium',
        blockedBy: []
    },
    {
        id: 't3',
        goal: '阅读技术文档',
        suggestion: '选择一个感兴趣的技术栈，深入阅读官方文档',
        measures: '每天阅读 20 页，做笔记，总结核心概念',
        knowledge: '文档阅读方法、技术选型、架构设计',
        suggestedTime: 60,
        priority: 'low',
        blockedBy: ['t1'] // 演示任务依赖：需先完成 t1
    }
];

/* ================= 内部状态 ================= */

/** 内存中的全部状态（唯一数据源） */
let state = {
    tasks: [],
    lastResetDate: null // 上次执行"每日重置"的日期（本地日期串）
};

/** 生成本地日期串，用于跨天判断（如 "2026-10-6"） */
function todayStr(d = new Date()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 字段补全：保证任何来源的任务对象都具备完整字段（容错） */
function normalizeTask(t) {
    return {
        id: t.id,
        goal: t.goal || '未命名任务',
        suggestion: t.suggestion || '',
        measures: t.measures || '',
        knowledge: t.knowledge || '',
        suggestedTime: Number(t.suggestedTime) > 0 ? Number(t.suggestedTime) : 25,
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
        status: t.status || 'available',
        deadline: typeof t.deadline === 'number' ? t.deadline : null, // 绝对时间戳
        shelveReason: t.shelveReason || '',
        createdAt: t.createdAt || Date.now(),
        acceptedAt: t.acceptedAt || null,
        completedAt: t.completedAt || null,
        failedAt: t.failedAt || null
    };
}

/** 持久化当前状态 */
function persist() {
    saveData({ tasks: state.tasks, lastResetDate: state.lastResetDate });
}

/** 持久化并广播变化（所有写操作的统一出口） */
function persistAndEmit(detail) {
    persist();
    emit('change', detail);
}

/* ================= 初始化与旧数据迁移 ================= */

/** 初始化：加载持久化数据；无数据则用默认任务兜底；随后执行每日重置检查 */
export function init() {
    const data = loadData();

    if (data && Array.isArray(data.tasks)) {
        // 正常分支：使用磁盘数据（逐条补全字段，容忍脏数据）
        state.tasks = data.tasks.map(normalizeTask);
        state.lastResetDate = data.lastResetDate || todayStr();
    } else {
        // 兜底分支：播种默认任务，并尝试迁移重构前的旧版状态
        state.tasks = DEFAULT_TASKS.map(normalizeTask);
        state.lastResetDate = todayStr();
        applyLegacyStates();
        persist();
    }

    dailyResetIfNeeded();
}

/**
 * 一次性迁移重构前旧版数据（localStorage 键 taskStates）。
 * 旧 id 1/2/3 按顺序映射到新 id t1/t2/t3：
 *   completed   -> done
 *   in-progress -> accepted（旧数据无 deadline，重新给予完整时长）
 *   pending     -> available（默认状态，无需处理）
 */
function applyLegacyStates() {
    const legacy = loadLegacyStates();
    if (!legacy) return;

    const idMap = { '1': 't1', '2': 't2', '3': 't3' };
    for (const [oldId, st] of Object.entries(legacy)) {
        const task = getTask(idMap[oldId]);
        if (!task || !st) continue;
        if (st.status === 'completed') {
            task.status = 'done';
            task.completedAt = Date.now();
        } else if (st.status === 'in-progress') {
            task.status = 'accepted';
            task.acceptedAt = Date.now();
            task.deadline = Date.now() + task.suggestedTime * 60 * 1000;
        }
    }
    clearLegacy(); // 迁移完成后清除旧数据，避免重复迁移
}

/* ================= 查询接口 ================= */

/** 获取全部任务（返回内部数组的引用，调用方请勿直接修改） */
export function getTasks() {
    return state.tasks;
}

/** 按 id 获取单个任务 */
export function getTask(id) {
    return state.tasks.find(t => t.id === id) || null;
}

/**
 * 获取某任务当前仍未完成的阻塞任务列表。
 * @param {object} task
 * @returns {Array} 未完成的阻塞任务对象数组（空数组表示未被阻塞）
 */
export function getBlockers(task) {
    return task.blockedBy
        .map(bid => getTask(bid))
        .filter(t => t && t.status !== 'done');
}

/* ================= CRUD ================= */

/**
 * 新增任务。
 * @param {object} fields 任务字段（id 可省略，自动生成）
 * @returns {object} 新建的任务
 */
export function addTask(fields) {
    const task = normalizeTask({
        ...fields,
        id: fields.id || `t${Date.now()}`,
        status: 'available'
    });
    state.tasks.push(task);
    persistAndEmit({ type: 'add', id: task.id });
    return task;
}

/**
 * 更新任务基础字段（不改状态机；状态迁移请用专用方法）。
 * @param {string} id
 * @param {object} patch 要合并的字段
 */
export function updateTask(id, patch) {
    const task = getTask(id);
    if (!task) return false;
    Object.assign(task, normalizeTask({ ...task, ...patch }));
    persistAndEmit({ type: 'update', id });
    return true;
}

/** 删除任务；同时把该 id 从其他任务的 blockedBy 中移除，避免悬空依赖 */
export function deleteTask(id) {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    state.tasks.splice(idx, 1);
    state.tasks.forEach(t => {
        t.blockedBy = t.blockedBy.filter(bid => bid !== id);
    });
    persistAndEmit({ type: 'delete', id });
    return true;
}

/* ================= 状态机迁移 ================= */

/**
 * 接取任务：available -> accepted。
 * 依赖检查：若 blockedBy 中存在未完成任务，则拒绝并返回阻塞列表。
 * @returns {{ ok:boolean, reason?:string, blockers?:Array }}
 */
export function acceptTask(id) {
    const task = getTask(id);
    if (!task || task.status !== 'available') {
        return { ok: false, reason: 'invalid-state' };
    }

    const blockers = getBlockers(task);
    if (blockers.length > 0) {
        return { ok: false, reason: 'blocked', blockers };
    }

    task.status = 'accepted';
    task.acceptedAt = Date.now();
    // 关键：只存绝对截止时间戳，不存剩余秒数
    task.deadline = Date.now() + task.suggestedTime * 60 * 1000;
    persistAndEmit({ type: 'accept', id });
    return { ok: true };
}

/** 完成任务：accepted -> done */
export function completeTask(id) {
    const task = getTask(id);
    if (!task || task.status !== 'accepted') return false;
    task.status = 'done';
    task.completedAt = Date.now();
    task.deadline = null;
    persistAndEmit({ type: 'complete', id });
    return true;
}

/**
 * 延时任务。
 *  - accepted：deadline 直接增加 ms；
 *  - failed / shelved：复活为 accepted，deadline 从当前时刻重新计算 ms。
 * @param {string} id
 * @param {number} ms 延时时长（毫秒）
 */
export function delayTask(id, ms) {
    const task = getTask(id);
    if (!task) return false;

    if (task.status === 'accepted' && task.deadline) {
        task.deadline += ms;
    } else if (task.status === 'failed' || task.status === 'shelved') {
        task.status = 'accepted';
        task.deadline = Date.now() + ms;
        task.failedAt = null;
        task.shelveReason = '';
    } else {
        return false;
    }
    persistAndEmit({ type: 'delay', id, ms });
    return true;
}

/**
 * 搁置任务：accepted/failed -> shelved，并记录可选的搁置原因。
 * 搁置任务归入失败任务栏。
 */
export function shelveTask(id, reason = '') {
    const task = getTask(id);
    if (!task || !['accepted', 'failed', 'shelved'].includes(task.status)) return false;
    task.status = 'shelved';
    task.shelveReason = reason;
    task.deadline = null;
    if (!task.failedAt) task.failedAt = Date.now();
    persistAndEmit({ type: 'shelve', id });
    return true;
}

/**
 * 判定失败：accepted -> failed（由 timer 在 deadline 到达时调用）。
 * 额外广播 'task:expired'，供视图层弹出"延时 / 搁置"模态框。
 */
export function failTask(id) {
    const task = getTask(id);
    if (!task || task.status !== 'accepted') return false;
    task.status = 'failed';
    task.failedAt = Date.now();
    task.deadline = null;
    persist();
    emit('change', { type: 'fail', id });
    emit('task:expired', { id });
    return true;
}

/** 重新接取：failed/shelved -> available（清空失败痕迹与 deadline） */
export function reacceptTask(id) {
    const task = getTask(id);
    if (!task || !['failed', 'shelved'].includes(task.status)) return false;
    task.status = 'available';
    task.deadline = null;
    task.failedAt = null;
    task.shelveReason = '';
    persistAndEmit({ type: 'reaccept', id });
    return true;
}

/**
 * 每日重置：每天首次调用（或跨天后的下一秒 tick）时执行。
 *  - 更新 lastResetDate；
 *  - 兜底：把跨天时仍挂着但 deadline 已过的任务判为 failed（即"移入失败任务栏"，
 *    视图层会将所有 failed/shelved 任务渲染到失败栏）。
 */
export function dailyResetIfNeeded() {
    const today = todayStr();
    if (state.lastResetDate === today) return;
    state.lastResetDate = today;

    const now = Date.now();
    state.tasks.forEach(t => {
        if (t.status === 'accepted' && t.deadline && t.deadline <= now) {
            t.status = 'failed';
            t.failedAt = now;
            t.deadline = null;
            emit('task:expired', { id: t.id });
        }
    });
    persistAndEmit({ type: 'daily-reset' });
}

/* ================= 数据导出 ================= */

/** 导出全部任务数据（JSON 字符串，供视图层触发下载） */
export function exportData() {
    return JSON.stringify(
        {
            version: 2,
                        exportedAt: (() => {
                const d = new Date();
                const pad = n => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
                       `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            })(),
            tasks: state.tasks
        },
        null,
        2
    );
}
