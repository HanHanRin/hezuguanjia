import React, { useState } from 'react';
import { useApp } from './store.jsx';

// 压缩图片：最长边 1200，JPEG 0.75，返回 dataURL（凭证和小票都用它，保证不超过 2MB）。
export async function compressImage(file, maxEdge = 1200, quality = 0.75) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoInput({ photoId, onChange, label = '凭证图片（可选）' }) {
  const { currentId, api, staticMode, showToast, busy } = useApp();
  const [loading, setLoading] = useState(false);
  if (staticMode) return null;
  async function pick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const dataUrl = await compressImage(file, 1200, 0.72);
      const id = await api.photoUpload(currentId, dataUrl);
      onChange(id);
      showToast('图片已上传');
    } catch (err) {
      showToast(err.message || '图片上传失败', 'err');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }
  return (
    <div className="field">
      <label>{label}</label>
      {photoId ? (
        <div className="row">
          <img src={api.photoUrl(currentId, photoId)} alt="凭证" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
          <button type="button" className="btn small subtle" onClick={() => onChange(null)}>
            移除
          </button>
        </div>
      ) : (
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} disabled={loading || busy} />
      )}
      <div className="hint">{loading ? '正在压缩上传…' : '会在本机压缩到约 1MB 以内再上传'}</div>
    </div>
  );
}
