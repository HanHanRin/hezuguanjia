import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Avatar, AvatarName, Btn, Field, Sheet, Tag, ConfirmButton } from '../ui.jsx';
import { activeMembers, todayOf, fmtDateCN } from '../derive.js';
import { fmtShort, fmtDateTime } from '../../core/dates.js';

export default function Settings() {
  const { data, act, api, memberships, staticMode, leaveRoom, showToast } = useApp();
  const { room, me, serverNow } = data;
  const [sheet, setSheet] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [code, setCode] = useState(null);
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');
  const mine = room.members.find((m) => m.id === me);
  const isAdmin = mine.role === 'admin';

  async function makeCode() {
    try {
      const r = await api.deviceCode(room.id);
      setCode(r.code);
    } catch (e) {
      showToast(e.message, 'err');
    }
  }
  async function doExport() {
    const t = await api.exportData();
    setExportText(t);
  }

  return (
    <>
      <div className="card">
        <h3>房间信息</h3>
        <div className="list-line">
          <div className="grow">房间名</div>
          <b>{room.name}</b>
        </div>
        <div className="list-line">
          <div className="grow">邀请方式</div>
          {showInvite ? (
            <div className="row">
              <code style={{ fontSize: 17, letterSpacing: 3, fontWeight: 700 }}>{room.inviteCode || '—'}</code>
              <Btn small variant="subtle" onClick={() => setShowInvite(false)}>收起</Btn>
              {isAdmin && <Btn small variant="subtle" onClick={() => act({ type: 'room.resetInvite' }).then(() => setShowInvite(true))}>重置</Btn>}
            </div>
          ) : (
            <Btn small variant="ghost" onClick={() => setShowInvite(true)}>查看邀请码</Btn>
          )}
        </div>
        {showInvite && room.inviteCode && (
          <div className="muted">把邀请码发给室友：打开应用 → 我有邀请码 → 阅读并签署公约后加入。链接：{location.origin}{import.meta.env.BASE_URL}?join={room.inviteCode}</div>
        )}
        <div className="list-line">
          <div className="grow">AI 功能</div>
          <SegView on={data.ai?.available} enabled={room.aiEnabled} admin={isAdmin} onChange={(v) => act({ type: 'room.setAI', enabled: v })} />
        </div>
      </div>

      <div className="card">
        <h3>成员与我的资料</h3>
        {activeMembers(room).map((m) => (
          <div className="list-line" key={m.id}>
            <Avatar name={m.name} color={m.color} />
            <div className="grow">
              {m.name}
              {m.id === me && '（我）'}
              <div className="muted" style={{ fontSize: 12 }}>
                {m.role === 'admin' ? '管理员 · ' : ''}入住 {fmtShort(m.moveIn)}{m.moveOut ? ` · ${fmtShort(m.moveOut)} 退租` : ''}
              </div>
            </div>
            {m.id === me && <Btn small variant="subtle" onClick={() => setSheet({ k: 'me' })}>改昵称/颜色</Btn>}
            {m.id === me && <Btn small variant="subtle" onClick={() => setSheet({ k: 'moveout' })}>办理退租</Btn>}
          </div>
        ))}
        {room.members.some((m) => m.status === 'left') && (
          <details className="f">
            <summary>已退租成员</summary>
            {room.members.filter((m) => m.status === 'left').map((m) => (
              <div className="list-line" key={m.id}>
                <AvatarName room={room} id={m.id} />
                <span className="grow" />
                <Tag>已退租</Tag>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="card">
        <h3>换台设备登录</h3>
        <p className="muted">在新设备上打开应用 → 我有邀请码旁边的“换台设备登录”，输入下面这个 8 位口令（10 分钟内有效，只能用一次）。</p>
        {!staticMode && (
          code ? <code style={{ fontSize: 22, letterSpacing: 6 }}>{code}</code> : <Btn small onClick={makeCode}>生成换设备口令</Btn>
        )}
        {staticMode && <div className="banner warn">演示版数据只在这台设备，不支持跨设备。</div>}
      </div>

      <div className="card">
        <h3>动态记录</h3>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {room.activity.slice(-30).reverse().map((a) => (
            <div className="list-line" key={a.id}>
              <div className="grow">
                {room.members.find((m) => m.id === a.by)?.name || '系统'}：{a.text}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{fmtDateTime(a.at).slice(5, 11)}</span>
            </div>
          ))}
        </div>
      </div>

      {staticMode && (
        <div className="card">
          <h3>备份（仅演示版）</h3>
          <Btn small onClick={doExport}>导出 JSON</Btn>
          {exportText && (
            <>
              <textarea className="textarea mt8" value={exportText} readOnly style={{ minHeight: 100, fontSize: 12 }} />
              <Btn
                small
                className="mt8"
                onClick={() => {
                  const blob = new Blob([exportText], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'hezuguanjia-backup.json';
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >下载文件</Btn>
            </>
          )}
          <Field label="导入备份（会覆盖当前数据）">
            <textarea className="textarea" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="粘贴导出的 JSON" style={{ minHeight: 80, fontSize: 12 }} />
          </Field>
          <ConfirmButton
            className="btn small"
            onClick={async () => {
              try {
                await api.importData(importText);
                location.hash = '#/today';
                location.reload();
              } catch (e) {
                showToast(e.message, 'err');
              }
            }}
          >导入备份</ConfirmButton>
        </div>
      )}

      <div className="card">
        <ConfirmButton className="btn small" label="再点一次确认退出房间" onClick={() => leaveRoom(room.id)}>退出这个房间（本机）</ConfirmButton>
        <div className="hint">退出只是删掉这台设备的登录；房间数据和其他室友不受影响。</div>
      </div>

      {sheet?.k === 'me' && <MeSheet onClose={() => setSheet(null)} />}
      {sheet?.k === 'moveout' && <MoveOutSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function SegView({ on, enabled, admin, onChange }) {
  if (!on) return <Tag tone="amber">未启用</Tag>;
  if (!admin) return <Tag tone={enabled ? 'green' : ''}>{enabled ? '已开启' : '已关闭'}</Tag>;
  return (
    <div className="chips">
      <button className={'chip' + (enabled ? ' on' : '')} onClick={() => onChange(true)}>开</button>
      <button className={'chip' + (!enabled ? ' on' : '')} onClick={() => onChange(false)}>关</button>
    </div>
  );
}

function MeSheet({ onClose }) {
  const { data, act } = useApp();
  const COLORS = ['#7FA7E8', '#E59C7E', '#8CC2A5', '#E8C77B', '#D89BB0', '#82C4D4'];
  const me = data.room.members.find((m) => m.id === data.me);
  const [name, setName] = useState(me.name);
  const [color, setColor] = useState(me.color);
  return (
    <Sheet title="我的资料" onClose={onClose}>
      <Field label="昵称"><input className="input" maxLength={12} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="头像颜色">
        <div className="chips">
          {COLORS.map((c) => (
            <span key={c} className={'chip' + (c === color ? ' on' : '')} onClick={() => setColor(c)} style={{ paddingLeft: 14 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: c, marginRight: 4, vertical: -2 }} />
              {c.slice(1)}
            </span>
          ))}
        </div>
      </Field>
      <div className="btn-row mt16">
        <Btn variant="subtle" onClick={onClose}>取消</Btn>
        <Btn onClick={async () => { try { await act({ type: 'member.update', name, color }); onClose(); } catch {} }}>保存</Btn>
      </div>
    </Sheet>
  );
}

function MoveOutSheet({ onClose }) {
  const { data, act } = useApp();
  const me = data.room.members.find((m) => m.id === data.me);
  const [date, setDate] = useState(me.moveOut || todayOf(data.serverNow));
  const [step, setStep] = useState('date');
  if (step === 'date')
    return (
      <Sheet title="办理退租" onClose={onClose}>
        <p className="muted">设置退租日期后：退租日之后不再给你排值日；结清全部余额后正式办理，历史记录保留只读。</p>
        <Field label="退租日期"><input type="date" className="input" value={date} min={me.moveIn} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="btn-row">
          <Btn variant="subtle" onClick={onClose}>取消</Btn>
          <Btn onClick={async () => { try { await act({ type: 'member.setMoveOut', date }); setStep('final'); } catch {} }}>设置退租日期</Btn>
        </div>
      </Sheet>
    );
  return (
    <Sheet title="结清并退租" onClose={onClose}>
      <p className="muted">退租日期 {fmtDateCN(date)}。请先按“账本 → 结算建议”结清余额，处理完待确认的转账。</p>
      <div className="btn-row">
        <Btn variant="subtle" onClick={onClose}>再想想</Btn>
        <Btn
          danger
          onClick={async () => {
            try {
              await act({ type: 'member.finalize' });
              location.hash = '#/';
              location.reload();
            } catch {}
          }}
        >我已结清，办理退租</Btn>
      </div>
    </Sheet>
  );
}
