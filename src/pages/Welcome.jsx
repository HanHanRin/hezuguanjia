import React, { useState } from 'react';
import { useApp } from '../store.jsx';
import { Btn, Field, Sheet, Banner, Seg } from '../ui.jsx';
import { isDate } from '../../core/dates.js';
import { todayOf } from '../derive.js';

const LOGO = (
  <span className="hero-logo">
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <path d="M16 7 6 15.5h3V24h6v-5h2v5h6v-8.5h3z" fill="#fff" />
    </svg>
  </span>
);

export default function Welcome() {
  const { api, staticMode, config, selectRoom, openDemo, showToast, loadRoom } = useApp();
  const [mode, setMode] = useState(() => new URLSearchParams(location.search).get('join') ? 'join' : 'home');
  return (
    <div className="content">
      <div className="card hero-card">
        {LOGO}
        <h2 style={{ margin: '0 0 6px' }}>合租生活管家</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          把室友之间说好的规矩写成公约：费用 AA、清洁排班、公共物品和提醒，都按公约自动执行，有分歧先看影响再表决。
        </p>
        {staticMode && (
          <Banner tone="warn">
            这是部署在 GitHub Pages 上的演示版：数据只保存在这台设备的浏览器里，室友之间不会同步，也没有 AI。想多人使用请使用
            {' '}<a href="https://yuhaipei.cn/hezuguanjia/" rel="noreferrer">完整版</a>。
          </Banner>
        )}
        {mode === 'home' && (
          <div className="btn-row">
            <Btn block onClick={() => setMode('create')}>
              创建房间
            </Btn>
            <Btn block variant="ghost" onClick={() => setMode('join')}>
              我有邀请码
            </Btn>
          </div>
        )}
        {mode === 'home' && (
          <div className="btn-row mt8">
            <Btn block variant="subtle" onClick={() => openDemo('小林')}>
              先逛逛演示房间
            </Btn>
            {!staticMode && (
              <Btn block variant="subtle" onClick={() => setMode('device')}>
                换台设备登录
              </Btn>
            )}
          </div>
        )}
        {mode === 'create' && <CreateFlow api={api} config={config} staticMode={staticMode} onDone={selectRoom} onBack={() => setMode('home')} showToast={showToast} />}
        {mode === 'join' && <JoinFlow api={api} initialCode={new URLSearchParams(location.search).get('join')} onDone={loadRoom} onBack={() => setMode('home')} showToast={showToast} />}
        {mode === 'device' && <DeviceFlow api={api} onDone={loadRoom} onBack={() => setMode('home')} showToast={showToast} />}
      </div>
      <p className="muted tc" style={{ maxWidth: 480, margin: '0 auto' }}>
        所有金额按“分”精确计算，分摊合计严格等于总额；值日按家务积分均衡排班；提醒只发给当事人，不点名、不排名。
      </p>
    </div>
  );
}

function CreateFlow({ api, config, staticMode, onDone, onBack, showToast }) {
  const today = todayOf();
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: '', myName: '', moveIn: today, template: 'recommended', clauses: null, reasons: null, activateNow: true });
  const [ans, setAns] = useState(Array(6).fill(''));
  const [aiBusy, setAiBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function draftPact() {
    setAiBusy(true);
    try {
      const r = await api.aiPact(ans);
      set('clauses', r.clauses);
      set('reasons', r.reasons || null);
      set('template', 'custom');
      showToast('AI 已起草，可逐条修改');
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setAiBusy(false);
    }
  }

  async function submit() {
    try {
      const r = await api.createRoom({
        name: f.name,
        myName: f.myName,
        moveIn: f.moveIn,
        template: f.template,
        clauses: f.template === 'custom' ? f.clauses : null,
        activateNow: f.activateNow,
      });
      showToast('房间已创建');
      onDone(r.room.id);
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  return (
    <>
      {step === 1 && (
        <>
          <Field label="房间名">
            <input className="input" maxLength={20} placeholder="例如：绿洲公寓 702" value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="你的昵称">
            <input className="input" maxLength={12} placeholder="室友会看到的名字" value={f.myName} onChange={(e) => set('myName', e.target.value)} />
          </Field>
          <Field label="入住日期">
            <input type="date" className="input" value={f.moveIn} onChange={(e) => set('moveIn', e.target.value)} />
          </Field>
          <div className="btn-row mt16">
            <Btn variant="subtle" onClick={onBack}>
              返回
            </Btn>
            <Btn disabled={!f.name.trim() || !f.myName.trim() || !isDate(f.moveIn)} onClick={() => setStep(2)}>
              下一步
            </Btn>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <Field label="第一版公约怎么定？">
            <Seg
              value={f.template}
              onChange={(v) => set('template', v)}
              options={[
                { value: 'recommended', label: '推荐模板（含作息、厨房等约定）' },
                { value: 'basic', label: '只留参与计算的参数条款' },
                { value: 'custom', label: '自定义' },
              ]}
            />
          </Field>
          {!config?.ai && (
            <Banner tone="warn">这个部署没有启用 AI。可以选模板，创建后也可以随时发起修订。</Banner>
          )}
          {config?.ai && f.template !== 'custom' && (
            <div className="card" style={{ background: 'var(--bg)' }}>
              <h3>或者让 AI 起草（回答 6 个问题）</h3>
              {(config.questions || []).map((q, i) => (
                <Field key={i} label={`${i + 1}. ${q}`}>
                  <textarea className="textarea" value={ans[i]} onChange={(e) => setAns(ans.map((x, j) => (j === i ? e.target.value : x)))} />
                </Field>
              ))}
              <Btn variant="ghost" small disabled={aiBusy || ans.every((x) => !x.trim())} onClick={draftPact}>
                {aiBusy ? '起草中…' : '让 AI 起草公约'}
              </Btn>
            </div>
          )}
          {f.template === 'custom' && f.clauses && <ClauseEditor clauses={f.clauses} reasons={f.reasons} onChange={(c) => set('clauses', c)} />}
          <Field label="首版什么时候生效？">
            <Seg
              value={f.activateNow ? 'now' : 'sign'}
              onChange={(v) => set('activateNow', v === 'now')}
              options={[
                { value: 'now', label: '立即生效（室友加入时签署）' },
                { value: 'sign', label: '等室友加入后全员签署' },
              ]}
            />
          </Field>
          <div className="btn-row mt16">
            <Btn variant="subtle" onClick={() => setStep(1)}>
              上一步
            </Btn>
            <Btn onClick={submit}>创建房间</Btn>
          </div>
        </>
      )}
    </>
  );
}

function ClauseEditor({ clauses, reasons, onChange }) {
  const update = (i, patch) => onChange(clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      {clauses.map((c, i) => (
        <div key={i} className="list-line" style={{ display: 'block' }}>
          <div className="muted">
            第 {c.no} 条 {c.kind === 'param' ? '· 参数条款' : '· 约定'}
            {c.kind === 'param' && reasons?.[c.key] ? `：${reasons[c.key]}` : ''}
          </div>
          {c.kind === 'param' ? (
            <ParamInput clause={c} onChange={(v) => update(i, { value: v })} />
          ) : (
            <textarea className="textarea" maxLength={120} value={c.text} onChange={(e) => update(i, { text: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}

function ParamInput({ clause, onChange }) {
  const { key, value } = clause;
  if (key === 'utilitiesMethod')
    return (
      <Seg value={value} onChange={onChange} options={[{ value: 'personDays', label: '按在住人天' }, { value: 'equal', label: '均摊' }]} />
    );
  if (key === 'choreCarry')
    return <Seg value={value} onChange={onChange} options={[{ value: true, label: '下期补回' }, { value: false, label: '不结转' }]} />;
  if (key === 'quietHours')
    return (
      <div className="row">
        <input type="time" className="input" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
        <span>至</span>
        <input type="time" className="input" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
      </div>
    );
  const map = {
    awayMinDays: { min: 1, max: 30, suffix: '天' },
    freeGuestNights: { min: 0, max: 31, suffix: '晚' },
    purchaseApprovalCents: { min: 1, max: 100000, suffix: '元（百）', scale: 100 },
    restockNoticeDays: { min: 0, max: 14, suffix: '天' },
    settleRemindDays: { min: 1, max: 30, suffix: '天' },
  };
  const cfg = map[key];
  if (!cfg) return null;
  const scale = cfg.scale || 1;
  return (
    <div className="row">
      <input
        type="number"
        className="input"
        min={cfg.min}
        max={cfg.max}
        value={scale === 100 ? value / 100 : value}
        onChange={(e) => onChange(Math.round(Number(e.target.value) * scale))}
      />
      <span>{cfg.suffix}</span>
    </div>
  );
}

function JoinFlow({ api, initialCode, onDone, onBack, showToast }) {
  const [code, setCode] = useState(initialCode || '');
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({ name: '', moveIn: todayOf(), agree: false });
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setBusy(true);
    try {
      setInfo(await api.invite(code.trim().toUpperCase()));
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    try {
      const r = await api.join(code.trim().toUpperCase(), { name: f.name, moveIn: f.moveIn, agree: f.agree });
      showToast('已加入房间');
      onDone(r.room.id);
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!info ? (
        <>
          <Field label="6 位邀请码">
            <input className="input" value={code} maxLength={6} placeholder="不区分大小写" onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: 4, textTransform: 'uppercase' }} />
          </Field>
          <div className="btn-row">
            <Btn variant="subtle" onClick={onBack}>
              返回
            </Btn>
            <Btn disabled={code.trim().length !== 6 || busy} onClick={lookup}>
              {busy ? '查询中…' : '查看房间'}
            </Btn>
          </div>
        </>
      ) : (
        <>
          <h3 style={{ marginTop: 0 }}>
            加入「{info.name}」{' '}
            <span className="tag">
              {info.members.length} 位室友
            </span>
          </h3>
          <div className="row wrap mb8">
            {info.members.map((m, i) => (
              <span className="tag" key={i}>
                {m.name}
              </span>
            ))}
          </div>
          {info.full && <Banner tone="warn">这个房间已经有 6 位在住成员了。</Banner>}
          <div className="card" style={{ background: 'var(--bg)' }}>
            <div className="muted mb8">加入前请阅读当前公约（{info.pact ? `第 ${info.pact.v} 版` : '暂无'}）</div>
            {info.pact?.clauses.map((c) => (
              <div key={c.no} className="list-line">
                第 {c.no} 条 {c.text}
              </div>
            ))}
          </div>
          <Field label="你的昵称">
            <input className="input" maxLength={12} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="入住日期">
            <input type="date" className="input" value={f.moveIn} onChange={(e) => setF({ ...f, moveIn: e.target.value })} />
          </Field>
          <label className="row mb8" style={{ gap: 8 }}>
            <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
            我已阅读并同意签署当前公约
          </label>
          <div className="btn-row">
            <Btn variant="subtle" onClick={() => setInfo(null)}>
              返回
            </Btn>
            <Btn disabled={!f.name.trim() || !isDate(f.moveIn) || !f.agree || info.full || busy} onClick={join}>
              {busy ? '加入中…' : '签署并加入'}
            </Btn>
          </div>
        </>
      )}
    </>
  );
}

function DeviceFlow({ api, onDone, onBack, showToast }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  async function redeem() {
    setBusy(true);
    try {
      const r = await api.redeem(code.replace(/\D/g, ''));
      showToast('已在这台设备登录');
      onDone(r.room.id);
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Field label="换设备口令（在原设备的“设置 → 换台设备登录”里生成，10 分钟内有效）">
        <input className="input" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="8 位数字" style={{ letterSpacing: 4 }} />
      </Field>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onBack}>
          返回
        </Btn>
        <Btn disabled={code.length !== 8 || busy} onClick={redeem}>
          {busy ? '验证中…' : '登录'}
        </Btn>
      </div>
    </>
  );
}
