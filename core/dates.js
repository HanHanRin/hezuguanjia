// 日期一律按 Asia/Shanghai 的日历日（YYYY-MM-DD）处理，不用时间戳相减。
// 上海自 1991 年起不实行夏令时，固定 UTC+8，所以这里直接用固定偏移换算。

export const DAY_MS = 86400000;
const OFFSET_MS = 8 * 3600000;
const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(s) {
  if (typeof s !== 'string') return false;
  const m = RE.exec(s);
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return new Date(t).toISOString().slice(0, 10) === s;
}

export function dayNum(s) {
  const m = RE.exec(s);
  if (!m) throw new Error(`日期格式不对：${s}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

export function fromDayNum(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return fromDayNum(dayNum(s) + n);
}

/** b − a 的天数 */
export function diffDays(a, b) {
  return dayNum(b) - dayNum(a);
}

/** 两端都算的天数 */
export function daysIncl(a, b) {
  return b < a ? 0 : diffDays(a, b) + 1;
}

export function overlapDays(a1, b1, a2, b2) {
  const s = a1 > a2 ? a1 : a2;
  const e = b1 < b2 ? b1 : b2;
  return daysIncl(s, e);
}

/** 周一 = 1 … 周日 = 7 */
export function weekday(s) {
  const d = new Date(dayNum(s) * DAY_MS).getUTCDay();
  return d === 0 ? 7 : d;
}

export function mondayOf(s) {
  return addDays(s, 1 - weekday(s));
}

export function toISO(now) {
  return new Date(now).toISOString();
}

/** 某个时刻在上海的日期 */
export function localDate(now) {
  return new Date(new Date(now).getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** 某个时刻在上海是一天中的第几分钟 */
export function localMinutes(now) {
  const d = new Date(new Date(now).getTime() + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 上海某天某时某分对应的 ISO 时间 */
export function localISO(date, h = 0, m = 0) {
  return new Date(dayNum(date) * DAY_MS + (h * 60 + m) * 60000 - OFFSET_MS).toISOString();
}

export function addHours(iso, h) {
  return new Date(new Date(iso).getTime() + h * 3600000).toISOString();
}

export const WEEK_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 10月26日 周一；跨年时加年份 */
export function fmtDate(s, today) {
  const [y, mo, d] = s.split('-');
  const base = `${+mo}月${+d}日 ${WEEK_CN[weekday(s)]}`;
  return today && today.slice(0, 4) !== y ? `${y}年${base}` : base;
}

/** 10月26日；跨年时加年份 */
export function fmtShort(s, today) {
  const [y, mo, d] = s.split('-');
  const base = `${+mo}月${+d}日`;
  return today && today.slice(0, 4) !== y ? `${y}年${base}` : base;
}

export function fmtTime(iso) {
  const m = localMinutes(iso);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDateTime(iso, today) {
  return `${fmtShort(localDate(iso), today)} ${fmtTime(iso)}`;
}

/** ¥1,234.56，始终两位小数；负数前加 − */
export function fmtMoney(cents, { sign = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = `¥${yuan}.${String(abs % 100).padStart(2, '0')}`;
  if (neg) return `−${s}`;
  return sign && cents > 0 ? `+${s}` : s;
}

/** 386.40（算式里用，不带 ¥ 和千分位） */
export function fmtYuan(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '−' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 把用户输入的金额转成“分”；无法识别返回 null */
export function parseMoney(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  if (typeof input !== 'string') return null;
  const s = input.replace(/[¥￥,，\s元]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}
