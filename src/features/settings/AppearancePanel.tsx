import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { colorSchema, defaultAppearance, defaultDialogTransparency, maxDialogTransparency } from '../../../shared/appearance.ts';
import type { Appearance } from '../../../shared/appearance.ts';
import { message } from '../../services/api.ts';
import { fonts } from './appearanceStyle.ts';

const presets = [
  { label: '纸白', background: defaultAppearance.background, accent: defaultAppearance.accent },
  { label: '暖沙', background: '#f4ede1', accent: '#765437' },
  { label: '雾绿', background: '#e9efe6', accent: '#3d644d' },
  { label: '夜读', background: '#201e23', accent: '#b59cf6' },
];

const transparencyPreference = '(prefers-reduced-transparency: reduce)';

function subscribeToTransparency(onChange: () => void) {
  const media = window.matchMedia(transparencyPreference);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const systemReducesTransparency = () => window.matchMedia(transparencyPreference).matches;

function ColorField({ label, color, update }: {
  label: string; color: string; update: (value: string) => void;
}) {
  return <label className="appearance-color">{label}
    <input type="color" value={colorSchema.safeParse(color).data ?? '#000000'} onChange={(event) => update(event.target.value)} />
  </label>;
}

export function AppearancePanel({ value, disabled, preview, save }: {
  value: Appearance; disabled: boolean;
  preview: (value: Appearance | undefined) => void;
  save: (value: Appearance) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => preview(undefined), [preview]);

  function change(next: Appearance) {
    setDraft(next);
    setStatus('');
    setError('');
    const background = colorSchema.safeParse(next.background);
    const accent = colorSchema.safeParse(next.accent);
    if (background.success && accent.success) preview({ ...next, background: background.data, accent: accent.data });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const background = colorSchema.safeParse(draft.background);
    const accent = colorSchema.safeParse(draft.accent);
    if (!background.success || !accent.success) {
      setError('请输入像 #F4EDE1 这样的颜色代码，或直接点色块选颜色。');
      return;
    }
    try {
      const normalized = { ...draft, background: background.data, accent: accent.data };
      if (await save(normalized)) {
        setDraft(normalized);
        preview(undefined);
        setStatus('外观已保存');
      } else {
        setError('外观保存失败。请关闭设置查看工作台的保存状态。');
      }
    } catch (failure) {
      setError(message(failure));
    }
  }

  const reducedTransparency = useSyncExternalStore(subscribeToTransparency, systemReducesTransparency);
  const transparency = draft.dialogTransparency ?? (reducedTransparency ? 0 : defaultDialogTransparency);
  const dirty = Object.keys(value).some((key) => draft[key as keyof Appearance] !== value[key as keyof Appearance]);
  return <form className="form appearance-form" onSubmit={(event) => void submit(event)}>
    <p className="muted">修改会立刻显示在页面上。想保留下次继续用，点「保存外观」。</p>
    <fieldset disabled={disabled}>
      <legend>选择一套配色</legend>
      <div className="appearance-presets">
        {presets.map(({ label, background, accent }) => {
          const selected = background === draft.background && accent === draft.accent;
          return <button type="button" aria-pressed={selected} key={label} onClick={() => change({ ...draft, background, accent })}>
            <span aria-hidden="true" className="appearance-swatch" style={{ backgroundColor: background }}>
              <span style={{ backgroundColor: accent }} />
            </span>
            {label}
          </button>;
        })}
      </div>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>调整颜色和文字</legend>
      <div className="appearance-fields">
        <ColorField label="背景色" color={draft.background} update={(background) => change({ ...draft, background })} />
        <ColorField label="按钮和选中项颜色" color={draft.accent} update={(accent) => change({ ...draft, accent })} />
        <label>字体<select value={draft.fontFamily}
          onChange={(event) => change({ ...draft, fontFamily: event.target.value as Appearance['fontFamily'] })}>
          {Object.entries(fonts).map(([key, font]) => <option key={key} value={key}>{font.label}</option>)}
        </select></label>
        <label>文字大小<select value={draft.fontSize}
          onChange={(event) => change({ ...draft, fontSize: Number(event.target.value) })}>
          {[14, 15, 16, 17, 18, 19, 20].map((size) => <option key={size} value={size}>{size}{size === 15 ? '（默认）' : ''}</option>)}
        </select></label>
      </div>
      <details className="settings-details">
        <summary>输入颜色代码（选填）</summary>
        <div className="appearance-fields">
          <label>背景色代码<input type="text" maxLength={7} value={draft.background} spellCheck={false}
            onChange={(event) => change({ ...draft, background: event.target.value })} /></label>
          <label>按钮颜色代码<input type="text" maxLength={7} value={draft.accent} spellCheck={false}
            onChange={(event) => change({ ...draft, accent: event.target.value })} /></label>
        </div>
      </details>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>弹窗玻璃</legend>
      <div className="appearance-fields">
        <div className="appearance-glass-transparency">
          <label>
            <span className="row">透明度<span aria-hidden="true" className="muted">{transparency}%</span></span>
            <input type="range" min={0} max={maxDialogTransparency} value={transparency}
              aria-valuetext={transparency === 0 ? '0%，不透明' : transparency + '%'}
              onChange={(event) => change({ ...draft, dialogTransparency: Number(event.target.value) })} />
          </label>
          <button type="button" className="quiet-button" disabled={draft.dialogTransparency === null}
            onClick={() => change({ ...draft, dialogTransparency: null })}>跟随系统</button>
        </div>
        <div className="appearance-glass-color">
          <ColorField label="弹窗底色" color={draft.dialogTint ?? draft.background}
            update={(dialogTint) => change({ ...draft, dialogTint })} />
          <button type="button" disabled={draft.dialogTint === null} onClick={() => change({ ...draft, dialogTint: null })}>跟随主题</button>
        </div>
      </div>
    </fieldset>
    <div className="row appearance-actions">
      <button type="submit" className="primary" disabled={disabled || !dirty}>保存外观</button>
      <button type="button" disabled={disabled} onClick={() => change(defaultAppearance)}>恢复默认外观</button>
      {status && <span role="status" className="muted">{status}</span>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
