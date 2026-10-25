// server/main.mjs —— 本地服务骨架（派活重构 · 场2 阶段2）
// 只绑 127.0.0.1；静态资源走精确白名单（新增文件要登记）；写接口与 SSE 在场3 接入
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8317;
const APP_NAME = 'task-card-dispatch';
const APP_VERSION = '0.1.0';

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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
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

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || '').toLowerCase();
  // Host 校验拦 DNS 重绑定；写请求的 Origin/令牌校验在场3 加
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

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { app: APP_NAME, version: APP_VERSION, node: process.version, pid: process.pid });
    return;
  }
  if (pathname.startsWith('/api/')) {
    // 场3 起逐个接入 today/session/operations/events/import/export
    sendJson(res, 404, { error: 'api_not_implemented', path: pathname });
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
    console.error('[Task Card] 占用者不是本服务（可能是旧 Python 静态服务等），请手动关闭后重试。');
    process.exit(1);
  });
  probe.on('timeout', () => {
    console.error('[Task Card] 占用者无应答，请手动检查端口后重试。');
    process.exit(1);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Task Card] ${APP_NAME} v${APP_VERSION} 运行于 http://${HOST}:${PORT}/index.html`);
});
