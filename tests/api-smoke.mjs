// 服务端接口冒烟测试：起一个临时服务（不接 AI），走一遍核心流程。
// 运行：node tests/api-smoke.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4399;
const BASE = '/hezuguanjia';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-smoke-'));
const env = { ...process.env, PORT: String(PORT), BASE_PATH: BASE, DATA_DIR: dataDir, AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' };
const proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
proc.stdout.on('data', (d) => (logs += d));
proc.stderr.on('data', (d) => (logs += d));

function client() {
  let cookie = '';
  return async function call(method, p, body) {
    const res = await fetch(`http://127.0.0.1:${PORT}${BASE}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, cookie };
  };
}

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务没有启动：' + logs);
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
  }
}

try {
  await waitUp();
  const a = client();
  const b = client();
  const c = client();
  let roomId, invite, linId, jieId;

  await step('健康检查与配置', async () => {
    const h = await a('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.data.ai, false);
  });
  await step('创建房间', async () => {
    const r = await a('POST', '/api/rooms', { name: '测试 302', myName: '小林', moveIn: '2026-09-01', template: 'recommended' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    roomId = r.data.room.id;
    invite = r.data.room.inviteCode;
    linId = r.data.me;
    assert.match(invite, /^[2-9A-HJ-NP-Z]{6}$/);
    assert.equal(r.data.room.pact.versions[0].status, 'active');
    assert.ok(r.cookie.startsWith('hz_sid='));
  });
  await step('未登录不能读房间', async () => {
    const r = await c('GET', `/api/rooms/${roomId}`);
    assert.equal(r.status, 401);
  });
  await step('邀请信息与加入', async () => {
    const info = await b('GET', `/api/invite/${invite}`);
    assert.equal(info.status, 200);
    assert.equal(info.data.name, '测试 302');
    assert.equal(info.data.pact.clauses.length, 12);
    const bad = await b('POST', '/api/join', { code: invite, name: '阿杰', moveIn: '2026-09-01', agree: false });
    assert.equal(bad.status, 400);
    const ok = await b('POST', '/api/join', { code: invite, name: '阿杰', moveIn: '2026-09-01', agree: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    jieId = ok.data.me;
    assert.equal(ok.data.room.members.length, 2);
  });
  await step('别人不能读不属于自己的房间', async () => {
    const r = await c('POST', '/api/rooms', { name: '别家', myName: '路人', moveIn: '2026-09-01' });
    assert.equal(r.status, 200);
    const x = await c('GET', `/api/rooms/${roomId}`);
    assert.equal(x.status, 403);
  });
  await step('记账、固定金额校验、余额', async () => {
    const bad = await a('POST', `/api/rooms/${roomId}/actions`, { type: 'bill.create', title: '房租', amount: 500000, category: 'rent', method: 'fixed', participants: [linId, jieId], fixed: { [linId]: 300000, [jieId]: 190000 } });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, '还差 ¥100.00');
    const ok = await a('POST', `/api/rooms/${roomId}/actions`, { type: 'bill.create', title: '房租', amount: 500000, category: 'rent', method: 'fixed', participants: [linId, jieId], fixed: { [linId]: 300000, [jieId]: 200000 } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const view = await b('GET', `/api/rooms/${roomId}`);
    const n = view.data.room.notifications.find((x) => x.type === 'bill_new');
    assert.ok(n, '阿杰应收到新账单通知');
    assert.equal(view.data.room.notifications.every((x) => x.to === jieId), true, '只能看到自己的通知');
  });
  await step('异议与乐观锁', async () => {
    const v = await a('GET', `/api/rooms/${roomId}`);
    const bill = v.data.room.bills[0];
    const d = await b('POST', `/api/rooms/${roomId}/actions`, { type: 'bill.dispute', id: bill.id, reason: '我的房间小一点' });
    assert.equal(d.status, 200);
    const stale = await a('POST', `/api/rooms/${roomId}/actions`, { type: 'bill.update', id: bill.id, baseVersion: bill.version - 1, title: '房租' });
    assert.equal(stale.status, 409);
    const fix = await a('POST', `/api/rooms/${roomId}/actions`, { type: 'bill.update', id: bill.id, baseVersion: bill.version, fixed: { [linId]: 310000, [jieId]: 190000 } });
    assert.equal(fix.status, 200, JSON.stringify(fix.data));
    assert.equal(fix.data.room.bills[0].status, 'normal');
  });
  await step('修订影响预览接口', async () => {
    const r = await a('POST', `/api/rooms/${roomId}/preview`, { changes: [{ op: 'edit', no: 2, value: 7 }] });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.preview.notes));
  });
  await step('换设备口令', async () => {
    const r = await b('POST', `/api/rooms/${roomId}/device-code`, {});
    assert.equal(r.status, 200);
    assert.match(r.data.code, /^\d{8}$/);
    const d = client();
    const ok = await d('POST', '/api/device/redeem', { code: r.data.code });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.me, jieId);
    const again = await client()('POST', '/api/device/redeem', { code: r.data.code });
    assert.equal(again.status, 400, '口令只能用一次');
  });
  await step('AI 未配置时返回可降级的错误', async () => {
    const r = await a('POST', `/api/rooms/${roomId}/ai/quick`, { text: '买了洗洁精25.8' });
    assert.equal(r.status, 503);
    assert.equal(r.data.error, 'AI 暂时不可用，可以手动填写');
  });
  await step('演示房间：余额 T8 与切换身份', async () => {
    const d = client();
    const r = await d('POST', '/api/demo', { as: '小林' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const room = r.data.room;
    assert.equal(room.name, '绿洲公寓 702');
    const zhou = room.members.find((m) => m.name === '周周');
    const s = await d('POST', `/api/rooms/${room.id}/demo-switch`, { memberId: zhou.id });
    assert.equal(s.status, 200);
    assert.equal(s.data.me, zhou.id);
    const pending = s.data.room.pact.proposals.find((p) => p.status === 'open');
    assert.ok(pending, '应有进行中的修订');
    const vote = await d('POST', `/api/rooms/${room.id}/actions`, { type: 'proposal.vote', id: pending.id, vote: 'yes' });
    assert.equal(vote.status, 200);
    assert.equal(vote.data.room.pact.proposals.find((p) => p.id === pending.id).status, 'passed');
    assert.equal(vote.data.room.pact.versions.filter((v) => v.status === 'active')[0].v, 2);
  });
  await step('前端入口与 API 404', async () => {
    const r = await a('GET', '/api/nope');
    assert.equal(r.status, 404);
  });
} finally {
  proc.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`共 ${results.length} 项，失败 ${failed} 项`);
if (failed) {
  console.log(logs.slice(-3000));
  process.exit(1);
}
