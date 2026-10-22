// 室友公约：条款、参数、版本、修订与表决门槛。
import { fmtYuan, localDate } from './dates.js';
import { fail } from './util.js';

export const DEFAULT_PARAMS = {
  utilitiesMethod: 'personDays',
  awayMinDays: 3,
  freeGuestNights: 4,
  purchaseApprovalCents: 10000,
  choreCarry: true,
  restockNoticeDays: 2,
  quietHours: { start: '22:00', end: '08:00' },
  settleRemindDays: 3,
};

export const PARAM_ORDER = [
  'utilitiesMethod',
  'awayMinDays',
  'freeGuestNights',
  'purchaseApprovalCents',
  'choreCarry',
  'restockNoticeDays',
  'quietHours',
  'settleRemindDays',
];

export const PARAM_TITLE = {
  utilitiesMethod: '水电燃气分摊方式',
  awayMinDays: '离家门槛',
  freeGuestNights: '访客过夜',
  purchaseApprovalCents: '大额采购',
  choreCarry: '值日漏做',
  restockNoticeDays: '物品提醒',
  quietHours: '提醒静默时段',
  settleRemindDays: '催还款间隔',
};

export const DEFAULT_TEXTS = [
  '23:00 后公共区域保持安静。',
  '带客人过夜提前一天在应用里登记。',
  '用完厨房当天清理，碗筷不过夜。',
  '个人物品不在公共区域过夜。',
];

export function recommendedClauses() {
  const out = PARAM_ORDER.map((key, i) => ({ no: i + 1, kind: 'param', key, value: clone(DEFAULT_PARAMS[key]) }));
  DEFAULT_TEXTS.forEach((text, i) => out.push({ no: 9 + i, kind: 'text', text }));
  return out;
}

/** 只有参数条款、没有文字条款的精简模板 */
export function basicClauses() {
  return recommendedClauses().filter((c) => c.kind === 'param');
}

function clone(v) {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}

export function clauseTitle(c) {
  return c.kind === 'param' ? PARAM_TITLE[c.key] : '约定';
}

export function paramText(key, v) {
  switch (key) {
    case 'utilitiesMethod':
      return v === 'equal' ? '水电燃气在在住成员之间均摊。' : '水电燃气按在住人天分摊（离家和访客按第 2、3 条计算）。';
    case 'awayMinDays':
      return `连续离家满 ${v} 天，离家日不计水电、不排值日。`;
    case 'freeGuestNights':
      return `访客过夜每个计费周期免费 ${v} 晚，超出部分每晚按 1 人天计入邀请人。`;
    case 'purchaseApprovalCents':
      return `单笔预计满 ${fmtYuan(v).replace(/\.00$/, '')} 元，先发起采购申请。`;
    case 'choreCarry':
      return v ? '值日漏做的积分在下个周期补回，代做积分记给实际完成人。' : '值日漏做不结转到下个周期；代做积分记给实际完成人。';
    case 'restockNoticeDays':
      return `预计用完前 ${v} 天提醒下一位采购人。`;
    case 'quietHours':
      return `提醒静默时段：${v.start}–${v.end}。`;
    case 'settleRemindDays':
      return `同一笔结算建议至少间隔 ${v} 天才再次提醒。`;
    default:
      return '';
  }
}

export function clauseText(c) {
  return c.kind === 'param' ? paramText(c.key, c.value) : c.text;
}

export function paramShort(key, v) {
  switch (key) {
    case 'utilitiesMethod':
      return v === 'equal' ? '均摊' : '按在住人天';
    case 'awayMinDays':
      return `${v} 天`;
    case 'freeGuestNights':
      return `${v} 晚`;
    case 'purchaseApprovalCents':
      return `${fmtYuan(v).replace(/\.00$/, '')} 元`;
    case 'choreCarry':
      return v ? '下期补回' : '不结转';
    case 'restockNoticeDays':
      return `提前 ${v} 天`;
    case 'quietHours':
      return `${v.start}–${v.end}`;
    case 'settleRemindDays':
      return `${v} 天`;
    default:
      return String(v);
  }
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 校验并规范化参数值，不合法时抛错 */
export function normalizeParam(key, value) {
  const int = (min, max, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${label}要在 ${min}–${max} 之间`);
    return n;
  };
  switch (key) {
    case 'utilitiesMethod':
      if (value !== 'personDays' && value !== 'equal') fail('分摊方式只能是“按在住人天”或“均摊”');
      return value;
    case 'awayMinDays':
      return int(1, 30, '离家门槛天数');
    case 'freeGuestNights':
      return int(0, 31, '免费晚数');
    case 'purchaseApprovalCents': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 100 || n > 10000000) fail('大额采购金额要在 1–100,000 元之间');
      return n;
    }
    case 'choreCarry':
      return !!value;
    case 'restockNoticeDays':
      return int(0, 14, '提前提醒天数');
    case 'quietHours':
      if (!value || !HM.test(value.start) || !HM.test(value.end) || value.start === value.end) fail('静默时段格式应为 22:00–08:00');
      return { start: value.start, end: value.end };
    case 'settleRemindDays':
      return int(1, 30, '催还款间隔');
    default:
      fail('未知的参数条款');
  }
}

export function normalizeText(text) {
  const t = String(text ?? '').trim();
  if (!t) fail('条款内容不能为空');
  if (t.length > 120) fail('一条约定最多 120 字');
  return t;
}

export function paramsOf(clauses) {
  const p = clone(DEFAULT_PARAMS);
  for (const c of clauses) if (c.kind === 'param' && c.key in p) p[c.key] = clone(c.value);
  return p;
}

export function activeVersion(room) {
  const vs = room.pact.versions.filter((v) => v.status === 'active');
  return vs.length ? vs[vs.length - 1] : null;
}

export function draftVersion(room) {
  return room.pact.versions.find((v) => v.status === 'draft') || null;
}

/** 当前生效的条款；首版还在签署中时返回草案条款（但参数按模板默认值执行） */
export function currentClauses(room) {
  return (activeVersion(room) || draftVersion(room))?.clauses ?? [];
}

/** 当前执行的参数：有生效版本用生效版本，否则按模板默认值 */
export function currentParams(room) {
  const v = activeVersion(room);
  return v ? paramsOf(v.clauses) : clone(DEFAULT_PARAMS);
}

/** 某个日期执行的公约版本：该日之前最近生效的版本；都在该日之后时取最早的生效版本 */
export function versionOn(room, date) {
  const used = room.pact.versions.filter((v) => v.status !== 'draft' && v.activatedDate);
  if (!used.length) return null;
  let pick = null;
  for (const v of used) if (v.activatedDate <= date) pick = v;
  return pick || used[0];
}

export function paramsOn(room, date) {
  const v = versionOn(room, date);
  return v ? paramsOf(v.clauses) : clone(DEFAULT_PARAMS);
}

export function clauseNoOf(key) {
  return PARAM_ORDER.indexOf(key) + 1;
}

/** 公约修订：同意人数（含发起人）≥ ⌊n ÷ 2⌋ + 1 */
export function pactThreshold(n) {
  return Math.floor(n / 2) + 1;
}

/** 大额采购：除发起人外至少 ⌈(n − 1) ÷ 2⌉ 人同意 */
export function purchaseThreshold(n) {
  return Math.ceil((n - 1) / 2);
}

/**
 * 把修订应用到条款上。changes:
 *   { op: 'edit', no, value }   参数条款改值
 *   { op: 'edit', no, text }    文字条款改文字
 *   { op: 'add', text }         新增文字条款
 *   { op: 'remove', no }        删除文字条款
 */
export function applyChanges(clauses, changes) {
  if (!Array.isArray(changes) || !changes.length) fail('至少要改一条');
  if (changes.length > 12) fail('一次最多改 12 条');
  const out = clauses.map((c) => clone(c));
  let maxNo = out.reduce((m, c) => Math.max(m, c.no), 0);
  const touched = new Set();
  const diff = [];
  for (const ch of changes) {
    if (ch.op === 'add') {
      const text = normalizeText(ch.text);
      maxNo += 1;
      out.push({ no: maxNo, kind: 'text', text });
      diff.push({ op: 'add', no: maxNo, after: text });
      continue;
    }
    const idx = out.findIndex((c) => c.no === Number(ch.no));
    if (idx < 0) fail(`没有第 ${ch.no} 条`);
    if (touched.has(out[idx].no)) fail(`第 ${ch.no} 条只能改一次`);
    touched.add(out[idx].no);
    const c = out[idx];
    if (ch.op === 'remove') {
      if (c.kind === 'param') fail('参数条款不能删除，可以修改它的参数');
      out.splice(idx, 1);
      diff.push({ op: 'remove', no: c.no, before: c.text });
    } else if (ch.op === 'edit') {
      if (c.kind === 'param') {
        const before = clone(c.value);
        const value = normalizeParam(c.key, ch.value);
        if (JSON.stringify(before) === JSON.stringify(value)) fail(`第 ${c.no} 条的新值和现在一样`);
        c.value = value;
        diff.push({ op: 'edit', no: c.no, key: c.key, before, after: clone(value) });
      } else {
        const text = normalizeText(ch.text);
        if (text === c.text) fail(`第 ${c.no} 条的新内容和现在一样`);
        diff.push({ op: 'edit', no: c.no, before: c.text, after: text });
        c.text = text;
      }
    } else {
      fail('不支持的修改方式');
    }
  }
  return { clauses: out, diff };
}

export function diffText(d) {
  if (d.op === 'add') return `新增第 ${d.no} 条：${d.after}`;
  if (d.op === 'remove') return `删除第 ${d.no} 条：${d.before}`;
  if (d.key) return `第 ${d.no} 条 ${PARAM_TITLE[d.key]}：${paramShort(d.key, d.before)} → ${paramShort(d.key, d.after)}`;
  return `第 ${d.no} 条：“${d.before}” → “${d.after}”`;
}

export function newVersion(room, { clauses, status, now, by, fromProposal = null, diff = null }) {
  const v = room.pact.versions.reduce((m, x) => Math.max(m, x.v), 0) + 1;
  const ver = {
    v,
    status,
    clauses,
    signatures: {},
    createdAt: now,
    createdBy: by,
    activatedAt: null,
    activatedDate: null,
    fromProposal,
    diff,
  };
  room.pact.versions.push(ver);
  return ver;
}

export function activate(room, ver, now) {
  for (const v of room.pact.versions) if (v.status === 'active') v.status = 'retired';
  ver.status = 'active';
  ver.activatedAt = now;
  ver.activatedDate = localDate(now);
}
