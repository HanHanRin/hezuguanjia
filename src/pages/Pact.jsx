import React, { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar, AvatarName, Btn, Field, Sheet, Tag, Banner, Seg } from '../ui.jsx';
import { activeMembers, clauses, clauseDisplay, clauseByNo, pactStatus, voteCount, todayOf, fmtDateCN } from '../derive.js';
import { fmtShort, fmtMoney, addHours, fmtDateTime } from '../../core/dates.js';
import { diffText } from '../../core/pact.js';

export default function Pact() {
  const { data, act, api } = useApp();
  const { room, me, serverNow } = data;
  const today = todayOf(serverNow);
  const status = pactStatus(room);
  const list = clauses(room);
  const proposals = room.pact.proposals.slice().reverse();
  const versions = room.pact.versions.slice().reverse();
  const [sheet, setSheet] = useState(null);
  const unsigned = status.draft ? status.draft.signatures[me] === undefined : false;

  return (
    <>
      {status.draft && (
        <Banner tone="warn">
          公约还没有全员签署，暂按模板默认规则执行。
          {unsigned && (
            <Btn small className="mt8" onClick={() => act({ type: 'pact.sign' })}>我已阅读并签署</Btn>
          )}
        </Banner>
      )}
      {status.active && (
        <div className="card row between">
          <div>
            <b>当前公约</b>
            <div className="muted">第 {status.active.v} 版 · {fmtShort(status.active.activatedDate, today)} 生效</div>
          </div>
          <Btn small onClick={() => setSheet({ k: 'propose' })}>发起修订</Btn>
        </div>
      )}

      {proposals[0]?.status === 'open' && <OpenProposal p={proposals[0]} onSheet={setSheet} />}

      <div className="section-title">
        条款 <span className="line" />
      </div>
      <div className="card">
        {list.map((c) => (
          <div className="list-line" key={c.no}>
            <div className="grow">
              <b>第 {c.no} 条</b> <Tag tone={c.kind === 'param' ? 'primary' : ''}>{c.kind === 'param' ? '参与计算' : '约定'}</Tag>
              <div>{clauseDisplay(c)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">
        修订记录 <span className="line" />
      </div>
      <div className="card">
        {proposals.length === 0 && <div className="muted">还没有修订记录。</div>}
        {proposals.map((p) => (
          <div className="list-line" key={p.id}>
            <div className="grow">
              {p.summary}
              <div className="muted" style={{ fontSize: 12 }}>
                {room.members.find((m) => m.id === p.by)?.name} 发起 · {statusText(p.status)} · {fmtDateTime(p.createdAt).slice(0, 11)}
              </div>
            </div>
            <Btn small variant="subtle" onClick={() => setSheet({ k: 'detail', p })}>查看</Btn>
          </div>
        ))}
      </div>

      <div className="section-title">
        历史版本 <span className="line" />
      </div>
      <div className="card">
        {versions.map((v) => (
          <div className="list-line" key={v.v}>
            <div className="grow">
              第 {v.v} 版 <Tag tone={v.status === 'active' ? 'green' : ''}>{versionText(v.status)}</Tag>
              <div className="muted" style={{ fontSize: 12 }}>
                {v.activatedDate ? `${fmtShort(v.activatedDate, today)} 生效` : '未生效'} · {v.clauses.length} 条
              </div>
            </div>
            <Btn small variant="subtle" onClick={() => setSheet({ k: 'version', v })}>对比</Btn>
          </div>
        ))}
      </div>

      {sheet?.k === 'propose' && <ProposeSheet onClose={() => setSheet(null)} />}
      {sheet?.k === 'detail' && <ProposalDetail p={sheet.p} onClose={() => setSheet(null)} />}
      {sheet?.k === 'version' && <VersionSheet v={sheet.v} onClose={() => setSheet(null)} />}
    </>
  );
}

function statusText(s) {
  return { open: '表决中', passed: '已通过', failed: '未通过', withdrawn: '已撤回', rejected: '未通过', expired: '已过期' }[s] || s;
}
function versionText(s) {
  return { active: '生效中', retired: '已废止', draft: '待签署' }[s] || s;
}

function OpenProposal({ p, onSheet }) {
  const { data, act } = useApp();
  const { room, me, serverNow } = data;
  const vc = voteCount(p);
  const canVote = p.eligible.includes(me) && p.by !== me && !(me in p.votes) && p.deadline > serverNow;
  const hours = Math.max(0, Math.ceil((new Date(p.deadline) - new Date(serverNow)) / 3600000));
  return (
    <>
      <div className="section-title">
        进行中的修订 <span className="line" />
      </div>
      <div className="card" style={{ borderColor: 'var(--primary)' }}>
        <div className="row between">
          <b>{p.summary}</b>
          <Tag tone="amber">剩 {hours} 小时</Tag>
        </div>
        <div className="muted mt4">
          {room.members.find((m) => m.id === p.by)?.name} 发起 · 同意 {vc.yes}（含发起人）/ 反对 {vc.no} / 需要 {p.threshold} 人同意
        </div>
        <div className="muted">理由：{p.reason}</div>
        <div className="mt8">
          <Btn small onClick={() => onSheet({ k: 'detail', p })}>先看影响预览</Btn>
          {canVote && (
            <span className="btn-row" style={{ display: 'inline-flex', marginLeft: 8 }}>
              <Btn small onClick={() => act({ type: 'proposal.vote', id: p.id, vote: 'yes' })}>同意</Btn>
              <Btn small variant="subtle" onClick={() => act({ type: 'proposal.vote', id: p.id, vote: 'no' })}>反对</Btn>
            </span>
          )}
          {p.by === me && p.status === 'open' && <Btn small variant="subtle" className="mt8" onClick={() => act({ type: 'proposal.withdraw', id: p.id })}>撤回</Btn>}
        </div>
      </div>
    </>
  );
}

function ProposeSheet({ onClose }) {
  const { data, api, act, showToast } = useApp();
  const { room, me, serverNow } = data;
  const list = clauses(room);
  const [changes, setChanges] = useState([]);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [aiText, setAiText] = useState('');
  const [busy, setBusy] = useState(false);

  function addChange(ch) {
    setChanges((arr) => [...arr.filter((x) => x.no !== ch.no || x.op !== ch.op), ch]);
  }
  function remove(i) {
    setChanges(changes.filter((_, j) => j !== i));
  }
  async function getPreview() {
    if (!changes.length) return showToast('先选择要改哪一条', 'err');
    setBusy(true);
    try {
      const r = await api.preview(room.id, changes);
      setPreview(r.preview);
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }
  async function aiDraft() {
    if (!aiText.trim()) return;
    setBusy(true);
    try {
      const r = await api.ai(room.id, 'clause', { text: aiText });
      addChange(r.change);
      setAiText('');
      showToast('AI 起草了一条，可在下面修改');
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!changes.length || !reason.trim()) return;
    setBusy(true);
    try {
      const r = await act({ type: 'proposal.create', reason: reason.trim(), changes });
      onClose();
    } catch (e) {
      /* 已提示 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="发起公约修订" onClose={onClose}>
      <p className="muted">改参数条款会先给出“改了以后每人差多少钱、多少分”的模拟；通过后从下个周期生效，旧账不重算。</p>
      <ParamEditor clauses={list} onChange={addChange} />
      <div className="card" style={{ background: 'var(--bg)' }}>
        <div className="muted">新增一条文字约定：</div>
        <textarea className="textarea" maxLength={60} placeholder="例如：洗完澡顺手把地漏头发带走。" />
        <Btn
          small
          variant="subtle"
          className="mt4"
          onClick={() => {
            const el = document.activeElement?.previousElementSibling;
            const t = el?.value;
            if (t) addChange({ op: 'add', text: t });
          }}
        >加入修订</Btn>
      </div>
      {data.ai?.available && (
        <Field label="或者说一件事，让 AI 起草一条">
          <div className="row">
            <textarea className="textarea grow" maxLength={200} value={aiText} onChange={(e) => setAiText(e.target.value)} />
            <Btn small variant="ghost" disabled={busy} onClick={aiDraft}>起草</Btn>
          </div>
        </Field>
      )}
      {changes.length > 0 && (
        <div className="card" style={{ background: 'var(--primary-tint)' }}>
          <b>这次要改：</b>
          {changes.map((c, i) => (
            <div className="list-line" key={i}>
              <div className="grow">{diffTextLocal(room, c)}</div>
              <Btn small variant="subtle" onClick={() => remove(i)}>去掉</Btn>
            </div>
          ))}
          <Btn small variant="ghost" disabled={busy} onClick={getPreview}>看影响预览</Btn>
        </div>
      )}
      {preview && <PreviewView preview={preview} />}
      <Field label="修订理由（必填）"><textarea className="textarea" maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn disabled={!changes.length || !reason.trim() || busy} onClick={submit}>发起 48 小时表决</Btn>
      </div>
    </Sheet>
  );
}

function diffTextLocal(room, c) {
  if (c.op === 'add') return `新增：${c.text}`;
  const clause = clauseByNo(room, c.no);
  if (!clause) return `第 ${c.no} 条`;
  if (c.op === 'remove') return `删除第 ${c.no} 条：${clauseDisplay(clause)}`;
  const fake = {
    no: c.no,
    kind: clause.kind,
    key: clause.key,
    before: clause.value,
    after: c.value,
  };
  return diffText(fake);
}

function ParamEditor({ clauses, onChange }) {
  const [no, setNo] = useState(clauses.find((c) => c.kind === 'param')?.no || '');
  const c = clauses.find((x) => x.no === Number(no));
  const [v, setV] = useState(c?.value);
  React.useEffect(() => {
    const cc = clauses.find((x) => x.no === Number(no));
    setV(cc ? structuredClone(cc.value) : null);
  }, [no]);
  if (!c) return null;
  let input = null;
  if (c.key === 'utilitiesMethod') input = <Seg value={v} onChange={setV} options={[{ value: 'personDays', label: '按在住人天' }, { value: 'equal', label: '均摊' }]} />;
  else if (c.key === 'choreCarry') input = <Seg value={v} onChange={setV} options={[{ value: true, label: '下期补回' }, { value: false, label: '不结转' }]} />;
  else if (c.key === 'quietHours')
    input = (
      <div className="row">
        <input type="time" className="input" value={v?.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
        <span>至</span>
        <input type="time" className="input" value={v?.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
      </div>
    );
  else
    input = (
      <div className="row">
        <input type="number" className="input" min={0} max={31} value={c.key === 'purchaseApprovalCents' ? v / 100 : v} onChange={(e) => setV(c.key === 'purchaseApprovalCents' ? Math.round(Number(e.target.value) * 100) : Number(e.target.value))} />
        <span className="muted">{suffixOf(c.key)}</span>
      </div>
    );
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      <Field label="修改哪一条参数条款">
        <select className="select" value={no} onChange={(e) => setNo(e.target.value)}>
          {clauses.filter((x) => x.kind === 'param').map((x) => (
            <option key={x.no} value={x.no}>第 {x.no} 条 · {clauseDisplay(x).split('：')[0]}</option>
          ))}
        </select>
      </Field>
      <div className="muted mb8">现在：{clauseDisplay(c)}</div>
      {input}
      <Btn small className="mt8" onClick={() => onChange({ op: 'edit', no: c.no, value: structuredClone(v) })}>加入修订</Btn>
    </div>
  );
}

function suffixOf(key) {
  return { awayMinDays: '天', freeGuestNights: '晚', purchaseApprovalCents: '元', restockNoticeDays: '天提前提醒', settleRemindDays: '天' }[key] || '';
}

function PreviewView({ preview }) {
  const { data } = useApp();
  const name = (id) => data.room.members.find((m) => m.id === id)?.name || id;
  return (
    <div className="card" style={{ background: '#fffdf5', borderColor: '#f0d9b5' }}>
      <b>影响预览（仅为模拟，不会改动已有账单）</b>
      {preview.utilities && (
        <div className="mt8">
          <div className="muted">如果按新规则算{preview.utilities.period}的「{preview.utilities.title}」：</div>
          {preview.utilities.rows.map((r) => (
            <div className="row between" key={r.memberId}>
              <span>{name(r.memberId)}</span>
              <span className={r.delta < 0 ? 'num-down' : r.delta > 0 ? 'num-up' : ''}>
                {r.delta === 0 ? '不变' : `${r.delta < 0 ? '少摊' : '多摊'} ${fmtMoney(Math.abs(r.delta))}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {preview.chores && (
        <div className="mt8">
          <div className="muted">当前值日周期{preview.chores.period}的分配变化：</div>
          {preview.chores.rows.map((r) => (
            <div className="row between" key={r.memberId}>
              <span>{name(r.memberId)}</span>
              <span>{r.delta === 0 ? '不变' : `${r.delta > 0 ? '多' : '少'} ${Math.abs(r.delta)} 分`}</span>
            </div>
          ))}
        </div>
      )}
      {preview.notes.map((n, i) => (
        <div className="muted mt8" key={i}>{n}</div>
      ))}
    </div>
  );
}

function ProposalDetail({ p, onClose }) {
  const { data, act } = useApp();
  const { room, me, serverNow } = data;
  const vc = voteCount(p);
  return (
    <Sheet title="修订详情" onClose={onClose}>
      <div className="muted">第 {p.baseVersion} 版 → 表决{statusText(p.status)}</div>
      {p.diff.map((d, i) => (
        <div className="list-line" key={i}>
          <div className="grow">{diffText(d)}</div>
        </div>
      ))}
      <div className="muted">理由：{p.reason}</div>
      {p.preview && <PreviewView preview={p.preview} />}
      <div className="card mt8" style={{ background: 'var(--bg)' }}>
        同意 {vc.yes} · 反对 {vc.no} · 需要 {p.threshold} 人同意（含发起人）
        {room.pact.versions.find((v) => v.v === p.resultVersion) && <Tag tone="green" className="mt8">已生成第 {p.resultVersion} 版</Tag>}
      </div>
      {p.status === 'open' && p.eligible.includes(me) && p.by !== me && p.deadline > serverNow && !(me in p.votes) && (
        <div className="btn-row mt16">
          <Btn variant="subtle" onClick={() => act({ type: 'proposal.vote', id: p.id, vote: 'no' }).then(onClose)}>反对</Btn>
          <Btn onClick={() => act({ type: 'proposal.vote', id: p.id, vote: 'yes' }).then(onClose)}>同意</Btn>
        </div>
      )}
    </Sheet>
  );
}

function VersionSheet({ v, onClose }) {
  const { data } = useApp();
  const prev = data.room.pact.versions.find((x) => x.v === v.v - 1);
  return (
    <Sheet title={`第 ${v.v} 版`} onClose={onClose}>
      <div className="muted mb8">{versionText(v.status)} · {v.activatedDate ? `${fmtShort(v.activatedDate)} 生效` : '未生效'}</div>
      {v.diff && v.diff.length ? (
        v.diff.map((d, i) => <div className="list-line" key={i}>{diffText(d)}</div>)
      ) : (
        v.clauses.map((c) => (
          <div className="list-line" key={c.no}>
            <div className="grow">第 {c.no} 条 {clauseDisplay(c)}</div>
          </div>
        ))
      )}
    </Sheet>
  );
}
