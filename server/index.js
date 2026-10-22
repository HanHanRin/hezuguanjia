// 合租生活管家 · 服务端。零运行时依赖：Node 内置 http + node:sqlite。
// 运行：PORT=4330 BASE_PATH=/hezuguanjia node server/index.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, prepare } from './db.js';
import { createAI, AIError, PACT_QUESTIONS } from './ai.js';
import { loadEnv } from './env.js';
import { applyAction, createRoom, joinRoom, viewRoom, randomCode, proposalPreview } from '../core/actions.js';
import { ActionError } from '../core/util.js';
import { runDaily } from '../core/daily.js';
import { seedDemo, DEMO_NAMES } from '../core/seed.js';
import { localDate, toISO, addHours, isDate } from '../core/dates.js';
import { currentClauses, clauseText } from '../core/pact.js';
import { residents } from '../core/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 4330);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SECURE = process.env.COOKIE_SECURE === '1';
const COOKIE = 'hz_sid';
const SESSION_DAYS = 180;
const AI_DAILY = Number(process.env.AI_DAILY_LIMIT || 50);
const AI_DEMO_DAILY = Number(process.env.AI_DEMO_DAILY_LIMIT || 10);
const AI_GLOBAL_DAILY = Number(process.env.AI_GLOBAL_DAILY_LIMIT || 600);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 300);
const MAX_DEMO_ROOMS = Number(process.env.MAX_DEMO_ROOMS || 300);
const now = () => (process.env.FAKE_NOW ? process.env.FAKE_NOW : toISO(Date.now()));

const db = openDb(DATA_DIR);
const q = prepare(db);
const ai = createAI({
  baseUrl: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
  model: process.env.AI_MODEL,
  visionModel: process.env.AI_VISION_MODEL || '',
  extraBody: process.env.AI_DISABLE_THINKING === '1' ? { thinking: { type: 'disabled' } } : null,
  timeoutMs: 10000,
});

// ---------- 小工具 ----------

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rid = (prefix) => prefix + crypto.randomBytes(9).toString('base64url');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, token) {
  const parts = [`${COOKIE}=${token}`, `Path=${BASE || '/'}`, `Max-Age=${SESSION_DAYS * 86400}`, 'HttpOnly', 'SameSite=Lax'];
  if (SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' || Buffer.isBuffer(body) ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, '内容太大了');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求格式不对');
  }
}

// 简单限流：按会话或 IP 每分钟次数
const buckets = new Map();
function limit(key, max, windowMs = 60000) {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || t - b.start > windowMs) {
    buckets.set(key, { start: t, n: 1 });
    return;
  }
  b.n += 1;
  if (b.n > max) throw new HttpError(429, '操作太频繁了，稍等一下再试');
}
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (t - b.start > 120000) buckets.delete(k);
}, 60000).unref();

function ipOf(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// ---------- 会话 ----------

function getSession(req, res, create) {
  const tok = parseCookies(req)[COOKIE];
  const t = now();
  if (tok && /^[A-Za-z0-9_-]{20,80}$/.test(tok)) {
    const s = q.session.get(sha(tok));
    if (s && s.expires_at > t) {
      if (s.last_seen.slice(0, 10) !== t.slice(0, 10)) {
        q.touchSession.run(addHours(t, SESSION_DAYS * 24), t, s.hash);
        setCookie(res, tok);
      }
      return s.hash;
    }
  }
  if (!create) return null;
  const token = crypto.randomBytes(24).toString('base64url');
  const hash = sha(token);
  q.insertSession.run(hash, t, addHours(t, SESSION_DAYS * 24), t);
  setCookie(res, token);
  return hash;
}

// ---------- 房间读写 ----------

function loadRoom(id) {
  const row = q.room.get(id);
  if (!row) throw new HttpError(404, '房间不存在');
  return { room: JSON.parse(row.data), rev: row.rev, demo: !!row.demo };
}

function saveRoom(room, rev) {
  const r = q.updateRoom.run(JSON.stringify(room), room.name, room.demo ? null : room.inviteCode, now(), room.id, rev);
  if (r.changes !== 1) throw new HttpError(409, '数据刚刚有更新，请重试', 'stale');
}

/** 读写同一个房间：失败重试 3 次，保证并发安全 */
function mutate(roomId, fn) {
  for (let i = 0; i < 3; i++) {
    const { room, rev } = loadRoom(roomId);
    const out = fn(room);
    try {
      saveRoom(room, rev);
      return { room, out };
    } catch (e) {
      if (e instanceof HttpError && e.code === 'stale' && i < 2) continue;
      throw e;
    }
  }
  throw new HttpError(409, '数据刚刚有更新，请重试');
}

function memberFor(session, roomId) {
  if (!session) throw new HttpError(401, '请先加入房间', 'no_session');
  const m = q.membership.get(session, roomId);
  if (!m) throw new HttpError(403, '你还不是这个房间的成员', 'not_member');
  return m.member_id;
}

/** 读取房间时顺便做每日任务（幂等），并返回给当前成员看的视图 */
function freshView(roomId, memberId) {
  const t = now();
  let { room, rev } = loadRoom(roomId);
  if (runDaily(room, t)) {
    try {
      saveRoom(room, rev);
    } catch {
      ({ room } = loadRoom(roomId));
    }
  }
  const me = room.members.find((m) => m.id === memberId);
  if (!me || me.status !== 'active') {
    q.delMemberMemberships.run(roomId, memberId);
    throw new HttpError(403, me ? '你已经退租，房间记录对你只读不可见' : '你已经不在这个房间里了', 'not_member');
  }
  return viewRoom(room, memberId, t);
}

function roomPayload(roomId, memberId) {
  const view = freshView(roomId, memberId);
  return { room: view, me: memberId, rev: q.room.get(roomId).rev, ai: aiFlags(view), serverNow: now() };
}

function aiFlags(room) {
  return { available: ai.available && room.aiEnabled !== false, vision: ai.vision, provider: ai.available ? 'server' : null };
}

function uniqueInvite() {
  for (let i = 0; i < 20; i++) {
    const c = randomCode(6);
    if (!q.inviteTaken.get(c)) return c;
  }
  throw new HttpError(500, '生成邀请码失败，请重试');
}

function countRooms(demo) {
  const rows = q.countRooms.all();
  return rows.find((r) => r.demo === (demo ? 1 : 0))?.n || 0;
}

function cleanupDemo() {
  const cutoff = addHours(now(), -72);
  for (const r of q.oldDemo.all(cutoff)) dropRoom(r.id);
}

function dropRoom(id) {
  q.delRoomMemberships.run(id);
  q.delRoomPhotos.run(id);
  q.deleteRoom.run(id);
}

function maintenance() {
  const t = now();
  q.delSessions.run(t);
  q.delOrphanMemberships.run();
  q.delCodes.run(t);
  q.delUsage.run(localDate(addHours(t, -24 * 7)));
  cleanupDemo();
  // 每天 08:00 前后为所有房间跑一次每日任务（打开应用时也会补算）
  for (const r of q.allRoomIds.all()) {
    try {
      const { room, rev } = loadRoom(r.id);
      if (runDaily(room, t)) saveRoom(room, rev);
    } catch {
      /* 下次再试 */
    }
  }
}
setInterval(maintenance, 15 * 60000).unref();

// ---------- AI ----------

function aiQuota(room, session) {
  const day = localDate(now());
  const max = room.demo ? AI_DEMO_DAILY : AI_DAILY;
  const used = q.aiUsage.get(`room:${room.id}`, day)?.n || 0;
  if (used >= max) throw new HttpError(429, `今天这个房间的 AI 次数（${max} 次）用完了，可以手动填写`, 'ai_quota');
  const g = q.aiUsage.get('global', day)?.n || 0;
  if (g >= AI_GLOBAL_DAILY) throw new HttpError(429, '今天 AI 的总次数用完了，可以手动填写', 'ai_quota');
  limit(`ai:${session}`, 8);
  q.aiInc.run(`room:${room.id}`, day);
  q.aiInc.run('global', day);
}

async function aiCall(req, res, roomId, kind, body) {
  const session = getSession(req, res, false);
  const memberId = memberFor(session, roomId);
  const { room } = loadRoom(roomId);
  if (!ai.available) throw new HttpError(503, 'AI 暂时不可用，可以手动填写', 'ai_off');
  if (room.aiEnabled === false) throw new HttpError(403, '这个房间关闭了 AI 功能', 'ai_off');
  const me = room.members.find((m) => m.id === memberId);
  aiQuota(room, session);
  const today = localDate(now());
  const clauses = currentClauses(room).map((c) => ({ no: c.no, kind: c.kind, key: c.key, value: c.value, text: clauseText(c) }));
  try {
    if (kind === 'quick') {
      let image = null;
      if (body.image) {
        if (!ai.vision) throw new HttpError(400, '当前模型不支持识别图片');
        if (typeof body.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(body.image) || body.image.length > 2_800_000) throw new HttpError(400, '图片格式或大小不对（最大约 2MB）');
        image = body.image;
      }
      if (!image && !String(body.text || '').trim()) throw new HttpError(400, '先写一句话，比如“买了洗洁精25.8，四个人平摊”');
      const drafts = await ai.quickRecord({ text: body.text, imageDataUrl: image, members: residents(room, today), me, today });
      return { drafts };
    }
    if (kind === 'rewrite') {
      const to = room.members.find((m) => m.id === body.to && m.status === 'active');
      if (!to) throw new HttpError(400, '请选择要提醒的人');
      if (!String(body.text || '').trim()) throw new HttpError(400, '先写下你想说的话');
      return await ai.rewrite({ from: me.name, to: to.name, text: body.text, context: String(body.context || '').slice(0, 200), clauses });
    }
    if (kind === 'pact') {
      if (!Array.isArray(body.answers)) throw new HttpError(400, '请回答问题');
      return await ai.pactDraft(body.answers.map((a) => String(a || '')));
    }
    if (kind === 'clause') {
      if (!String(body.text || '').trim()) throw new HttpError(400, '缺少内容');
      return await ai.clauseDraft({ text: body.text, clauses });
    }
    throw new HttpError(404, '没有这个功能');
  } catch (e) {
    if (e instanceof AIError) throw new HttpError(502, 'AI 暂时不可用，可以手动填写', 'ai_fail');
    throw e;
  }
}

// ---------- 路由 ----------

async function api(req, res, pathname) {
  const method = req.method;
  const ip = ipOf(req);
  limit(`ip:${ip}`, 240);
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin && req.headers.host && new URL(origin).host !== req.headers.host) throw new HttpError(403, '来源不对');
  }
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]

  if (method === 'GET' && seg[1] === 'health') return send(res, 200, { ok: true, ai: ai.available, vision: ai.vision, now: now() });

  if (method === 'GET' && seg[1] === 'config') return send(res, 200, { ai: ai.available, vision: ai.vision, questions: PACT_QUESTIONS, demoNames: DEMO_NAMES });

  if (method === 'POST' && seg[1] === 'ai-pact') {
    // 创建房间之前起草公约：按 IP 限流，只走全局额度
    limit(`pact-ai:${ip}`, 10, 3600000);
    if (!ai.available) throw new HttpError(503, 'AI 暂时不可用，可以手动选择模板', 'ai_off');
    const day = localDate(now());
    if ((q.aiUsage.get('global', day)?.n || 0) >= AI_GLOBAL_DAILY) throw new HttpError(429, '今天 AI 的总次数用完了，可以手动选择模板', 'ai_quota');
    q.aiInc.run('global', day);
    const body = await readBody(req);
    if (!Array.isArray(body.answers)) throw new HttpError(400, '请回答问题');
    try {
      return send(res, 200, await ai.pactDraft(body.answers.map((a) => String(a || ''))));
    } catch (e) {
      if (e instanceof AIError) throw new HttpError(502, 'AI 暂时不可用，可以手动选择模板', 'ai_fail');
      throw e;
    }
  }

  if (method === 'GET' && seg[1] === 'me') {
    const session = getSession(req, res, false);
    if (!session) return send(res, 200, { rooms: [] });
    const rooms = [];
    for (const r of q.memberships.all(session)) {
      const room = JSON.parse(r.data);
      const m = room.members.find((x) => x.id === r.member_id);
      if (!m || m.status !== 'active') continue;
      rooms.push({ id: r.room_id, name: room.name, demo: !!room.demo, memberId: r.member_id, memberName: m.name, color: m.color });
    }
    return send(res, 200, { rooms });
  }

  if (method === 'POST' && seg[1] === 'rooms' && seg.length === 2) {
    limit(`create:${ip}`, 10, 3600000);
    if (countRooms(false) >= MAX_ROOMS) throw new HttpError(503, '房间数量达到上限，请联系管理员');
    const body = await readBody(req);
    if (!isDate(body.moveIn)) throw new HttpError(400, '请填写入住日期');
    const session = getSession(req, res, true);
    const id = rid('r');
    const t = now();
    const { room, memberId } = createRoom({ id, name: body.name, myName: body.myName, moveIn: body.moveIn, template: body.template, clauses: body.clauses, activateNow: body.activateNow !== false, now: t });
    room.inviteCode = uniqueInvite();
    if (body.ai === false) room.aiEnabled = false;
    q.insertRoom.run(id, room.name, room.inviteCode, 0, JSON.stringify(room), t, t);
    q.addMembership.run(session, id, memberId, t);
    return send(res, 200, roomPayload(id, memberId));
  }

  if (method === 'POST' && seg[1] === 'demo' && seg.length === 2) {
    limit(`demo:${ip}`, 12, 3600000);
    const body = await readBody(req);
    const as = DEMO_NAMES.includes(body.as) ? body.as : DEMO_NAMES[0];
    const session = getSession(req, res, true);
    const existing = q.memberships.all(session).find((r) => JSON.parse(r.data).demo);
    let roomId;
    if (existing && !body.reset) {
      roomId = existing.room_id;
    } else {
      if (existing) {
        q.delMembership.run(session, existing.room_id);
        if ((q.roomSessions.get(existing.room_id)?.n || 0) === 0) dropRoom(existing.room_id);
      }
      cleanupDemo();
      if (countRooms(true) >= MAX_DEMO_ROOMS) throw new HttpError(503, '演示房间太多了，稍后再试');
      roomId = rid('d');
      const t = now();
      const { room } = seedDemo({ id: roomId, now: t });
      q.insertRoom.run(roomId, room.name, null, 1, JSON.stringify(room), t, t);
    }
    const { room } = loadRoom(roomId);
    const m = room.members.find((x) => x.name === as && x.status === 'active') || room.members.find((x) => x.status === 'active');
    q.addMembership.run(session, roomId, m.id, now());
    return send(res, 200, roomPayload(roomId, m.id));
  }

  if (method === 'GET' && seg[1] === 'invite' && seg[2]) {
    limit(`invite:${ip}`, 30);
    const row = q.roomByInvite.get(String(seg[2]).toUpperCase());
    if (!row) throw new HttpError(404, '邀请码不对，或者已经被重置了');
    const room = JSON.parse(row.data);
    const pactV = room.pact.versions.filter((v) => v.status !== 'retired').pop();
    return send(res, 200, {
      roomId: room.id,
      name: room.name,
      members: room.members.filter((m) => m.status === 'active').map((m) => ({ name: m.name, color: m.color })),
      pact: pactV ? { v: pactV.v, status: pactV.status, clauses: pactV.clauses.map((c) => ({ no: c.no, kind: c.kind, text: clauseText(c) })) } : null,
      full: room.members.filter((m) => m.status === 'active').length >= 6,
    });
  }

  if (method === 'POST' && seg[1] === 'join') {
    limit(`join:${ip}`, 20, 3600000);
    const body = await readBody(req);
    const row = q.roomByInvite.get(String(body.code || '').toUpperCase());
    if (!row) throw new HttpError(404, '邀请码不对，或者已经被重置了');
    const session = getSession(req, res, true);
    if (q.membership.get(session, row.id)) return send(res, 200, roomPayload(row.id, q.membership.get(session, row.id).member_id));
    let memberId;
    mutate(row.id, (room) => {
      memberId = joinRoom(room, { name: body.name, moveIn: body.moveIn, agree: !!body.agree }, now()).id;
    });
    q.addMembership.run(session, row.id, memberId, now());
    return send(res, 200, roomPayload(row.id, memberId));
  }

  if (method === 'POST' && seg[1] === 'device' && seg[2] === 'redeem') {
    limit(`redeem:${ip}`, 10, 600000);
    const body = await readBody(req);
    const code = String(body.code || '').replace(/\D/g, '');
    const row = code.length === 8 ? q.code.get(code) : null;
    if (!row || row.expires_at < now()) throw new HttpError(400, '口令不对或已过期，请在原设备上重新生成');
    q.delCode.run(code);
    const session = getSession(req, res, true);
    q.addMembership.run(session, row.room_id, row.member_id, now());
    return send(res, 200, roomPayload(row.room_id, row.member_id));
  }

  if (seg[1] === 'rooms' && seg[2]) {
    const roomId = seg[2];
    const sub = seg[3];
    if (method === 'GET' && !sub) {
      const session = getSession(req, res, false);
      return send(res, 200, roomPayload(roomId, memberFor(session, roomId)));
    }
    if (method === 'POST' && sub === 'actions') {
      const session = getSession(req, res, false);
      const memberId = memberFor(session, roomId);
      limit(`act:${session}`, 60);
      const action = await readBody(req, 200_000);
      const t = now();
      let result;
      const { room } = mutate(roomId, (rm) => {
        runDaily(rm, t);
        result = applyAction(rm, memberId, action, t);
      });
      if (['member.finalize', 'member.remove'].includes(action.type)) {
        for (const m of room.members) if (m.status !== 'active') q.delMemberMemberships.run(roomId, m.id);
        const alive = new Set(room.members.map((m) => m.id));
        if (action.type === 'member.remove' && !alive.has(action.memberId)) q.delMemberMemberships.run(roomId, action.memberId);
      }
      if (action.type === 'member.finalize' && (action.memberId ?? memberId) === memberId) return send(res, 200, { result, left: true });
      return send(res, 200, { result, ...roomPayload(roomId, memberId) });
    }
    if (method === 'POST' && sub === 'preview') {
      const session = getSession(req, res, false);
      memberFor(session, roomId);
      const body = await readBody(req);
      const { room } = loadRoom(roomId);
      return send(res, 200, { preview: proposalPreview(room, body.changes, now()) });
    }
    if (method === 'POST' && sub === 'device-code') {
      const session = getSession(req, res, false);
      const memberId = memberFor(session, roomId);
      limit(`code:${session}`, 5);
      const code = String(crypto.randomInt(10_000_000, 100_000_000));
      const exp = addHours(now(), 1 / 6);
      q.insertCode.run(code, roomId, memberId, exp);
      return send(res, 200, { code, expiresAt: exp });
    }
    if (method === 'POST' && sub === 'leave-device') {
      const session = getSession(req, res, false);
      memberFor(session, roomId);
      q.delMembership.run(session, roomId);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && sub === 'demo-switch') {
      const session = getSession(req, res, false);
      memberFor(session, roomId);
      const { room } = loadRoom(roomId);
      if (!room.demo) throw new HttpError(403, '只有演示房间可以切换身份');
      const body = await readBody(req);
      const m = room.members.find((x) => x.id === body.memberId && x.status === 'active');
      if (!m) throw new HttpError(400, '没有这位成员');
      q.addMembership.run(session, roomId, m.id, now());
      return send(res, 200, roomPayload(roomId, m.id));
    }
    if (method === 'POST' && sub === 'photos') {
      const session = getSession(req, res, false);
      memberFor(session, roomId);
      limit(`photo:${session}`, 10);
      const body = await readBody(req, 1_500_000);
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
      if (!m) throw new HttpError(400, '只支持 JPG、PNG、WebP 图片');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 1_000_000) throw new HttpError(413, '图片太大了，请压缩到 1MB 以内');
      if ((q.countPhotos.get(roomId)?.n || 0) >= 300) throw new HttpError(400, '这个房间的图片太多了');
      const id = rid('f');
      q.insertPhoto.run(id, roomId, m[1], buf, now());
      return send(res, 200, { photoId: id });
    }
    if (method === 'GET' && sub === 'photos' && seg[4]) {
      const session = getSession(req, res, false);
      memberFor(session, roomId);
      const row = q.photo.get(seg[4], roomId);
      if (!row) throw new HttpError(404, '图片不存在');
      return send(res, 200, Buffer.from(row.data), { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400' });
    }
    if (method === 'POST' && sub === 'ai' && seg[4]) {
      const body = await readBody(req, 3_000_000);
      return send(res, 200, await aiCall(req, res, roomId, seg[4], body));
    }
    if (method === 'POST' && sub === 'demo-reset') {
      throw new HttpError(400, '请使用“重新载入演示数据”');
    }
  }
  throw new HttpError(404, '接口不存在');
}

// ---------- 静态文件 ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

function serveStatic(res, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(DIST, safe);
  if (!file.startsWith(DIST)) return send(res, 404, 'not found');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) return send(res, 503, '前端还没有构建：npm run build:server');
  const ext = path.extname(file);
  const hashed = /\/assets\//.test(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...(ext === '.html' ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'same-origin' } : {}),
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (BASE) {
      if (p === BASE) {
        res.writeHead(301, { Location: BASE + '/' + url.search });
        return res.end();
      }
      if (!p.startsWith(BASE + '/')) return send(res, 404, 'not found');
      p = p.slice(BASE.length);
    }
    if (p.startsWith('/api/')) return await api(req, res, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(res, p.replace(/^\/+/, ''));
  } catch (e) {
    if (e instanceof ActionError) {
      const status = e.code === 'forbidden' ? 403 : e.code === 'conflict' ? 409 : e.code === 'not_found' ? 404 : 400;
      return send(res, status, { error: e.message, code: e.code });
    }
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
    console.error(new Date().toISOString(), e);
    return send(res, 500, { error: '服务器出了点问题，已保留你的内容，请稍后重试' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`合租生活管家已启动：http://${HOST}:${PORT}${BASE}/  AI=${ai.available ? 'on' : 'off'} vision=${ai.vision ? 'on' : 'off'}`);
  maintenance();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
