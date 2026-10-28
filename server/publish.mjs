import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Publisher } from './publisher.mjs';
import { validateDispatchDefinition } from './schema.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--dry-run')) {
    throw new Error('用法：node server/publish.mjs <定义文件绝对路径> [--dry-run]');
  }
  const [file, flag] = args;
  if (!path.isAbsolute(file) || /[*?\[\]]/.test(file) || path.extname(file).toLowerCase() !== '.json') {
    throw new Error('请提供不含通配符的 JSON 文件绝对路径');
  }
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    throw new Error(`无法访问定义文件：${error.message}`);
  }
  if (!info.isFile()) throw new Error('定义路径必须是文件，不能是目录');

  let def;
  try {
    def = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取或解析 JSON：${error.message}`);
  }
  const validation = validateDispatchDefinition(def);
  if (!validation.ok) throw new Error(`定义校验失败：\n${validation.errors.join('\n')}`);

  const publisher = new Publisher(path.join(root, 'dispatch-data'));
  if (flag !== '--dry-run') await publisher.init();
  const preview = await publisher.preview(def);
  if (!preview.ok) throw new Error(`预览失败：\n${preview.errors.join('\n')}`);
  console.log(`目标日期：${preview.diff.date}`);
  for (const key of ['added', 'changed', 'removed', 'unchanged']) {
    console.log(`${key}: ${JSON.stringify(preview.diff[key])}`);
  }
  if (flag === '--dry-run') return;

  const result = await publisher.commit(def, { previewHash: preview.hash });
  if (result.status !== 200) {
    throw new Error([result.hint, result.detail, result.error, ...(result.errors || [])].filter(Boolean).join('：') || '发布失败');
  }
  console.log(`generationId: ${result.generationId}`);
  console.log(`publishedTasks: ${result.publishedTasks ?? def.tasks.length}`);
  console.log('http://127.0.0.1:8317/today.html');
}

main().catch(error => {
  console.error(`发布失败：${error.message}`);
  process.exitCode = 1;
});
