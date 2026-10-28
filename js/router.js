/**
 * js/router.js — 视图路由（hash 路由，最小实现）
 *
 * 职责：把 location.hash 映射到 index.html 里的 .view 区块，一次只显示一个；
 *      同时给左侧边栏的导航项打 active 标记。
 *
 * 约定：
 *  - 视图名 = #/名字，对应 DOM 里的 #view-<名字>；侧栏链接用 data-view="名字"
 *  - 未知 hash（含空）一律回落到 board，不做 404 页
 *  - 只管显示/隐藏，不重建内容；看板内容的渲染仍然全权归 render.js
 */

const VIEWS = ['board', 'today', 'history', 'snapshots', 'settings'];
const DEFAULT_VIEW = 'board';

/** 从 location.hash 里取出视图名 */
function currentView() {
    const raw = String(location.hash || '').replace(/^#\/?/, '').trim();
    return VIEWS.includes(raw) ? raw : DEFAULT_VIEW;
}

/** 应用当前 hash：切区块 + 打 active */
function apply() {
    const name = currentView();

    for (const view of VIEWS) {
        const el = document.getElementById(`view-${view}`);
        if (el) el.hidden = view !== name;
    }

    for (const link of document.querySelectorAll('.side-nav a[data-view]')) {
        link.classList.toggle('active', link.dataset.view === name);
    }
}

window.addEventListener('hashchange', apply);

// 首次进入：没有 hash 就补一个，保证刷新后仍能停在同一个视图
if (!location.hash) {
    history.replaceState(null, '', `#/${DEFAULT_VIEW}`);
}
apply();
