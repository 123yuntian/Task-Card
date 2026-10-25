// server/publisher.mjs —— 派活发布器（场2 阶段4）
// 流程固定：校验 → 预览差异 → 完整生成版本化目录 → 原子切换 manifest 指针。
// 任何一步失败保留上一版；manifest 永远只指向已完整写好的目录，读者看不到半套内容。
import { mkdir, writeFile, rename, readFile, open, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { validateDispatchDefinition, DISPATCH_SCHEMA_VERSION, TIMEZONE } from './schema.mjs';

// commit() 生成的版本目录名：gen-<日期>-<时间戳36进制>-<6位hex>
const GENERATION_ID_RE = /^gen-\d{4}-\d{2}-\d{2}-[a-z0-9]+-[0-9a-f]{6}$/;

function sortedReplacer(_k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return v;
}

export class Publisher {
  constructor(dataDir, { failAfter = null } = {}) {
    this.dataDir = dataDir; // failAfter 仅供测试模拟发布中断（'afterStageBuild'）
    this.publishedDir = path.join(dataDir, 'published');
    this.manifestFile = path.join(dataDir, 'manifest.json');
    this.failAfter = failAfter;
  }

  async init() {
    await mkdir(this.publishedDir, { recursive: true });
    return this;
  }

  async current() {
    try {
      return JSON.parse(await readFile(this.manifestFile, 'utf8'));
    } catch {
      return null;
    }
  }

  // 当前 manifest 指向的完整定义（含 prompt/steps/acceptance）；读不到返回 null
  async currentDefinition() {
    const manifest = await this.current();
    return manifest ? this.#definitionOf(manifest) : null;
  }

  // 当前版本的无脚本说明页 HTML（交给 sandbox="" 的 iframe）；缺文件返回 null
  async currentTasksHtml() {
    const manifest = await this.current();
    return manifest ? this.generationTasksHtml(manifest.generationId) : null;
  }

  // 历史入口：枚举 published/ 下每个已完整写好的版本目录，按日期、版本倒序。只读。
  async listGenerations() {
    const manifest = await this.current();
    let names = [];
    try {
      names = await readdir(this.publishedDir);
    } catch {
      return [];
    }
    const items = [];
    for (const name of names) {
      if (!GENERATION_ID_RE.test(name)) continue;
      const def = await this.#definitionOf({ generationId: name });
      if (!def) continue; // 半套目录（没有 definition.json）不进列表
      items.push({
        generationId: name,
        date: def.date,
        taskCount: Array.isArray(def.tasks) ? def.tasks.length : 0,
        current: manifest?.generationId === name,
      });
    }
    items.sort((a, b) => (a.date === b.date ? (a.generationId < b.generationId ? 1 : -1) : (a.date < b.date ? 1 : -1)));
    return items;
  }

  // generationId 来自 URL，必须先过严格正则再拼路径，杜绝穿越
  async generationDefinition(generationId) {
    if (!GENERATION_ID_RE.test(generationId)) return null;
    return this.#definitionOf({ generationId });
  }

  async generationTasksHtml(generationId) {
    if (!GENERATION_ID_RE.test(generationId)) return null;
    try {
      return await readFile(path.join(this.publishedDir, generationId, 'tasks.html'), 'utf8');
    } catch {
      return null;
    }
  }

  canonical(def) {
    return JSON.stringify({ ...def, schemaVersion: def.schemaVersion ?? DISPATCH_SCHEMA_VERSION }, sortedReplacer);
  }

  hash(def) {
    return createHash('sha256').update(this.canonical(def)).digest('hex');
  }

  // 预览：只校验 + 算差异，不写任何文件。hash 供 commit 阶段防定义漂移。
  async preview(def) {
    const v = validateDispatchDefinition(def);
    const manifest = await this.current();
    const diff = {
      date: def?.date,
      baseGenerationId: manifest?.generationId ?? null,
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
    };
    if (v.ok) {
      const old = manifest ? await this.#definitionOf(manifest) : null;
      if (old) {
        const oldMap = new Map(old.tasks.map(t => [t.dispatchKey, t]));
        const newMap = new Map(def.tasks.map(t => [t.dispatchKey, t]));
        for (const [k, t] of newMap) {
          const o = oldMap.get(k);
          if (!o) diff.added.push(k);
          else if (this.canonical(o) !== this.canonical(t)) diff.changed.push(k);
          else diff.unchanged.push(k);
        }
        for (const [k] of oldMap) if (!newMap.has(k)) diff.removed.push(k);
      } else {
        diff.added.push(...def.tasks.map(t => t.dispatchKey));
      }
    }
    return {
      ok: v.ok,
      errors: v.errors,
      warnings: v.warnings,
      hash: v.ok ? this.hash(def) : null,
      baseGenerationId: manifest?.generationId ?? null,
      diff,
    };
  }

  // 发布：previewHash 必须与当前定义一致；同内容重复发布幂等（不新建目录）。
  async commit(def, { previewHash } = {}) {
    const v = validateDispatchDefinition(def);
    if (!v.ok) return { status: 422, errors: v.errors };
    const h = this.hash(def);
    if (previewHash !== h) {
      return { status: 409, error: 'preview_hash_mismatch', hint: '定义与预览时不一致，请重新预览' };
    }
    const manifest = await this.current();
    if (manifest && manifest.contentHash === h) {
      return { status: 200, alreadyPublished: true, generationId: manifest.generationId };
    }

    const date = def.date;
    const generationId = `gen-${date}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const dir = path.join(this.publishedDir, generationId);
    await mkdir(dir, { recursive: true });

    const definition = {
      ...def,
      schemaVersion: DISPATCH_SCHEMA_VERSION,
      timezone: def.timezone ?? TIMEZONE,
      generationId,
    };
    await this.#writeSynced(path.join(dir, 'definition.json'), JSON.stringify(definition, null, 2));
    if (this.failAfter === 'afterStageBuild') {
      throw new Error('[test] 模拟发布中断（afterStageBuild）：manifest 未切换，上一版仍生效');
    }
    await this.#writeSynced(path.join(dir, 'tasks.html'), this.#renderTasksHtml(definition));

    const nextManifest = {
      date,
      generationId,
      contentHash: h,
      publishedAt: Date.now(),
      tasks: definition.tasks.map(t => ({
        dispatchKey: t.dispatchKey,
        assignmentId: t.id,
        title: t.title,
        minutes: t.minutes,
        contentRevision: t.contentRevision ?? 1,
      })),
    };
    const tmp = this.manifestFile + '.tmp';
    await this.#writeSynced(tmp, JSON.stringify(nextManifest, null, 2));
    try {
      await rename(tmp, this.manifestFile);
    } catch (e) {
      return { status: 500, error: 'manifest_switch_failed', hint: '上一版 manifest 保留', detail: e.message };
    }
    return { status: 200, generationId, publishedTasks: nextManifest.tasks.length };
  }

  async #definitionOf(manifest) {
    try {
      return JSON.parse(await readFile(path.join(this.publishedDir, manifest.generationId, 'definition.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  async #writeSynced(file, content) {
    const handle = await open(file, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync(); // 目录内容全部落盘后才允许切 manifest
    } finally {
      await handle.close();
    }
  }

  // 无脚本说明页：给 sandbox="" 的 iframe 用。绝不含 <script>/<form>，全部 HTML 转义。
  #renderTasksHtml(def) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const body = def.tasks.map(t => {
      const steps = Array.isArray(t.steps) ? t.steps : (t.steps ? [t.steps] : []);
      return `<section class="task">
<h3>${esc(t.title)}</h3>
<p class="meta">预计 ${esc(t.minutes)} 分钟 · 内容修订 r${esc(t.contentRevision ?? 1)} · dispatchKey: ${esc(t.dispatchKey)}</p>
${t.why ? `<p class="why">${esc(t.why)}</p>` : ''}
${steps.length ? `<ol class="steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
${t.prompt ? `<h4>提示词</h4><pre>${esc(t.prompt)}</pre>` : ''}
${t.acceptance ? `<h4>验证条件</h4><p>${esc(t.acceptance)}</p>` : ''}
</section>`;
    }).join('\n');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(def.date)} 派活说明</title></head>
<body><h2>${esc(def.date)} 派活说明</h2>
${body}
</body></html>`;
  }
}
