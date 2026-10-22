import React, { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar, AvatarName, Btn, Empty, Money, Sheet, Tag, ConfirmButton } from '../ui.jsx';
import { activeMembers, CATEGORIES, SPLIT_METHODS, todayOf, shareFormula, balanceFormula, settleSuggestions, monthSpend } from '../derive.js';
import { fmtShort, fmtMoney, fmtDateTime } from '../../core/dates.js';
import BillForm from './forms-bill.jsx';
import { PendingTransferCard, TransferCreateForm, TransferReceiveForm } from './forms-transfer.jsx';
import RemindSheet from './RemindSheet.jsx';
import { compressImage } from '../ui-photo.jsx';

export default function Ledger() {
  const { data, act, api } = useApp();
  const { room, me, serverNow } = data;
  const today = todayOf(serverNow);
  const months = useMemo(() => [...new Set(room.bills.map((b) => b.createdAt.slice(0, 7)))].sort().reverse(), [room.bills]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [cat, setCat] = useState('');
  const [payer, setPayer] = useState('');
  const [openId, setOpenId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const bills = room.bills
    .filter((b) => b.createdAt.slice(0, 7) === month)
    .filter((b) => !cat || b.category === cat)
    .filter((b) => !payer || b.payerId === payer)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const settles = settleSuggestions(room);
  const pending = room.transfers.filter((t) => t.status === 'pending');
  const spend = monthSpend(room, month);

  return (
    <>
      <div className="card row between">
        <div>
          <div className="muted">{month} 公共支出</div>
          <Money big cents={spend} />
        </div>
        <Btn onClick={() => setSheet({ k: 'manual' })}>记一笔</Btn>
      </div>

      <QuickRecord onManual={() => setSheet({ k: 'manual' })} />

      <div className="row wrap mb8">
        <select className="select" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)}>
          {(months.includes(month) ? months : [month, ...months]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">全部类别</option>
          {Object.entries(CATEGORIES).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto' }} value={payer} onChange={(e) => setPayer(e.target.value)}>
          <option value="">全部付款人</option>
          {activeMembers(room).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {pending.length > 0 && (
        <>
          <div className="section-title">
            待确认的转账 <span className="line" />
          </div>
          {pending.map((t) => (
            <PendingTransferCard key={t.id} t={t} />
          ))}
        </>
      )}

      <div className="section-title">
        结算建议 <span className="line" />
      </div>
      <div className="card">
        {settles.length === 0 && <Empty title="目前都结清了" />}
        {settles.map((s, i) => (
          <div className="list-line" key={i}>
            <div className="grow">
              {room.members.find((m) => m.id === s.from)?.name} 转给 {room.members.find((m) => m.id === s.to)?.name} <Money cents={s.amount} />
            </div>
            {s.from === me && <Btn small onClick={() => setSheet({ k: 'send', to: room.members.find((m) => m.id === s.to), amount: s.amount })}>我已转账</Btn>}
          </div>
        ))}
        <Btn small variant="subtle" className="mt8" onClick={() => setSheet({ k: 'receive' })}>
          我收到了现金（直接记录）
        </Btn>
        <details className="f">
          <summary>余额怎么算的</summary>
          <pre className="formula">{balanceFormula(room, me)}</pre>
        </details>
      </div>

      <div className="section-title">
        账单 <span className="line" />
      </div>
      {bills.length === 0 && <Empty title="这个月还没有账单" action={<Btn onClick={() => setSheet({ k: 'manual' })}>先记一笔</Btn>} />}
      {bills.map((b) => (
        <BillCard key={b.id} b={b} open={openId === b.id} onToggle={() => setOpenId(openId === b.id ? null : b.id)} onSheet={setSheet} onRemind={(to, ref, ctx) => setSheet({ k: 'remind', to, ref, context: ctx })} />
      ))}

      {sheet?.k === 'manual' && <Sheet title="记一笔" onClose={() => setSheet(null)}><BillForm onClose={() => setSheet(null)} /></Sheet>}
      {sheet?.k === 'edit' && <Sheet title="修改账单" onClose={() => setSheet(null)}><BillForm bill={sheet.bill} onClose={() => setSheet(null)} /></Sheet>}
      {sheet?.k === 'send' && (
        <Sheet title="我已转账" onClose={() => setSheet(null)}>
          <TransferCreateForm to={sheet.to} amount={sheet.amount} onClose={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet?.k === 'receive' && (
        <Sheet title="记录已收到" onClose={() => setSheet(null)}>
          <TransferReceiveForm onClose={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet?.k === 'dispute' && <DisputeSheet bill={sheet.bill} onClose={() => setSheet(null)} />}
      {sheet?.k === 'void' && <VoidSheet bill={sheet.bill} onClose={() => setSheet(null)} />}
      {sheet?.k === 'remind' && (
        <Sheet title="提醒 TA" onClose={() => setSheet(null)}>
          <RemindSheet to={sheet.to} refId={sheet.ref} context={sheet.context} onClose={() => setSheet(null)} />
        </Sheet>
      )}
    </>
  );
}

function QuickRecord({ onManual }) {
  const { data, api, act, showToast, staticMode } = useApp();
  const { room, me } = data;
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState(null);
  const members = activeMembers(room);
  const byName = new Map(members.map((m) => [m.name, m]));

  async function run() {
    if (!text.trim() && !img) return showToast('先写一句话，或拍张小票', 'err');
    setBusy(true);
    try {
      const r = await api.ai(room.id, 'quick', { text, image: img || undefined });
      if (!r.drafts?.length) throw new Error('没有识别出账单，可以手动填写');
      setDrafts(r.drafts);
    } catch (e) {
      showToast(e.message + '，可以手动填写', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function pickImg(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      setImg(await compressImage(f, 1200, 0.72));
    } catch (err) {
      showToast('图片读不出来', 'err');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function confirmAll() {
    setBusy(true);
    let ok = 0;
    try {
      for (const d of drafts) {
        if (d.uncertain.length) continue;
        await act(
          {
            type: 'bill.create',
            title: d.title,
            amount: d.amount,
            category: d.category || 'supplies',
            payerId: d.payerId || me,
            participants: d.participants?.length ? d.participants : members.map((m) => m.id),
            method: d.method || 'equal',
          },
          { silent: true },
        );
        ok++;
      }
      showToast(ok ? `已确认 ${ok} 笔` : '有字段需要先确认');
      if (ok) {
        setDrafts(null);
        setText('');
        setImg(null);
      }
    } catch {
      /* 已提示 */
    } finally {
      setBusy(false);
    }
  }

  if (staticMode || !data.ai?.available) return null;
  return (
    <div className="card" style={{ background: 'var(--primary-tint)' }}>
      <div className="row">
        <input
          className="input grow"
          maxLength={120}
          placeholder='随口记：“买了洗洁精25.8和垃圾袋10块，四个人平摊”'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Btn onClick={run} disabled={busy}>
          {busy ? '…' : 'AI'}
        </Btn>
      </div>
      <div className="row mt8 between">
        <label className="btn subtle small" style={{ cursor: data.ai.vision ? 'pointer' : 'not-allowed', opacity: data.ai.vision ? 1 : 0.5 }}>
          {img ? '已选小票（点重选）' : '拍/传小票'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={pickImg} disabled={!data.ai.vision || busy} />
        </label>
        <button className="btn small subtle" onClick={onManual} type="button">
          手动填写
        </button>
      </div>
      {drafts && (
        <div className="mt8">
          <div className="muted mb8">AI 草稿（确认前不会记账；标黄的字段需要先确认）</div>
          {drafts.map((d, i) => (
            <div className="card" key={i} style={{ boxShadow: 'none' }}>
              <div className="row between">
                <b>{d.title}</b>
                <Money cents={d.amount} />
              </div>
              <div className="row wrap mt4">
                <span className="tag">{CATEGORIES[d.category] || '类别待定'}</span>
                <span className="tag">{SPLIT_METHODS[d.method] || d.method || '分摊待定'}</span>
                <span className="tag">{d.payerId ? byName.get(d.payerId)?.name || '付款人待定' : '付款人待定'}</span>
                <span className="tag">{d.participants?.length ? `${d.participants.length} 人均摊` : '参与人待定'}</span>
                <button className="btn small subtle" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>
                  不要这笔
                </button>
              </div>
              {d.uncertain.length > 0 && <div className="banner warn mt8">需要确认：{d.uncertain.join('、')}（用“手动填写”补）</div>}
            </div>
          ))}
          <Btn block disabled={busy} onClick={confirmAll}>
            确认信息完整的草稿
          </Btn>
        </div>
      )}
    </div>
  );
}

function BillCard({ b, open, onToggle, onSheet, onRemind }) {
  const { data, act } = useApp();
  const { room, me } = data;
  const mine = b.participants.includes(me);
  const myShare = b.shares.find((s) => s.memberId === me);
  const disputed = b.status === 'disputed';
  return (
    <div className="card" style={b.status === 'void' ? { opacity: 0.55 } : undefined}>
      <div className="row between">
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <b>{b.title}</b>
            {b.status === 'void' && <Tag tone="red">已作废</Tag>}
            {disputed && <Tag tone="amber">有异议</Tag>}
            {b.unapproved && <Tag tone="amber">未预审</Tag>}
          </div>
          <div className="muted">
            {CATEGORIES[b.category]} · {room.members.find((m) => m.id === b.payerId)?.name} 付 · {fmtDateTime(b.createdAt).slice(0, 11)}
            {b.periodStart ? ` · ${fmtShort(b.periodStart)}–${fmtShort(b.periodEnd)}` : ''}
          </div>
        </div>
        <div className="tc">
          <Money cents={b.amount} />
          {mine && myShare && b.status === 'normal' && <div className="muted" style={{ fontSize: 12 }}>我应摊 {fmtMoney(myShare.amount)}</div>}
        </div>
      </div>
      {disputed && (
        <div className="banner warn mt8">
          {room.members.find((m) => m.id === b.dispute.by)?.name}：{b.dispute.reason}
        </div>
      )}
      {b.splitNote && <div className="muted mt4">{b.splitNote}</div>}
      {open && (
        <div className="mt8">
          <table className="tbl">
            <tbody>
              {b.shares.map((s) => (
                <tr key={s.memberId}>
                  <td>
                    <AvatarName room={room} id={s.memberId} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Money cents={s.amount} />
                  </td>
                  <td style={{ width: '100%' }}>
                    <pre className="formula" style={{ marginTop: 0 }}>{shareFormula(room, b, s.memberId)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.photoId && <img src={api.photoUrl(room.id, b.photoId)} alt="凭证" style={{ maxWidth: 180, borderRadius: 8, marginTop: 8 }} />}
          <div className="row wrap mt8">
            {b.createdBy === me && b.status !== 'void' && <Btn small onClick={() => onSheet({ k: 'edit', bill: b })}>修改</Btn>}
            {mine && b.createdBy !== me && b.status === 'normal' && (
              <>
                <Btn small variant="subtle" onClick={() => onSheet({ k: 'dispute', bill: b })}>
                  提出异议
                </Btn>
                <Btn small variant="subtle" onClick={() => onRemind(b.payerId, b.id, b.title)}>
                  提醒付款人
                </Btn>
              </>
            )}
            {disputed && b.dispute.by === me && (
              <Btn small variant="subtle" onClick={async () => act({ type: 'bill.withdrawDispute', id: b.id })}>
                撤回异议
              </Btn>
            )}
            {b.createdBy === me && b.status !== 'void' && (
              <ConfirmButton className="btn small" onClick={() => onSheet({ k: 'void', bill: b })}>
                作废
              </ConfirmButton>
            )}
          </div>
        </div>
      )}
      <button className="btn small subtle mt8" onClick={onToggle}>
        {open ? '收起' : '展开算式'}
      </button>
    </div>
  );
}

function DisputeSheet({ bill, onClose }) {
  const { act } = useApp();
  const [reason, setReason] = useState('');
  return (
    <Sheet title="提出异议" onClose={onClose}>
      <p className="muted">有异议的账单会暂不计入余额，创建人修改后自动恢复。</p>
      <textarea className="textarea" maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="哪里不对？请写清楚，方便核对" />
      <div className="btn-row mt16">
        <Btn variant="subtle" onClick={onClose}>
          取消
        </Btn>
        <Btn
          disabled={!reason.trim()}
          onClick={async () => {
            try {
              await act({ type: 'bill.dispute', id: bill.id, reason: reason.trim() });
              onClose();
            } catch {}
          }}
        >
          提交异议
        </Btn>
      </div>
    </Sheet>
  );
}

function VoidSheet({ bill, onClose }) {
  const { act } = useApp();
  const [reason, setReason] = useState('');
  return (
    <Sheet title="作废账单" onClose={onClose}>
      <p className="muted">作废后这笔账不再计入余额，参与人会收到通知。</p>
      <textarea className="textarea" maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="为什么作废？" />
      <div className="btn-row mt16">
        <Btn variant="subtle" onClick={onClose}>
          取消
        </Btn>
        <Btn
          danger
          disabled={!reason.trim()}
          onClick={async () => {
            try {
              await act({ type: 'bill.void', id: bill.id, reason: reason.trim() });
              onClose();
            } catch {}
          }}
        >
          确认作废
        </Btn>
      </div>
    </Sheet>
  );
}
