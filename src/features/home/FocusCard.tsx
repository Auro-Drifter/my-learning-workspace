import { useState } from 'react';
import { Timer } from 'lucide-react';
import { focusDurations, focusRemaining, localDay, shiftDay } from '../../../shared/home.ts';
import type { FocusMode, FocusTimer, Home } from '../../../shared/home.ts';

const modes = { focus: '专注', short: '短休息', long: '长休息' } as const;

export function FocusCard({ home, now, disabled, save }: {
  home: Home; now: Date; disabled: boolean; save: (next: Home) => Promise<boolean>;
}) {
  const { timer } = home;
  const [label, setLabel] = useState(timer.label);
  const running = timer.deadline !== null;
  const seconds = focusRemaining(timer, now.getTime());
  const duration = focusDurations[timer.mode];
  const display = [Math.floor(seconds / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
  const today = home.focusHistory[localDay(now)] ?? 0;
  const weekStart = localDay(shiftDay(now, -((now.getDay() + 6) % 7)));
  const weekly = Object.entries(home.focusHistory).reduce(
    (total, [date, count]) => date >= weekStart && date <= localDay(now) ? total + count : total, 0);
  const change = (next: FocusTimer) => { void save({ ...home, timer: { ...next, label: label.trim() } }); };

  function changeMode(mode: FocusMode) {
    change({ ...timer, mode, deadline: null, seconds: focusDurations[mode] });
  }

  return <section className="home-card focus-card" aria-labelledby="focus-title">
    <header className="home-card-header">
      <div className="home-card-heading">
        <span className="home-card-icon"><Timer aria-hidden="true" /></span>
        <h2 id="focus-title">番茄钟</h2>
      </div>
      <div className="segmented" aria-label="计时模式">
        {Object.entries(modes).map(([mode, label]) => <button type="button" disabled={disabled || running}
          key={mode} aria-pressed={timer.mode === mode} onClick={() => {
            if (mode !== timer.mode) changeMode(mode as FocusMode);
          }}>{label}</button>)}
      </div>
    </header>
    <div className="focus-controls">
      <div className="focus-ring" style={{ background: 'conic-gradient(var(--accent) ' + seconds / duration * 360 + 'deg, var(--border) 0deg)' }}>
        <div><span key={timer.mode} className="section-enter" role="timer" aria-label="剩余时间">{display}</span><span className="muted">{modes[timer.mode]}</span></div>
      </div>
      <div className="focus-buttons">
        <label>这段时间要做什么？<input maxLength={120} value={label} placeholder="例如 复习线性变换"
          onChange={(event) => setLabel(event.target.value)} /></label>
        <div className="row">
          <button type="button" disabled={disabled || (running && seconds === 0)} className="primary" onClick={() => {
            const current = Date.now();
            const remaining = focusRemaining(timer, current);
            if (running && remaining === 0) return;
            change(running ? { ...timer, deadline: null, seconds: remaining } :
              { ...timer, deadline: current + (remaining || duration) * 1000, seconds: remaining || duration });
          }}>{running ? '暂停' : seconds > 0 && seconds < duration ? '继续' : '开始'}</button>
          <button type="button" disabled={disabled} onClick={() => changeMode(timer.mode)}>重置</button>
          <span className="home-card-meta">今日 {today} · 本周 {weekly}</span>
        </div>
      </div>
    </div>
  </section>;
}
