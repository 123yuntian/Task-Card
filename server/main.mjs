// server/main.mjs —— 本地服务（派活重构 · 场2：骨架 → 阶段3/4 接入持久化与发布）
// 只绑 127.0.0.1；静态资源走精确白名单；写接口须带启动时生成的会话令牌
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repository, RepositoryError } from './repository.mjs';
import { Publisher } from './publisher.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8317;
const APP_NAME = 'task-card-dispatch';
const APP_VERSION = '0.2.0';
const BODY_LIMIT = 256 * 1024; // 请求体上限，超限 413

// 会话写令牌：每次启动随机生成，前端经同源 GET /api/session 领取，写请求带头校验
const WRITE_TOKEN = randomBytes(24).toString('hex');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// 精确白名单：URL → 相对项目根的文件。today.html 与 js/dispatch/* 在场3 创建前会 404
const STATIC_ROUTES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/today.html', 'today.html'],
  ['/style.css', 'style.css'],
  ['/js/app.js', 'js/app.js'],
  ['/js/store.js', 'js/store.js'],
  ['/js/storage.js', 'js/storage.js'],
  ['/js/render.js', 'js/render.js'],
  ['/js/timer.js', 'js/timer.js'],
  ['/js/dispatch/api.js', 'js/dispatch/api.js'],
  ['/js/dispatch/client-store.js', 'js/dispatch/client-store.js'],
  ['/js/dispatch/workbench.js', 'js/dispatch/workbench.js'],
]);

const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);

const DATA_DIR = path.join(ROOT, 'dispatch-data');
const publisher = await new Publisher(DATA_DIR).init();
const repository = await new Repository(DATA_DIR).init();
const startupWarning = repository.broken
  ? { state: 'corrupted_readonly', detail: repository.broken.reason }
  : null;

// 服务端「今天」一律取 Asia/Shanghai（方案§三：机器可用 UTC，业务日期用该时区）
function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// 说明页 HTML：响应头再锁一层（CSP sandbox 无任何放行项），即使被直接导航打开也不执行脚本
function sendHtml(res, html) {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

async function serveStatic(res, relPath) {
  try {
    const data = await readFile(path.join(ROOT, relPath));
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(relPath)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    // 白名单内但文件尚不存在：只回相对名，不暴露磁盘细节
    sendJson(res, 404, { error: 'not_found', path: relPath });
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    let overLimit = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        // 超限：不再累计也不掐断连接（掐断会让客户端收不到 413），继续排水直至发回响应
        if (!overLimit) {
          overLimit = true;
          resolve({ ok: false, error: 'payload_too_large' });
        }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({ ok: false, error: 'empty_body' });
      try {
        resolve({ ok: true, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ ok: false, error: 'bad_json' });
      }
    });
    req.on('error', () => resolve({ ok: false, error: 'read_error' }));
  });
}

function repoStatus(err, res) {
  switch (err.kind) {
    case 'validation': return sendJson(res, 422, { error: 'validation', errors: err.detail });
    case 'version_conflict': return sendJson(res, 409, { error: 'version_conflict', current: err.detail.current });
    case 'operation_id_reuse': return sendJson(res, 409, { error: 'operation_id_reuse', operationId: err.detail.operationId });
    case 'unknown_task': return sendJson(res, 422, { error: 'unknown_task', key: err.detail.key });
    case 'corrupted': return sendJson(res, 500, { error: 'state_corrupted', hint: 'state.json 与备份均损坏，服务只读，请人工检查 dispatch-data' });
    default: return sendJson(res, 500, { error: 'write_failed', detail: err.detail ?? err.message });
  }
}

async function handleApi(req, res, pathname) {
  // ---- GET ----
  if (req.method === 'GET') {
    if (pathname === '/api/health') {
      return sendJson(res, 200, { app: APP_NAME, version: APP_VERSION, node: process.version, pid: process.pid, warning: startupWarning });
    }
    if (pathname === '/api/session') {
      return sendJson(res, 200, { token: WRITE_TOKEN }); // 同源可读；跨站页面拿不到（无 CORS 头）
    }
    const disp = pathname.match(/^\/api\/dispatches\/([^/]+)$/);
    if (disp) {
      const key = decodeURIComponent(disp[1]);
      const task = repository.snapshot(key);
      if (!task) return sendJson(res, 404, { error: 'not_found', key });
      const manifest = await publisher.current();
      const def = manifest?.tasks?.find(t => t.dispatchKey === key) ?? null;
      return sendJson(res, 200, { key, definition: def, execution: task });
    }
    if (pathname === '/api/today') {
      // 空态是正常状态不是错误：未发布必须 200 + published:false，绝不 404/500（阶段5「今日尚未发布」全靠它）
      const today = shanghaiToday();
      const manifest = await publisher.current();
      if (!manifest || manifest.date !== today) {
        return sendJson(res, 200, { published: false, date: today, generationId: null, contentRevision: null, tasks: [] });
      }
      // manifest 只存摘要；复制提示词、展示步骤和验证条件需要完整定义，按 dispatchKey 合并进来
      const full = await publisher.currentDefinition();
      const fullByKey = new Map((full?.tasks ?? []).map(t => [t.dispatchKey, t]));
      const tasks = manifest.tasks.map(t => ({
        definition: { ...fullByKey.get(t.dispatchKey), ...t },
        execution: repository.snapshot(t.dispatchKey) ?? {
          version: 0, execution: 'available', acceptanceStatus: 'not_submitted', deadline: null,
        },
      }));
      return sendJson(res, 200, {
        published: true,
        date: today,
        generationId: manifest.generationId,
        publishedAt: manifest.publishedAt,
        contentRevision: Math.max(...tasks.map(t => t.definition.contentRevision ?? 1)),
        tasks,
      });
    }
    // 历史入口：只读。generationId 在 publisher 内过严格正则后才拼路径
    if (pathname === '/api/generations') {
      return sendJson(res, 200, { generations: await publisher.listGenerations() });
    }
    const gen = pathname.match(/^\/api\/generations\/([^/]+)(\/tasks\.html)?$/);
    if (gen) {
      const id = decodeURIComponent(gen[1]);
      if (gen[2]) {
        const html = await publisher.generationTasksHtml(id);
        if (html === null) return sendJson(res, 404, { error: 'not_found', generationId: id });
        return sendHtml(res, html);
      }
      const def = await publisher.generationDefinition(id);
      if (!def) return sendJson(res, 404, { error: 'not_found', generationId: id });
      return sendJson(res, 200, def);
    }
    return sendJson(res, 404, { error: 'api_not_implemented', path: pathname });
  }

  // ---- POST（写接口）----
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return sendJson(res, 403, { error: 'origin_forbidden' });
  }
  const body = await readBody(req);
  if (!body.ok) {
    return sendJson(res, body.error === 'payload_too_large' ? 413 : 400, { error: body.error });
  }

  if (pathname === '/api/import/preview') {
    // 预览不落盘、不改状态，不需要写令牌
    const result = await publisher.preview(body.data);
    return sendJson(res, 200, result);
  }

  const needToken = pathname === '/api/import/commit' || /^\/api\/dispatches\/[^/]+\/operations$/.test(pathname);
  if (!needToken) return sendJson(res, 404, { error: 'api_not_implemented', path: pathname });
  if (req.headers['x-dispatch-token'] !== WRITE_TOKEN) {
    return sendJson(res, 401, { error: 'token_required' });
  }

  if (pathname === '/api/import/commit') {
    const { definition, previewHash } = body.data || {};
    const result = await publisher.commit(definition, { previewHash });
    return sendJson(res, result.status, result);
  }

  const m = pathname.match(/^\/api\/dispatches\/([^/]+)\/operations$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    const manifest = await publisher.current();
    const def = manifest?.tasks?.find(t => t.dispatchKey === key) ?? null;
    try {
      const result = await repository.applyOperation(key, body.data, def);
      return sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof RepositoryError) return repoStatus(err, res);
      console.error('[api] operations 未知错误：', err);
      return sendJson(res, 500, { error: 'internal', detail: err.message });
    }
  }

  return sendJson(res, 404, { error: 'api_not_implemented', path: pathname });
}

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || '').toLowerCase();
  // Host 校验拦 DNS 重绑定与本机外访问
  if (!ALLOWED_HOSTS.has(host)) {
    sendJson(res, 403, { error: 'host_forbidden' });
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${host}`).pathname);
  } catch {
    sendJson(res, 400, { error: 'bad_url' });
    return;
  }
  // 纵深防御：白名单本就精确匹配，这里再拦编码残留的穿越与隐藏文件
  if (pathname.includes('..') || pathname.includes('\\') || pathname.startsWith('/.')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }
  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      console.error('[api] 处理失败：', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal', detail: err.message });
    }
    return;
  }
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const rel = STATIC_ROUTES.get(pathname);
  if (rel) {
    await serveStatic(res, rel);
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error('[Task Card] 服务启动失败：', err.message);
    process.exit(1);
  }
  // 端口被占：识别占用者，不杀进程、不换端口
  console.error(`[Task Card] 端口 ${PORT} 已被占用（不自动杀进程、不换端口）。`);
  const probe = http.get({ host: HOST, port: PORT, path: '/api/health', timeout: 1500 }, (r) => {
    let body = '';
    r.on('data', (c) => (body += c));
    r.on('end', () => {
      console.error(`[Task Card] 占用者应答 /api/health：${body || '(空)'}`);
      console.error('[Task Card] 若是本服务旧实例，请到对应窗口按 Ctrl+C 关闭后重试。');
      process.exit(1);
    });
  });
  probe.on('error', () => {
    console.error('[Task Card] 占用者不是本服务（可能是旧程序），请手动关闭后重试。');
    process.exit(1);
  });
  probe.on('timeout', () => {
    console.error('[Task Card] 占用者无应答，请手动检查端口后重试。');
    process.exit(1);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Task Card] ${APP_NAME} v${APP_VERSION} 运行于 http://${HOST}:${PORT}/index.html`);
  if (startupWarning) console.error('[Task Card] ⚠ 数据状态只读：', JSON.stringify(startupWarning));
});
