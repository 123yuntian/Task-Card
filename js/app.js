/**
 * js/app.js — 应用入口
 * 职责：按依赖顺序初始化各模块，除此以外不包含任何业务逻辑。
 * 初始化顺序：store（数据）-> timer（引擎）-> render（视图）。
 */

import * as store from './store.js';
import * as timer from './timer.js';
import * as render from './render.js';
import { isSchemaLocked } from './storage.js';

function bootstrap() {
    store.init();   // 1. 加载持久化数据 / 播种默认任务 / 迁移旧数据
    // T-3：数据比程序新（程序被回滚）时进入只读保护，提示必须先于一切交互出现
    if (isSchemaLocked()) mountSchemaLockBanner();
    timer.start();  // 2. 启动倒计时引擎（每秒过期判定 + 每日重置检查）
    render.init();  // 3. 订阅事件并渲染视图、绑定事件委托
}

/** T-3 守卫的用户可见提示：解释界面为什么只读、怎么恢复 */
function mountSchemaLockBanner() {
    const el = document.createElement('div');
    el.id = 'schema-lock-banner';
    el.textContent = '数据版本高于本程序（可能是程序被回滚）：已进入只读保护，任何改动都不会保存。请换回新版程序，或用 backup\\ 里的导出文件恢复。';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#b45309;color:#fff;padding:8px 12px;font-size:14px;text-align:center;';
    document.body.appendChild(el);
}

// module 脚本本身 deferred，此处再兜底一次确保 DOM 就绪
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
