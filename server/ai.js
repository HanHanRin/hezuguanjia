// AI 增强：只在服务端调用模型；只返回结构化草稿，用户确认后才写入数据。
// 不算钱、不当裁判、不自动发送。调用失败或超过 10 秒，由调用方提示改为手动填写。
import { normalizeParam, PARAM_ORDER, DEFAULT_PARAMS } from '../core/pact.js';
import { isDate } from '../core/dates.js';

export class AIError extends Error {}

const CATS = ['rent', 'utilities', 'internet', 'supplies', 'repair', 'other'];
const METHODS = ['equal', 'weight', 'fixed', 'personDays'];

export const PACT_QUESTIONS = [
  '大家平时几点睡、几点起？作息差别大吗？',
  '多久会有朋友或伴侣来留宿？',
  '公共区域希望干净到什么程度？',
  '大家在家做饭多吗？',
  '费用希望细算（按在家天数）还是大致均摊？',
  '对噪音有多敏感？',
];

const QUICK_PROMPT = `你是合租账本的记账助手。把用户的一句话或小票截图整理成账单草稿，交给用户确认。
只输出一个 JSON 对象，格式：
{"drafts":[{"title":"","amount":0,"category":"supplies","payer":"","participants":[],"method":"equal","periodStart":null,"periodEnd":null,"uncertain":[]}]}
规则：
1. amount 是以“元”为单位的数字，最多两位小数。用户没说清、截图看不清的金额填 null，绝不猜测或编造。
2. 几样东西各有价格就拆成几条；只有一个总价就合成一条。小票只有合计时用合计。
3. category 只能是 rent（房租）、utilities（水电燃气）、internet（网费）、supplies（日用品）、repair（维修）、other（其他）之一，拿不准填 null。
4. payer 只能写成员名单里的名字；“我”指当前用户；没提到付款人时写当前用户。
5. participants 只能写成员名单里的名字；“大家”“我们”“几个人平摊”指全部在住成员；没提到时填 null。
6. method：平摊、均摊、AA 写 equal；水电燃气按在住天数写 personDays；拿不准填 null。
7. 水电燃气要写计费周期 periodStart、periodEnd（YYYY-MM-DD），用户没给就填 null。
8. title 不超过 15 个字，写物品或费用名称，不写金额。
9. uncertain 列出需要用户确认的字段：amount、category、payer、participants、method、period。`;

const REWRITE_PROMPT = `你帮合租室友把一句想说的话，改写成一条发给对方的提醒。
要求：
1. 先说清事实，再提一个具体、做得到的请求；
2. 语气平和、平等，不指责、不翻旧账、不阴阳怪气，不用“又”“总是”“最懒”“赶紧”这类字眼；
3. 每条不超过 80 个汉字，不用表情符号；
4. 只在确实相关时引用下面列出的公约条款，写法是“按公约第 N 条”；只能引用列出的条款，不能编造；
5. 给两个版本：direct 直接简洁；casual 轻松一点、带点温度。
只输出 JSON：{"direct":"","casual":""}`;

const PACT_PROMPT = `你帮几位合租室友起草室友公约。根据他们对 6 个问题的回答，给出参数条款的建议值、每个建议的一句话理由，以及最多 6 条文字约定。
参数：
- utilitiesMethod：水电燃气分摊方式，personDays（按在住人天，适合有人常出差、作息不同）或 equal（均摊，适合大家都常住、不想细算）；
- awayMinDays：连续离家满几天不计水电、不排值日，整数 1–30；
- freeGuestNights：每个计费周期访客免费过夜几晚，整数 0–31；
- purchaseApprovalYuan：单笔满多少元的公共采购要先表决，整数 10–5000；
- choreCarry：值日漏做的积分是否在下个周期补回，true 或 false；
- restockNoticeDays：物品预计用完前几天提醒下一位采购人，整数 0–14；
- quietStart、quietEnd：提醒静默时段，HH:MM；
- settleRemindDays：同一笔结算建议至少间隔几天再提醒，整数 1–30。
文字约定写成平实、具体、不指责人的一句话，每条不超过 40 个字。
只输出 JSON：{"params":{},"reasons":{"参数名":"理由"},"texts":[]}`;

const CLAUSE_PROMPT = `你帮合租室友把一段提醒或异议，起草成一条公约修订。二选一：
A. 新增一条文字约定：{"op":"add","text":"不超过 40 字的约定","reason":"一句话理由"}
B. 修改一条已有的参数条款（只能用下面列出的条款编号）：{"op":"edit","no":条款编号,"value":新值,"reason":"一句话理由"}
约定写成平实、具体、不指责人的一句话。只输出 JSON。`;

function parseJson(text) {
  const s = String(text || '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j <= i) throw new AIError('模型没有返回 JSON');
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    throw new AIError('模型返回的 JSON 不完整');
  }
}

export function clip(s, n) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...t].slice(0, n).join('');
}

/** 去掉引用了不存在条款的说法 */
export function fixCitations(s, valid) {
  return s
    .replace(/[（(]?(?:按|根据|依照)?\s*公约\s*第\s*(\d+)\s*条[）)]?[，,：:]?/g, (m, n) => (valid.has(Number(n)) ? m : ''))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeDraft(d, byName, me) {
  if (!d || typeof d !== 'object') return null;
  const uncertain = new Set(Array.isArray(d.uncertain) ? d.uncertain.filter((x) => typeof x === 'string') : []);
  const title = clip(d.title, 30) || '未命名';
  let amount = null;
  const a = typeof d.amount === 'string' ? Number(d.amount.replace(/[^\d.]/g, '')) : d.amount;
  if (typeof a === 'number' && Number.isFinite(a) && a > 0 && a < 1e6) amount = Math.round(a * 100);
  else uncertain.add('amount');
  let category = CATS.includes(d.category) ? d.category : null;
  if (!category) uncertain.add('category');
  let payerId = d.payer ? byName.get(String(d.payer).trim()) ?? null : me.id;
  if (!payerId) uncertain.add('payer');
  let participants = Array.isArray(d.participants) ? [...new Set(d.participants.map((n) => byName.get(String(n).trim())).filter(Boolean))] : null;
  if (participants && !participants.length) participants = null;
  if (!participants) uncertain.add('participants');
  const method = METHODS.includes(d.method) ? d.method : null;
  if (!method) uncertain.add('method');
  const ps = isDate(d.periodStart) ? d.periodStart : null;
  const pe = isDate(d.periodEnd) ? d.periodEnd : null;
  if ((category === 'utilities' || method === 'personDays') && (!ps || !pe || pe < ps)) uncertain.add('period');
  return { title, amount, category, payerId, participants, method, periodStart: ps, periodEnd: pe, uncertain: [...uncertain] };
}

function paramHint(c) {
  switch (c.key) {
    case 'utilitiesMethod':
      return `utilitiesMethod，当前 ${c.value}，可选 personDays 或 equal`;
    case 'purchaseApprovalCents':
      return `金额（元），当前 ${c.value / 100}`;
    case 'quietHours':
      return `静默时段，当前 ${c.value.start}-${c.value.end}，写成 "HH:MM-HH:MM"`;
    case 'choreCarry':
      return `true 或 false，当前 ${c.value}`;
    default:
      return `整数，当前 ${c.value}`;
  }
}

export function createAI({ baseUrl, apiKey, model, visionModel, extraBody, timeoutMs = 10000 }) {
  const available = !!(baseUrl && apiKey && model);
  const vision = available && !!visionModel;

  async function call(messages, { maxTokens = 700, useVision = false } = {}) {
    if (!available) throw new AIError('没有配置模型');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: useVision ? visionModel : model,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          ...(extraBody || {}),
        }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new AIError(`上游返回 ${res.status}`);
      const data = await res.json();
      return parseJson(data?.choices?.[0]?.message?.content);
    } catch (e) {
      if (e instanceof AIError) throw e;
      throw new AIError(e?.name === 'AbortError' ? '超时' : String(e?.message || e));
    } finally {
      clearTimeout(timer);
    }
  }

  async function quickRecord({ text, imageDataUrl, members, me, today }) {
    const user = `今天是 ${today}。当前用户：${me.name}。在住成员：${members.map((m) => m.name).join('、')}。\n用户输入：${text ? clip(text, 300) : '（见图片）'}`;
    const content = imageDataUrl ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: imageDataUrl } }] : user;
    const out = await call([{ role: 'system', content: QUICK_PROMPT }, { role: 'user', content }], { useVision: !!imageDataUrl, maxTokens: 900 });
    const byName = new Map(members.map((m) => [m.name, m.id]));
    const list = Array.isArray(out?.drafts) ? out.drafts.slice(0, 8) : [];
    return list.map((d) => sanitizeDraft(d, byName, me)).filter(Boolean);
  }

  async function rewrite({ from, to, text, context, clauses }) {
    const list = clauses.map((c) => `第 ${c.no} 条：${c.text}`).join('\n');
    const user = `发送人：${from}；接收人：${to}。\n相关事项：${context || '无'}\n当前公约条款：\n${list || '（暂无）'}\n想说的话：${clip(text, 300)}`;
    const out = await call([{ role: 'system', content: REWRITE_PROMPT }, { role: 'user', content: user }], { maxTokens: 500 });
    const valid = new Set(clauses.map((c) => c.no));
    const direct = fixCitations(clip(out?.direct, 120), valid);
    const casual = fixCitations(clip(out?.casual, 120), valid);
    if (!direct && !casual) throw new AIError('没有生成内容');
    return { direct: direct || casual, casual: casual || direct };
  }

  async function pactDraft(answers) {
    const qa = PACT_QUESTIONS.map((q, i) => `${i + 1}. ${q}\n回答：${clip(answers?.[i] || '没说', 120)}`).join('\n');
    const out = await call([{ role: 'system', content: PACT_PROMPT }, { role: 'user', content: qa }], { maxTokens: 1000 });
    const p = out?.params || {};
    const values = structuredClone(DEFAULT_PARAMS);
    const set = (key, v) => {
      try {
        values[key] = normalizeParam(key, v);
      } catch {
        /* 不合法时保留默认值 */
      }
    };
    set('utilitiesMethod', p.utilitiesMethod);
    set('awayMinDays', p.awayMinDays);
    set('freeGuestNights', p.freeGuestNights);
    if (p.purchaseApprovalYuan != null) set('purchaseApprovalCents', Math.round(Number(p.purchaseApprovalYuan) * 100));
    if (typeof p.choreCarry === 'boolean') values.choreCarry = p.choreCarry;
    set('restockNoticeDays', p.restockNoticeDays);
    if (p.quietStart && p.quietEnd) set('quietHours', { start: p.quietStart, end: p.quietEnd });
    set('settleRemindDays', p.settleRemindDays);
    const r = out?.reasons || {};
    const reasons = {};
    for (const key of PARAM_ORDER) {
      const src = key === 'purchaseApprovalCents' ? r.purchaseApprovalYuan ?? r[key] : key === 'quietHours' ? r.quietHours ?? r.quietStart : r[key];
      if (src) reasons[key] = clip(src, 60);
    }
    const texts = (Array.isArray(out?.texts) ? out.texts : [])
      .map((t) => clip(t, 60))
      .filter(Boolean)
      .slice(0, 6);
    const clauses = PARAM_ORDER.map((key, i) => ({ no: i + 1, kind: 'param', key, value: values[key] }));
    texts.forEach((t, i) => clauses.push({ no: PARAM_ORDER.length + 1 + i, kind: 'text', text: t }));
    return { clauses, reasons };
  }

  async function clauseDraft({ text, clauses }) {
    const list = clauses
      .map((c) => (c.kind === 'param' ? `第 ${c.no} 条（参数，${paramHint(c)}）：${c.text}` : `第 ${c.no} 条（文字约定）：${c.text}`))
      .join('\n');
    const out = await call([{ role: 'system', content: CLAUSE_PROMPT }, { role: 'user', content: `当前公约：\n${list}\n\n提醒或异议：${clip(text, 300)}` }], { maxTokens: 400 });
    const reason = clip(out?.reason, 80);
    if (out?.op === 'edit') {
      const c = clauses.find((x) => x.no === Number(out.no));
      if (c && c.kind === 'param') {
        let v = out.value;
        if (c.key === 'purchaseApprovalCents') v = Math.round(Number(v) * 100);
        if (c.key === 'quietHours' && typeof v === 'string') {
          const m = /(\d{2}:\d{2})\D+(\d{2}:\d{2})/.exec(v);
          if (m) v = { start: m[1], end: m[2] };
        }
        if (c.key === 'choreCarry' && typeof v === 'string') v = v === 'true';
        try {
          const value = normalizeParam(c.key, v);
          if (JSON.stringify(value) !== JSON.stringify(c.value)) return { change: { op: 'edit', no: c.no, value }, reason };
        } catch {
          /* 落到新增文字条款 */
        }
      } else if (c && c.kind === 'text' && out.text) {
        return { change: { op: 'edit', no: c.no, text: clip(out.text, 60) }, reason };
      }
    }
    const t = clip(out?.text, 60);
    if (!t) throw new AIError('没有生成条款');
    return { change: { op: 'add', text: t }, reason };
  }

  return { available, vision, quickRecord, rewrite, pactDraft, clauseDraft };
}
