/**
 * js/storage.js — 数据持久层
 * 职责：
 *  1. 封装 localStorage 的读写；
 *  2. 负责 JSON 序列化 / 反序列化；
 *  3. 数据版本管理与迁移（migrate）；
 *  4. 异常容错：任何读写失败都不会让应用崩溃，返回 null / false 并打印错误。
 *
 * 注意：本模块不关心业务字段含义，只做"安全地存取一份数据"。
 */

/** 新版数据的存储键名 */
const STORAGE_KEY = 'taskCardData';

/** 旧版（重构前）数据的存储键名，用于一次性迁移 */
const LEGACY_KEY = 'taskStates';

/** 当前数据结构版本号。未来变更数据结构时必须 +1 并在 migrate() 中补充分支 */
export const SCHEMA_VERSION = 3;

/** T-3 只读锁：读到高于本程序支持的数据版本时置位，saveData 从此拒绝一切写入 */
let higherVersionLocked = false;

export function isSchemaLocked() {
    return higherVersionLocked;
}

/**
 * 读取持久化数据。
 * @returns {{ version:number, tasks:Array, lastResetDate:string } | null}
 *          数据不存在或损坏时返回 null（调用方应使用默认数据兜底）。
 */
export function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;

        // 版本匹配则直接返回；否则尝试迁移
        if (parsed.version === SCHEMA_VERSION) return parsed;
        // T-3 守卫：数据版本高于本程序（典型场景：新版程序写过 v3 后程序被回滚）。
        // 绝不能走 migrate→null→播种默认→persist 的老路，那条路会用默认数据覆盖真实数据
        if (typeof parsed.version === 'number' && parsed.version > SCHEMA_VERSION) {
            higherVersionLocked = true;
            console.error('[storage] 检测到 v' + parsed.version + ' 数据（本程序仅支持 v' + SCHEMA_VERSION +
                '），进入只读保护：数据照常显示，但拒绝一切写入。请换回新版程序，或用导出备份恢复。');
            return parsed;
        }
        return migrate(parsed);
    } catch (err) {
        // JSON 解析失败 / localStorage 被禁用等情况
        console.error('[storage] 读取数据失败，将使用默认数据：', err);
        return null;
    }
}

/**
 * 写入持久化数据（自动附带版本号）。
 * @param {{ tasks:Array, lastResetDate:string }} data
 * @returns {boolean} 是否写入成功
 */
export function saveData(data) {
    if (higherVersionLocked) {
        // 只读保护（T-3）：返回 false 让上层知道没保存，而不是静默丢弃或覆盖
        console.error('[storage] 只读保护中（数据版本高于本程序），已拒绝写入。');
        return false;
    }
    try {
        const payload = { version: SCHEMA_VERSION, ...data };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return true;
    } catch (err) {
        // 常见原因：隐私模式 / 存储空间超限（QuotaExceededError）
        console.error('[storage] 写入数据失败：', err);
        return false;
    }
}

/**
 * 版本迁移入口。
 * 当磁盘数据版本低于 SCHEMA_VERSION 时，逐级升级到最新结构。
 * @param {object} oldData 旧版本数据
 * @returns {object|null} 迁移后的数据；无法识别时返回 null
 */
function migrate(oldData) {
    // v1 -> v2 示例：v1 没有 version 字段，任务直接挂在 tasks 上
    if (oldData && Array.isArray(oldData.tasks) && !oldData.version) {
        console.info('[storage] 检测到 v1 数据，迁移到 v2');
        return {
            version: SCHEMA_VERSION,
            tasks: oldData.tasks,
            lastResetDate: oldData.lastResetDate || null
        };
    }
    // v2 -> v3（场3阶段6，D-009）：任务新增四个派活字段。已有字段一律不动，只补缺省值；
    // 合法 v2 数据绝不走下面的「无法识别」分支，绝不返回 null、绝不丢 tasks
    if (oldData && oldData.version === 2 && Array.isArray(oldData.tasks)) {
        console.info('[storage] 检测到 v2 数据，迁移到 v3');
        return {
            version: SCHEMA_VERSION,
            tasks: oldData.tasks.map(t => ({
                ...t,
                dispatchKey: t.dispatchKey || null,
                sourceKey: t.sourceKey || null,
                dispatchContentRevision: t.dispatchContentRevision || null,
                sourceTitle: t.sourceTitle || null
            })),
            lastResetDate: oldData.lastResetDate
        };
    }
    // 无法识别的结构：放弃迁移，让调用方用默认数据重建
    console.warn('[storage] 数据版本无法识别，已丢弃：', oldData && oldData.version);
    return null;
}

/**
 * 读取重构前旧版 localStorage 中的任务状态（key: taskStates）。
 * 供 store.js 在首次初始化时做一次性状态迁移。
 * @returns {object|null} 形如 { "1": { status: "completed", ... }, ... }
 */
export function loadLegacyStates() {
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.error('[storage] 读取旧版数据失败：', err);
        return null;
    }
}

/** 清除旧版数据（迁移完成后调用，避免重复迁移） */
export function clearLegacy() {
    try {
        localStorage.removeItem(LEGACY_KEY);
    } catch (err) {
        console.error('[storage] 清除旧版数据失败：', err);
    }
}
