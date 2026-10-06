/**
 * js/timer.js — 倒计时引擎
 * 职责：
 *  1. 全局唯一 setInterval，每秒执行一次 tick；
 *  2. tick 内完成两件事：
 *     a) 过期判定：扫描所有 accepted 任务，deadline 到期则调用 store.failTask()；
 *     b) 跨天检查：调用 store.dailyResetIfNeeded() 实现每日 00:00 重置；
 *  3. 向订阅者广播 tick 事件（携带当前时间戳），视图层据此刷新倒计时显示。
 *
 * 设计说明：引擎本身不保存任何"剩余时间"，只依赖任务上的绝对 deadline，
 * 因此页面休眠、刷新、系统时间调整都不会破坏倒计时的正确性。
 */

import * as store from './store.js';

/** setInterval 句柄 */
let intervalId = null;

/** tick 事件订阅者集合 */
const tickListeners = new Set();

/**
 * 订阅每秒 tick。
 * @param {Function} fn 回调，参数为当前时间戳 now
 * @returns {Function} 取消订阅的函数
 */
export function onTick(fn) {
    tickListeners.add(fn);
    return () => tickListeners.delete(fn);
}

/** 启动倒计时引擎（重复调用安全：会先停掉旧的） */
export function start() {
    stop();
    intervalId = setInterval(tick, 1000);
    tick(); // 立即执行一次，避免首帧延迟 1 秒
}

/** 停止倒计时引擎 */
export function stop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

/** 每秒心跳：过期判定 -> 跨天检查 -> 广播 */
function tick() {
    const now = Date.now();

    // 1. 过期判定：deadline 已到且仍在进行中的任务判为失败
    for (const task of store.getTasks()) {
        if (task.status === 'accepted' && task.deadline && task.deadline <= now) {
            store.failTask(task.id);
        }
    }

    // 2. 每日 00:00 重置检查（内部按日期去重，每秒调用无开销）
    store.dailyResetIfNeeded();

    // 3. 广播 tick，视图层用它刷新 HH:MM:SS 倒计时文本
    tickListeners.forEach(fn => fn(now));
}
