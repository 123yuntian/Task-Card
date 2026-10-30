/**
 * js/app.js — 应用入口
 * 职责：按依赖顺序初始化各模块，除此以外不包含任何业务逻辑。
 * 初始化顺序：store（数据）-> timer（引擎）-> render（视图）。
 */

import * as store from './store.js';
import * as timer from './timer.js';
import * as render from './render.js';
import { isSchemaLocked, hydrateFromCloud, SCHEMA_VERSION } from './storage.js';
import { pushState, pullState } from './cloud.js';

function bootstrap() {
    store.init();   // 1. 加载持久化数据 / 播种默认任务 / 迁移旧数据
    // T-3：数据比程序新（程序被回滚）时进入只读保护，提示必须先于一切交互出现
    if (isSchemaLocked()) mountSchemaLockBanner();
    timer.start();  // 2. 启动倒计时引擎（每秒过期判定 + 每日重置检查）
    render.init();  // 3. 订阅事件并渲染视图、绑定事件委托
    syncFromCloud(); // 4. 后台拉云端数据（不阻塞首屏，失败静默）
    watchVisibility(); // 5. 切回页面时同步一次（见函数说明）
}

/**
 * 切回页面时同步一次。
 *
 * 为什么不用定时轮询：云服务按调用次数扣资源点，20 秒轮询一个月约 13 万次，
 * 免费额度只有 1 万点，会直接把额度烧光。
 *
 * 改成监听可见性变化：你在对话里派完活，切回浏览器标签就自动更新，
 * 一天最多几十次请求，几乎不耗额度。
 */
function watchVisibility() {
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;
        try {
            const remote = await pullState();
            if (!remote || !Array.isArray(remote.tasks)) return;
            const added = store.mergeRemoteTasks(remote.tasks);
            if (added) console.info('[cloud] 切回页面，新增 ' + added + ' 条任务');
        } catch (err) {
            // 静默：同步失败不打扰正在用的用户
        }
    });
}

/**
 * 后台同步：先让本机数据秒开，再悄悄拉云端。
 * 拉到就覆盖并重绘；拉不到（首次使用 / 断网 / 云服务暂停）就当无事发生。
 */
async function syncFromCloud() {
    try {
        const remote = await hydrateFromCloud();
        if (remote) {
            if (store.applyRemote(remote)) {
                console.info('[cloud] 已同步云端数据，共 ' + remote.tasks.length + ' 条任务');
            }
            return;
        }
        // 云端还没有数据 → 把本机这份推上去（首次迁移，只发生一次）
        const local = store.getSnapshot();
        if (local && Array.isArray(local.tasks) && local.tasks.length) {
            const ok = await pushState({ version: SCHEMA_VERSION, ...local });
            if (ok) console.info('[cloud] 首次上传本机数据，共 ' + local.tasks.length + ' 条任务');
        }
    } catch (err) {
        console.warn('[cloud] 启动同步失败，继续使用本机数据：', err);
    }
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
