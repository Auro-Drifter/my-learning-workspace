import { useState } from 'react';
import { CalendarCheck, Flame, Settings2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { localDay, recordDay, shiftDay, streak } from '../../../shared/home.ts';
import type { Home } from '../../../shared/home.ts';

type Update = (next: Home) => Promise<boolean>;

function Heatmap({ home, now, days }: { home: Home; now: Date; days: number }) {
  const today = localDay(now);
  const firstDay = shiftDay(now, -(days - 1));
  const offset = (firstDay.getDay() + 6) % 7;
  const weeks = Math.ceil((days + offset) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    if (index < offset || index >= days + offset) return null;
    const date = shiftDay(firstDay, index - offset);
    const key = localDay(date);
    return { date, key, count: home.checkIns[key]?.length ?? 0 };
  });
  const months = Array.from({ length: weeks }, (_, index) => {
    const week = cells.slice(index * 7, index * 7 + 7);
    const month = week.find((cell) => cell?.date.getDate() === 1) ?? (index === 0 && days <= 30 ? week.find(Boolean) : null);
    return month ? month.date.getMonth() + 1 + '月' : '';
  });
  return <div className="habit-scroll" role="region" tabIndex={0} aria-label={'近 ' + days + ' 天的打卡记录'}>
    <div className={'habit-calendar' + (days > 100 ? ' habit-calendar-year' : '')}
      style={{ '--weeks': weeks } as CSSProperties}>
      <div className="habit-months" aria-hidden="true">{months.map((month, index) => <span key={index}>{month}</span>)}</div>
      <div className="habit-weekdays" aria-hidden="true">{['一', '', '三', '', '五', '', '日'].map((name, index) =>
        <span key={index}>{name}</span>)}</div>
      <div className="habit-grid" aria-hidden="true">
        {cells.map((cell, index) => {
          const level = cell?.count ? Math.ceil((cell.count / home.habits.length) * 4) : 0;
          return <span key={index} data-level={level} data-current={cell?.key === today}
            className={cell ? 'habit-day' : 'habit-day habit-day-empty'}
            title={cell ? cell.key + ' · ' + cell.count + ' 项打卡' : undefined} />;
        })}
      </div>
    </div>
  </div>;
}

export function HabitCard({ home, now, disabled, save, edit }: {
  home: Home; now: Date; disabled: boolean; save: Update; edit: () => void;
}) {
  const [days, setDays] = useState(365);
  const today = localDay(now);
  const selected = home.checkIns[today] ?? [];
  const total = Object.entries(home.checkIns).filter(([day, items]) => day >= localDay(shiftDay(now, 1 - days)) && day <= today && items.length > 0).length;
  return <section className="home-card habit-card" aria-labelledby="habit-title">
    <header className="home-card-header">
      <div className="home-card-heading">
        <span className="home-card-icon"><CalendarCheck aria-hidden="true" /></span>
        <h2 id="habit-title">习惯打卡</h2>
      </div>
      <div className="row">
        <div className="segmented" aria-label="打卡记录范围">
          <button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>近 30 天</button>
          <button type="button" aria-pressed={days === 365} onClick={() => setDays(365)}>近一年</button>
        </div>
        <button type="button" className="quiet-button home-icon-button" aria-label="编辑习惯" title="编辑习惯" disabled={disabled} onClick={edit}>
          <Settings2 className="tool-icon" aria-hidden="true" />
        </button>
      </div>
    </header>
    <div className="habit-actions">
      <span className="habit-streak"><Flame className="tool-icon" aria-hidden="true" />连续 {streak(home, now)} 天</span>
      <span className="muted">今日</span>
      {home.habits.map(({ id, title }) => {
        const checked = selected.includes(id);
        return <button type="button" disabled={disabled} aria-pressed={checked} key={id} onClick={() => {
          const next = checked ? selected.filter((entry) => entry !== id) : [...selected, id];
          void save({ ...home, checkIns: recordDay(home.checkIns, today, next) });
        }}><span aria-hidden="true">{checked ? '✓' : '○'}</span> {title}</button>;
      })}
      {home.habits.length === 0 && <span className="muted">在首页设置中添加习惯。</span>}
    </div>
    <Heatmap key={days} home={home} now={now} days={days} />
    <div className="habit-footer"><span>记录了 {total} 天</span>
      <span className="habit-legend" aria-label="打卡强度从少到多">少 {Array.from({ length: 5 }, (_, value) =>
        <i key={value} className="habit-day" data-level={value} aria-hidden="true" />)} 多</span>
    </div>
  </section>;
}
