import React, { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Btn, Field, Chips, Seg } from '../ui.jsx';
import { PhotoInput } from '../ui-photo.jsx';
import { computeShares } from '../../core/split.js';
import { currentParams, paramsOn } from '../../core/pact.js';
import { parseMoney, fmtMoney, isDate, fmtMoney as fm } from '../../core/dates.js';
import { activeMembers, CATEGORIES, SPLIT_METHODS, todayOf } from '../derive.js';

const CAT_OPTS = Object.entries(CATEGORIES).map(([v, label]) => ({ v, label }));

function periodDefault(today) {
  // 水电燃气默认填“上月 15 日到本月 14 日”
  const [y, mo] = today.split('-').map(Number);
  const start = mo === 1 ? `${y - 1}-12-15` : `${y}-${String(mo - 1).padStart(2, '0')}-15`;
  const end = `${y}-${String(mo).padStart(2, '0')}-14`;
  return { start, end };
}

export default function BillForm({ bill: editing, initial, onClose }) {
  const { data, act, showToast } = useApp();
  const { room, me } = data;
  const today = todayOf(data.serverNow);
  const members = activeMembers(room);
  const dp = periodDefault(today);
  const [f, setF] = useState(() => ({
    title: editing?.title || initial?.title || '',
    amountText: editing ? String(editing.amount / 100) : initial?.amount != null ? String(initial.amount / 100) : '',
    category: editing?.category || initial?.category || 'supplies',
    payerId: editing?.payerId || initial?.payerId || me,
    participants: editing?.participants || initial?.participants || members.map((m) => m.id),
    method: editing?.method || initial?.method || 'equal',
    periodStart: editing?.periodStart || initial?.periodStart || dp.start,
    periodEnd: editing?.periodEnd || initial?.periodEnd || dp.end,
    weights: editing?.weights || Object.fromEntries(members.map((m) => [m.id, 100])),
    fixed: editing?.fixed || Object.fromEntries(members.map((m) => [m.id, 0])),
    note: editing?.note || '',
    photoId: editing?.photoId || null,
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const amount = parseMoney(f.amountText);
  const needPeriod = f.category === 'utilities' || f.method === 'personDays';
  const effectiveMethod = f.method === 'personDays' || needPeriod ? f.method : f.method;

  const periodOk = !needPeriod || (isDate(f.periodStart) && isDate(f.periodEnd) && f.periodEnd >= f.periodStart);
  const parts = f.participants;

  const preview = useMemo(() => {
    if (amount == null || !parts.length || !periodOk) return null;
    const params = needPeriod ? paramsOn(room, f.periodStart) : currentParams(room);
    let method = f.method;
    if (f.category === 'utilities' && !editing) method = method === 'equal' ? 'equal' : method;
    return computeShares(
      {
        amount,
        payerId: f.payerId,
        method,
        participants: parts,
        weights: f.weights,
        fixed: f.fixed,
        periodStart: needPeriod ? f.periodStart : null,
        periodEnd: needPeriod ? f.periodEnd : null,
      },
      { members: room.members, aways: room.aways, guests: room.guests, params, orderOf: (id) => room.members.find((m) => m.id === id)?.order ?? 99 },
    );
  }, [amount, f, parts, periodOk, needPeriod, room]);

  const fixedSum = parts.reduce((s, id) => s + (f.fixed[id] || 0), 0);
  const fixedDiff = amount != null ? amount - fixedSum : null;
  const canSave = amount != null && f.title.trim() && parts.length && periodOk && (!amount || true) && (f.method !== 'fixed' || fixedDiff === 0) && (!preview || !preview.error);

  function togglePart(id) {
    set('participants', parts.includes(id) ? parts.filter((x) => x !== id) : [...parts, id]);
  }

  async function save() {
    const payload = {
      title: f.title.trim(),
      amount,
      category: f.category,
      payerId: f.payerId,
      participants: parts,
      method: f.method,
      periodStart: needPeriod ? f.periodStart : undefined,
      periodEnd: needPeriod ? f.periodEnd : undefined,
      weights: f.method === 'weight' ? f.weights : undefined,
      fixed: f.method === 'fixed' ? f.fixed : undefined,
      note: f.note || undefined,
      photoId: f.photoId || undefined,
    };
    try {
      await act(editing ? { type: 'bill.update', id: editing.id, baseVersion: editing.version, ...payload } : { type: 'bill.create', ...payload });
      onClose();
    } catch {
      /* 错误已提示 */
    }
  }

  return (
    <>
      <Field label="标题">
        <input className="input" maxLength={30} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：水电燃气 9/15–10/14" />
      </Field>
      <Field label="金额（元）">
        <input className="input" inputMode="decimal" value={f.amountText} onChange={(e) => set('amountText', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" style={{ fontVariantNumeric: 'tabular-nums' }} />
      </Field>
      <Field label="类别">
        <Chips options={CAT_OPTS.map((c) => ({ value: c.v, label: c.label }))} value={f.category} onChange={(v) => set('category', v)} />
      </Field>
      <Field label="付款人">
        <select className="select" value={f.payerId} onChange={(e) => set('payerId', e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="参与分摊的人">
        <div className="chips">
          {members.map((m) => (
            <button type="button" key={m.id} className={'chip' + (parts.includes(m.id) ? ' on' : '')} onClick={() => togglePart(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="分摊方式">
        <Seg
          value={f.method}
          onChange={(v) => set('method', v)}
          options={[
            { value: 'equal', label: '均摊' },
            { value: 'personDays', label: '按在住人天' },
            { value: 'weight', label: '按权重' },
            { value: 'fixed', label: '固定金额' },
          ]}
        />
        <div className="hint">
          {f.method === 'personDays' && '水电燃气适用：离家满门槛扣除、访客超免费晚数计入邀请人。'}
          {f.method === 'equal' && '在参与人之间平分，尾差按规则补给小数最大的人。'}
          {f.method === 'weight' && '按每人的权重（如房间面积）分摊。'}
          {f.method === 'fixed' && '每人填固定金额，合计必须等于总额。'}
        </div>
      </Field>
      {needPeriod && (
        <div className="row">
          <Field label="计费周期开始">
            <input type="date" className="input" value={f.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
          </Field>
          <Field label="结束">
            <input type="date" className="input" value={f.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
          </Field>
        </div>
      )}
      {!periodOk && <div className="banner err">计费周期结束日不能早于开始日。</div>}
      {f.method === 'weight' && (
        <div className="card" style={{ background: 'var(--bg)' }}>
          {parts.map((id) => {
            const m = room.members.find((x) => x.id === id);
            return (
              <div className="row mb8" key={id}>
                <span className="grow">{m.name}</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: 110 }}
                  value={f.weights[id]}
                  min={1}
                  onChange={(e) => set('weights', { ...f.weights, [id]: Number(e.target.value) })}
                />
              </div>
            );
          })}
        </div>
      )}
      {f.method === 'fixed' && (
        <div className="card" style={{ background: 'var(--bg)' }}>
          {parts.map((id) => {
            const m = room.members.find((x) => x.id === id);
            return (
              <div className="row mb8" key={id}>
                <span className="grow">{m.name}</span>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  style={{ width: 130 }}
                  value={f.fixed[id] ? f.fixed[id] / 100 : ''}
                  onChange={(e) => set('fixed', { ...f.fixed, [id]: parseMoney(e.target.value) ?? 0 })}
                />
              </div>
            );
          })}
          {fixedDiff !== null && fixedDiff !== 0 && (
            <div className={'banner ' + (fixedDiff > 0 ? 'err' : 'warn')}>
              {fixedDiff > 0 ? `还差 ${fmtMoney(fixedDiff)}` : `多出 ${fmtMoney(-fixedDiff)}`}
            </div>
          )}
        </div>
      )}
      {preview && !preview.error && (
        <div className="card" style={{ background: 'var(--bg)' }}>
          <div className="muted mb8">{preview.note || '保存前的分摊预览（以实际保存为准）'}</div>
          {preview.shares.map((s) => {
            const m = room.members.find((x) => x.id === s.memberId);
            return (
              <div className="row between" key={s.memberId}>
                <span>{m.name}</span>
                <span className="money">{fmtMoney(s.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
      <Field label="备注（可选）">
        <input className="input" maxLength={100} value={f.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <PhotoInput photoId={f.photoId} onChange={(id) => set('photoId', id)} />
      <div className="btn-row mt16">
        <Btn variant="subtle" onClick={onClose}>
          取消
        </Btn>
        <Btn disabled={!canSave} onClick={save}>
          {editing ? '保存修改' : '记一笔'}
        </Btn>
      </div>
    </>
  );
}
