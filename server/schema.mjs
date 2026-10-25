// server/schema.mjs —— 派活数据模型：字段校验、状态枚举、操作包验证（场2 阶段3）
// 注意：这里的 DISPATCH_SCHEMA_VERSION 是「派活定义 JSON」的版本，与 localStorage 的
// SCHEMA_VERSION（js/storage.js，当前 2）是两套互不相干的版本号。
export const DISPATCH_SCHEMA_VERSION = 1;
export const TIMEZONE = 'Asia/Shanghai';

export const EXECUTION_STATES = ['available', 'accepted', 'done', 'failed', 'shelved'];
export const ACCEPTANCE_STATES = ['not_submitted', 'pending', 'passed', 'changes_requested'];
export const OPERATION_TYPES = [
  'accept', 'complete', 'fail', 'shelve', 'delay', 'expire',
  'submit_feedback', 'import_ai_review', 'confirm_ai_review',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// 派活定义校验：必填只卡 id/dispatchKey/title/minutes/date，其余可选字段带类型检查——
// 放宽是刻意的：真实派活缺 why/steps 不该被整批拒绝；acceptance 缺失只给警告，预览里可见。
export function validateDispatchDefinition(def) {
  const errors = [];
  const warnings = [];
  if (!def || typeof def !== 'object') return { ok: false, errors: ['定义必须是对象'], warnings };
  if (def.schemaVersion !== DISPATCH_SCHEMA_VERSION) errors.push(`schemaVersion 必须是 ${DISPATCH_SCHEMA_VERSION}`);
  if (!isNonEmptyString(def.date) || !DATE_RE.test(def.date)) errors.push('date 必须是 YYYY-MM-DD（派发日）');
  if (def.timezone !== undefined && def.timezone !== TIMEZONE) errors.push(`timezone 首版只支持 ${TIMEZONE}`);
  if (!Array.isArray(def.tasks) || def.tasks.length === 0) errors.push('tasks 必须是非空数组');

  const seenIds = new Set();
  const seenKeys = new Set();
  const n = Array.isArray(def.tasks) ? def.tasks.length : 0;
  for (let i = 0; i < n; i++) {
    const t = def.tasks[i];
    const at = `tasks[${i}]`;
    if (!isNonEmptyString(t.id)) errors.push(`${at}.id（assignmentId）必填`);
    else if (seenIds.has(t.id)) errors.push(`${at}.id 重复：${t.id}`);
    else seenIds.add(t.id);
    if (!isNonEmptyString(t.dispatchKey)) errors.push(`${at}.dispatchKey 必填（跨日稳定逻辑键）`);
    else if (seenKeys.has(t.dispatchKey)) errors.push(`${at}.dispatchKey 重复：${t.dispatchKey}`);
    else seenKeys.add(t.dispatchKey);
    if (!isNonEmptyString(t.title)) errors.push(`${at}.title 必填`);
    if (typeof t.minutes !== 'number' || !Number.isFinite(t.minutes) || t.minutes <= 0) errors.push(`${at}.minutes 必须是正数`);
    if (t.steps !== undefined && !Array.isArray(t.steps) && !isNonEmptyString(t.steps)) errors.push(`${at}.steps 应是字符串数组或字符串`);
    if (t.acceptance === undefined || !isNonEmptyString(t.acceptance)) warnings.push(`${at}.acceptance 缺失（验收条件为空，导入后需补）`);
    if (t.contentRevision !== undefined && (!Number.isInteger(t.contentRevision) || t.contentRevision < 1)) errors.push(`${at}.contentRevision 应是 >=1 整数`);
    if (t.codeEvidence !== undefined && !Array.isArray(t.codeEvidence)) errors.push(`${at}.codeEvidence 应是数组`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// 操作包校验：{operationId, expectedVersion, type, payload}
export function validateOperation(op) {
  const errors = [];
  if (!op || typeof op !== 'object') return { ok: false, errors: ['操作必须是对象'] };
  if (!isNonEmptyString(op.operationId)) errors.push('operationId 必填');
  if (!Number.isInteger(op.expectedVersion) || op.expectedVersion < 0) errors.push('expectedVersion 应是 >=0 整数');
  if (!OPERATION_TYPES.includes(op.type)) errors.push(`type 必须是 ${OPERATION_TYPES.join(' / ')}`);

  const p = (op.payload && typeof op.payload === 'object') ? op.payload : {};
  switch (op.type) {
    case 'delay':
      if (!Number.isFinite(p.extendMinutes) || p.extendMinutes <= 0) errors.push('delay.payload.extendMinutes 必须是正数');
      break;
    case 'import_ai_review':
      if (!isNonEmptyString(p.source)) errors.push('import_ai_review.payload.source 必填');
      if (!isNonEmptyString(p.originalText)) errors.push('import_ai_review.payload.originalText 必填');
      if (!Number.isInteger(p.relatedContentRevision) || p.relatedContentRevision < 1) errors.push('import_ai_review.payload.relatedContentRevision 必须是 >=1 整数');
      if (p.commitHash !== undefined && !isNonEmptyString(p.commitHash)) errors.push('commitHash 若填必须非空');
      break;
    case 'confirm_ai_review':
      if (!isNonEmptyString(p.reviewId)) errors.push('confirm_ai_review.payload.reviewId 必填');
      if (p.verdict !== 'passed' && p.verdict !== 'changes_requested') errors.push("verdict 必须是 'passed' 或 'changes_requested'");
      break;
    case 'submit_feedback':
      if (p.difficulty !== undefined && !/^[1-5]$/.test(String(p.difficulty))) errors.push('difficulty 若填必须是 1-5');
      if (p.actualMinutes !== undefined && (!Number.isFinite(p.actualMinutes) || p.actualMinutes < 0)) errors.push('actualMinutes 若填必须是 >=0 数值');
      if (p.text !== undefined && typeof p.text !== 'string') errors.push('text 若填必须是字符串');
      break;
    default:
      break; // accept/complete/fail/shelve/expire 的目标由 URL :key 决定，payload 可为空
  }
  return { ok: errors.length === 0, errors };
}
