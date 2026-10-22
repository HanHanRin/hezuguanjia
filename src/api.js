// 数据访问：服务器版走 fetch；静态演示版走 localStorage，共用同一套 core 规则。
import { applyAction, viewRoom, createRoom, joinRoom } from '../core/actions.js';
import { runDaily } from '../core/daily.js';
import { seedDemo, DEMO_NAMES } from '../core/seed.js';
import { toISO } from '../core/dates.js';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const BASE = import.meta.env.BASE_URL || '/';
const API = BASE.replace(/\/+$/, '') + '/api';
const nowIso = () => new Date().toISOString();

// ---------- 服务器版 ----------

async function req(method, p, body, isForm) {
  const res = await fetch(API + p, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: body && !isForm ? JSON.stringify(body) : body,
    credentials: 'same-origin',
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(typeof data === 'object' && data.error ? data.error : '网络出问题了，已保留你的内容，请重试', res.status, data?.code);
  return data;
}

const serverApi = {
  mode: 'server',
  me: () => req('GET', '/me'),
  config: () => req('GET', '/config'),
  createRoom: (b) => req('POST', '/rooms', b),
  invite: (code) => req('GET', `/invite/${encodeURIComponent(code)}`),
  join: (code, b) => req('POST', '/join', { code, ...b }),
  demo: (as, reset) => req('POST', '/demo', { as, reset }),
  redeem: (code) => req('POST', '/device/redeem', { code }),
  room: (id) => req('GET', `/rooms/${encodeURIComponent(id)}`),
  action: (id, a) => req('POST', `/rooms/${encodeURIComponent(id)}/actions`, a),
  preview: (id, changes) => req('POST', `/rooms/${encodeURIComponent(id)}/preview`, { changes }),
  deviceCode: (id) => req('POST', `/rooms/${encodeURIComponent(id)}/device-code`, {}),
  leave: (id) => req('POST', `/rooms/${encodeURIComponent(id)}/leave-device`, {}),
  switchDemo: (id, memberId) => req('POST', `/rooms/${encodeURIComponent(id)}/demo-switch`, { memberId }),
  addLocalMember: null,
  photoUpload: async (id, dataUrl) => (await req('POST', `/rooms/${encodeURIComponent(id)}/photos`, { dataUrl })).photoId,
  photoUrl: (id, photoId) => `${API}/rooms/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
  ai: (id, kind, body) => req('POST', `/rooms/${encodeURIComponent(id)}/ai/${kind}`, body),
  aiPact: (answers) => req('POST', '/ai-pact', { answers }),
  exportData: null,
  importData: null,
};

// ---------- 静态演示版 ----------

const LS_KEY = 'hezuguanjia-v1';

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && s.rooms) {
      s.index = s.index || [];
      return s;
    }
  } catch {
    /* 数据损坏时重建 */
  }
  return { rooms: {}, index: [], current: { roomId: null, memberId: null } };
}

let state = loadState();

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function docOf(id) {
  const doc = state.rooms[id];
  if (!doc) throw new ApiError('这台设备上没有这个房间了', 404);
  return doc;
}

function payload(id, memberId) {
  const room = docOf(id);
  const t = nowIso();
  runDaily(room, t);
  save();
  const me = room.members.find((m) => m.id === memberId && m.status === 'active');
  if (!me) throw new ApiError('你已经不在这个房间里了', 403);
  const cur = state.index.find((x) => x.id === id);
  if (cur) cur.memberId = memberId;
  state.current = { roomId: id, memberId };
  save();
  return { room: viewRoom(room, memberId, t), me: memberId, rev: (state.rev = (state.rev || 0) + 1), ai: { available: false, vision: false }, serverNow: t, static: true };
}

function indexList() {
  const out = [];
  for (const x of state.index) {
    const room = state.rooms[x.id];
    const m = room?.members.find((m) => m.id === x.memberId && m.status === 'active');
    if (!m) continue;
    out.push({ id: x.id, name: room.name, demo: !!room.demo, memberId: m.id, memberName: m.name, color: m.color });
  }
  return { rooms: out };
}

const localApi = {
  mode: 'static',
  me: async () => indexList(),
  config: async () => ({ ai: false, vision: false, questions: [], demoNames: DEMO_NAMES }),
  async createRoom(b) {
    const id = 'local-' + Math.random().toString(36).slice(2, 9);
    const t = nowIso();
    const { room, memberId } = createRoom({ id, name: b.name, myName: b.myName, moveIn: b.moveIn, template: b.template, clauses: b.clauses, activateNow: b.activateNow !== false, now: t });
    if (b.ai === false) room.aiEnabled = false;
    state.rooms[id] = room;
    state.index.push({ id, memberId });
    save();
    return payload(id, memberId);
  },
  async addLocalMember(id, b) {
    const room = docOf(id);
    const m = joinRoom(room, { name: b.name, moveIn: b.moveIn, agree: true }, nowIso());
    save();
    return payload(id, m.id);
  },
  async room(id) {
    const cur = state.index.find((x) => x.id === id) || state.current;
    return payload(id, cur?.memberId);
  },
  async action(id, a) {
    const room = docOf(id);
    const memberId = state.index.find((x) => x.id === id)?.memberId;
    const copy = structuredClone(room);
    applyAction(copy, memberId, a, nowIso());
    state.rooms[id] = copy;
    save();
    return payload(id, memberId);
  },
  async preview(id, changes) {
    const { proposalPreview } = await import('../core/preview.js');
    return { preview: proposalPreview(docOf(id), changes, nowIso()) };
  },
  async demo(as, reset) {
    const existing = state.index.find((x) => state.rooms[x.id]?.demo);
    if (existing && !reset) return payload(existing.id, pickDemo(existing.id, as));
    if (existing) {
      delete state.rooms[existing.id];
      state.index = state.index.filter((x) => x.id !== existing.id);
    }
    const id = 'demo';
    const { room } = seedDemo({ id, now: nowIso() });
    state.rooms[id] = room;
    state.index = state.index.filter((x) => x.id !== id);
    state.index.push({ id, memberId: pickDemo(id, as) });
    save();
    return payload(id, pickDemo(id, as));
  },
  async switchDemo(id, memberId) {
    return payload(id, memberId);
  },
  async leave(id) {
    state.index = state.index.filter((x) => x.id !== id);
    state.current = { roomId: null, memberId: null };
    save();
    return { ok: true };
  },
  async photoUpload() {
    throw new ApiError('演示版在单台设备上运行，暂不支持传图片凭证，可以在完整版使用', 400);
  },
  photoUrl: () => '',
  async ai() {
    throw new ApiError('演示版没有 AI，完整版可以随口记账、和气提醒和起草公约', 503);
  },
  async aiPact() {
    throw new ApiError('演示版没有 AI，可以选推荐模板', 503);
  },
  async exportData() {
    return JSON.stringify({ app: 'hezuguanjia', v: 1, exportedAt: nowIso(), state }, null, 2);
  },
  async importData(text) {
    const data = JSON.parse(text);
    if (!data?.state?.rooms) throw new ApiError('备份文件格式不对');
    state = data.state;
    if (!state.index) state.index = [];
    save();
    return indexList();
  },
};

function pickDemo(id, as) {
  const room = state.rooms[id];
  const m = room.members.find((x) => x.name === as && x.status === 'active') || room.members.find((x) => x.status === 'active');
  return m.id;
}

export const api = __STATIC__ ? localApi : serverApi;
export const STATIC = !!__STATIC__;
