/**
 * js/app.js — 应用入口
 * 职责：按依赖顺序初始化各模块，除此以外不包含任何业务逻辑。
 * 初始化顺序：store（数据）-> timer（引擎）-> render（视图）。
 */

import * as store from './store.js';
import * as timer from './timer.js';
import * as render from './render.js';

function bootstrap() {
    store.init();   // 1. 加载持久化数据 / 播种默认任务 / 迁移旧数据
    timer.start();  // 2. 启动倒计时引擎（每秒过期判定 + 每日重置检查）
    render.init();  // 3. 订阅事件并渲染视图、绑定事件委托
}

// module 脚本本身 deferred，此处再兜底一次确保 DOM 就绪
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
