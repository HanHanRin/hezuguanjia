// 通用 UI 组件。
import React, { useEffect, useRef, useState } from 'react';

export function Avatar({ name, color, lg }) {
  return (
    <span className={'avatar' + (lg ? ' lg' : '')} style={{ background: color || '#c8ccd0' }} aria-hidden>
      {(name || '?').slice(0, 1)}
    </span>
  );
}

export function Money({ cents, big = false, className = '' }) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents || 0));
  const yuan = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = `¥${yuan}.${String(abs % 100).padStart(2, '0')}`;
  return <span className={`money${big ? ' big' : ''} ${neg ? 'pay' : cents > 0 ? 'recv' : ''} ${className}`}>{neg ? '−' : ''}{s}</span>;
}

export function Tag({ children, tone = '' }) {
  return <span className={'tag ' + tone}>{children}</span>;
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Btn({ variant = 'primary', small, block, danger, className = '', children, ...rest }) {
  const cls = ['btn'];
  if (variant === 'ghost') cls.push('ghost');
  if (variant === 'subtle') cls.push('subtle');
  if (small) cls.push('small');
  if (block) cls.push('block');
  if (danger) cls.push('danger');
  cls.push(className);
  return (
    <button className={cls.join(' ')} {...rest}>
      {children}
    </button>
  );
}

export function Chips({ options, value, onChange, disabled }) {
  const set = new Set(value || []);
  const single = onChange.length === 0 ? true : false;
  return (
    <div className="chips">
      {options.map((o) => {
        const on = single ? value === o.value : set.has(o.value);
        return (
          <button
            type="button"
            key={String(o.value)}
            disabled={disabled}
            className={'chip' + (on ? ' on' : '')}
            onClick={() => (single ? onChange(o.value) : toggleChips(set, o.value, onChange))}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
function toggleChips(set, v, onChange) {
  if (set.has(v)) set.delete(v);
  else set.add(v);
  onChange([...set]);
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o.value} className={'chip' + (value === o.value ? ' on' : '')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <div>{title}</div>
      {children && <div className="muted mt8">{children}</div>}
      {action}
    </div>
  );
}

export function Sheet({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt16">{footer}</div>}
      </div>
    </div>
  );
}

/** 危险操作二次确认：点一次变成“再点一次确认”，4 秒内再点才执行 */
export function ConfirmButton({ onConfirm, children, variant = 'danger', className = '', label = '再点一次确认' }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Btn
      variant={armed ? variant : 'subtle'}
      danger={armed}
      className={className}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
        } else {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? label : children}
    </Btn>
  );
}

export function Banner({ tone = 'info', children }) {
  return <div className={'banner ' + tone}>{children}</div>;
}

export function AvatarName({ room, id }) {
  const m = room.members.find((x) => x.id === id);
  if (!m) return <span className="muted">已退租</span>;
  return (
    <span className="row">
      <Avatar name={m.name} color={m.color} />
      {m.name}
    </span>
  );
}
