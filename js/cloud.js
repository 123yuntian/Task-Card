/**
 * js/cloud.js — 云端同步层
 *
 * 职责：把「整份任务卡状态」推到云端 / 从云端拉回来。
 *
 * 设计原则（重要）：
 *  1. 不改 storage.js 的同步接口 —— localStorage 仍然是"本机缓存"，
 *     云端只是它上面多加的一层。断网 = 回到纯本地模式，照常能用。
 *  2. 读写都是"整份 JSON" —— 因为 Task Card 的状态本来就是一个对象，
 *     不需要拆成一行一个任务。数据量小，简单优先。
 *  3. 失败不抛异常，只 console 记录 —— 云端挂了不能影响本机使用。
 */

/** 云服务连接参数（来自开通云服务时返回的 publicConfig） */
const CLOUD_CONFIG = {
    endpoint: 'https://task-card.app.workbuddy.host',
    publishableKey: 'wbpk_POLZkH8Nlq8HZCCDKlAmv8_HA9fQhJZB7ZH5o79s2EIgSCzcrFO6K9r',
};

/** 表名 */
const TABLE = 'task_card_state';

/**
 * 这条数据的"暗号"。
 * 表是开放读写的（没做登录），靠这个值区分"谁的数据"。
 * 换一台新设备时，只要代码里有这个值，就能读到同一份数据。
 */
const SLOT = 'u_7f3a9c2d';

/** 单例客户端 */
let client = null;
/** SDK 是否可用 */
let sdkReady = false;

/**
 * 懒初始化：第一次用到时才创建客户端。
 * @returns {object|null} cloud 客户端，SDK 没加载时返回 null
 */
function getClient() {
    if (client) return client;
    const WB = typeof window !== 'undefined' ? window.WorkBuddyCloud : null;
    if (!WB || typeof WB.createWorkBuddyCloud !== 'function') {
        console.warn('[cloud] SDK 未加载，云端同步不可用（本机模式照常工作）');
        return null;
    }
    if (!CLOUD_CONFIG.endpoint) {
        console.warn('[cloud] endpoint 缺失，跳过云端同步');
        return null;
    }
    client = WB.createWorkBuddyCloud({
        endpoint: CLOUD_CONFIG.endpoint,
        publishableKey: CLOUD_CONFIG.publishableKey,
    });
    sdkReady = true;
    return client;
}

/** SDK 是否已就绪（UI 可用来显示"云端已连接/未连接"） */
export function isCloudReady() {
    return sdkReady;
}

/**
 * 从云端拉取状态。
 * @returns {Promise<{version:number, tasks:Array, lastResetDate:string, _cloudUpdatedAt:string}|null>}
 *          云端没有记录时返回 null；出错也返回 null（调用方应继续用本地数据）
 */
export async function pullState() {
    const cloud = getClient();
    if (!cloud) return null;
    try {
        const { data, error } = await cloud.database
            .from(TABLE)
            .select('data, updated_at')
            .eq('slot', SLOT)
            .maybeSingle();

        if (error) {
            console.error('[cloud] 拉取失败：', error.message || error);
            return null;
        }
        if (!data || !data.data) return null;

        return { ...data.data, _cloudUpdatedAt: data.updated_at };
    } catch (err) {
        console.error('[cloud] 拉取异常：', err);
        return null;
    }
}

/**
 * 把状态推到云端（upsert：有这个 slot 就覆盖，没有就新建）。
 * @param {object} state 完整状态对象
 * @returns {Promise<boolean>} 是否成功
 */
export async function pushState(state) {
    const cloud = getClient();
    if (!cloud) return false;
    try {
        const { error } = await cloud.database
            .from(TABLE)
            .upsert(
                {
                    slot: SLOT,
                    data: state,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'slot' }
            );

        if (error) {
            console.error('[cloud] 推送失败：', error.message || error);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[cloud] 推送异常：', err);
        return false;
    }
}

/**
 * 一次性连通性自检，供排查用。
 * 控制台执行 `await __cloudSelfTest()` 可看结果。
 */
export async function selfTest() {
    const cloud = getClient();
    if (!cloud) {
        console.warn('[cloud] 自检失败：SDK 未加载');
        return { ok: false, reason: 'sdk-not-loaded' };
    }
    const probe = { version: 0, tasks: [], lastResetDate: null, _probe: Date.now() };
    const pushed = await pushState(probe);
    const pulled = await pullState();
    const ok = pushed && !!pulled;
    console.info('[cloud] 自检结果：', { pushed, pulled: !!pulled, ok });
    return { ok, pushed, pulled };
}
