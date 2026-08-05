'use client';

import type { HolidaySet, Job } from '@/lib/earnings';
import { calcEntryEarning, getMultiplier } from '@/lib/earnings';
import { useDBStore } from '@/stores/useDBStore';
import { useProStore } from '@/stores/useProStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Timeframe = 'week' | 'month' | 'quarter' | 'year' | 'all';

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
};

function getDateFilter(tf: Timeframe): string {
  switch (tf) {
    case 'week':
      return "date >= date('now', 'weekday 0', '-7 days')";
    case 'month':
      return "date >= date('now', 'start of month')";
    case 'quarter':
      return "date >= date('now', 'start of month', '-2 months')";
    case 'year':
      return "date >= date('now', 'start of year')";
    default:
      return '1=1';
  }
}

export default function DashboardPage() {
  const { runQuery } = useDBStore();
  const { jobs, settings, setDefaultJob } = useSettingsStore();
  const { isPro } = useProStore();

  const [timeframe, setTimeframe] = useState<Timeframe>('month');
  const [selectedJobId, setSelectedJobId] = useState<number | 'all'>('all');

  const currency = settings?.currency_symbol ?? '₹';

  // Visibility gate — free tier sees last 3 months max
  const visFilter = isPro()
    ? getDateFilter(timeframe)
    : `date >= date('now', '-3 months') AND ${getDateFilter(timeframe)}`;

  const jobFilter = selectedJobId === 'all' ? '1=1' : `l.job_id = ${selectedJobId}`;

  // Pull all logs for the selected timeframe + job
  const logs = runQuery(
    `SELECT l.*, j.hourly_rate, j.weekend_multiplier, j.holiday_multiplier
     FROM logs l LEFT JOIN jobs j ON l.job_id = j.id
     WHERE ${visFilter} AND ${jobFilter}
     ORDER BY l.date DESC`,
  );

  // Active holiday dates for earnings calc
  const holidayRows = runQuery('SELECT date FROM holidays WHERE is_active = 1');
  const holidays: HolidaySet = useMemo(
    () => ({ activeDates: new Set(holidayRows.map((r) => r.date as string)) }),
    [holidayRows],
  );

  // Build job map for earnings lookup
  const jobMap = useMemo(() => {
    const m: Record<number, Job> = {};
    jobs.forEach((j) => {
      m[j.id] = {
        hourly_rate: j.hourly_rate,
        weekend_multiplier: j.weekend_multiplier,
        holiday_multiplier: j.holiday_multiplier,
      };
    });
    return m;
  }, [jobs]);

  // Derived stats
  const stats = useMemo(() => {
    let totalHours = 0;
    let totalEarnings = 0;
    const daySet = new Set<string>();

    for (const log of logs) {
      const dh = log.duration_hours as number;
      totalHours += dh;
      daySet.add(log.date as string);

      const job = jobMap[log.job_id as number];
      if (job) {
        totalEarnings += calcEntryEarning(
          {
            date: log.date as string,
            start_time: log.start_time as string,
            end_time: log.end_time as string,
            duration_hours: dh,
            crosses_midnight: log.crosses_midnight as number,
          },
          job,
          holidays,
        );
      }
    }

    const avgHours = logs.length > 0 ? totalHours / logs.length : 0;

    return {
      sessions: logs.length,
      totalHours: Math.round(totalHours * 10) / 10,
      totalEarnings: Math.round(totalEarnings),
      otDays: daySet.size,
      avgHours: Math.round(avgHours * 10) / 10,
    };
  }, [logs, jobMap, holidays]);

  // Location breakdown
  const locationBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const log of logs) {
      const loc = log.location as string;
      map[loc] = (map[loc] ?? 0) + (log.duration_hours as number);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [logs]);

  // Status breakdown
  const statusBreakdown = useMemo(() => {
    const map: Record<string, number> = { draft: 0, submitted: 0, approved: 0 };
    for (const log of logs) {
      const s = log.status as string;
      if (s in map) map[s]++;
    }
    return map;
  }, [logs]);

  // Recent 7 days bar data
  const recentDays = useMemo(() => {
    const days: { date: string; hours: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const hours = logs.filter((l) => l.date === ds).reduce((s, l) => s + (l.duration_hours as number), 0);
      days.push({ date: ds, hours: Math.round(hours * 10) / 10 });
    }
    return days;
  }, [logs]);

  const maxBarHours = Math.max(...recentDays.map((d) => d.hours), 1);

  // Cumulative earnings over time
  const cumulativeEarnings = useMemo(() => {
    const byDate: Record<string, number> = {};
    for (const log of logs) {
      const job = jobMap[log.job_id as number];
      if (!job) continue;
      const earning = calcEntryEarning(
        {
          date: log.date as string,
          start_time: log.start_time as string,
          end_time: log.end_time as string,
          duration_hours: log.duration_hours as number,
          crosses_midnight: log.crosses_midnight as number,
        },
        job,
        holidays,
      );
      byDate[log.date as string] = (byDate[log.date as string] ?? 0) + earning;
    }
    return Object.keys(byDate)
      .sort()
      .reduce<{ rows: { date: string; label: string; total: number }[]; sum: number }>(
        (acc, date) => {
          const sum = acc.sum + byDate[date];
          acc.rows.push({ date, label: dayjs(date).format('MMM D'), total: Math.round(sum) });
          return { rows: acc.rows, sum };
        },
        { rows: [], sum: 0 },
      ).rows;
  }, [logs, jobMap, holidays]);

  // Weekday / weekend / holiday hours split
  const shiftBreakdown = useMemo(() => {
    const map = { weekday: 0, weekend: 0, holiday: 0 };
    for (const log of logs) {
      const dateStr = log.date as string;
      const dh = log.duration_hours as number;
      if (holidays.activeDates.has(dateStr)) map.holiday += dh;
      else if (dayjs(dateStr).day() === 0 || dayjs(dateStr).day() === 6) map.weekend += dh;
      else map.weekday += dh;
    }
    return map;
  }, [logs, holidays]);

  // Burnout gauge — always the current calendar week, independent of the timeframe tab
  const thisWeekLogs = runQuery(`SELECT duration_hours FROM logs l WHERE ${getDateFilter('week')} AND ${jobFilter}`);
  const thisWeekHours =
    Math.round(thisWeekLogs.reduce((s, l) => s + (l.duration_hours as number), 0) * 10) / 10;
  const burnoutThreshold = settings?.burnout_threshold_hours ?? 45;
  const burnoutPct = burnoutThreshold > 0 ? thisWeekHours / burnoutThreshold : 0;
  const burnoutColor = burnoutPct >= 1 ? '#dc2626' : burnoutPct >= 0.7 ? '#d97706' : '#16a34a';

  // Earnings by rate tier (base / weekend premium / holiday premium), bucketed by week or month
  const rateTierBuckets = useMemo(() => {
    const buckets: Record<string, { label: string; base: number; weekend: number; holiday: number }> = {};
    let hasPremium = false;
    const bucketByMonth = timeframe === 'year' || timeframe === 'all';

    for (const log of logs) {
      const job = jobMap[log.job_id as number];
      if (!job) continue;
      const dateStr = log.date as string;
      const dh = log.duration_hours as number;
      const multiplier = getMultiplier(dateStr, job, holidays);
      const base = dh * job.hourly_rate;
      const isHoliday = holidays.activeDates.has(dateStr);
      const isWeekend = !isHoliday && (dayjs(dateStr).day() === 0 || dayjs(dateStr).day() === 6);

      const bucketDate = bucketByMonth ? dayjs(dateStr).startOf('month') : dayjs(dateStr).startOf('week');
      const key = bucketDate.format('YYYY-MM-DD');
      if (!buckets[key]) {
        buckets[key] = { label: bucketDate.format(bucketByMonth ? 'MMM YYYY' : 'MMM D'), base: 0, weekend: 0, holiday: 0 };
      }
      buckets[key].base += base;
      if (isHoliday) {
        buckets[key].holiday += (multiplier - 1) * base;
        if (multiplier !== 1) hasPremium = true;
      } else if (isWeekend) {
        buckets[key].weekend += (multiplier - 1) * base;
        if (multiplier !== 1) hasPremium = true;
      }
    }

    const rows = Object.keys(buckets)
      .sort()
      .map((k) => ({
        label: buckets[k].label,
        base: Math.round(buckets[k].base),
        weekend: Math.round(buckets[k].weekend),
        holiday: Math.round(buckets[k].holiday),
      }));
    return { rows, hasPremium };
  }, [logs, jobMap, holidays, timeframe]);

  const defaultJob = jobs.find((j) => j.is_default === 1);

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 20px 80px' }}>
      {/* ── Job switcher ─────────────────────────────────── */}
      {jobs.length > 1 && (
        <div style={{ marginBottom: '20px' }}>
          <p style={sectionLabel}>Job</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <JobPill
              label="All jobs"
              active={selectedJobId === 'all'}
              color="#0e0e0e"
              onClick={() => setSelectedJobId('all')}
            />
            {jobs.map((j) => (
              <JobPill
                key={j.id}
                label={j.name}
                active={selectedJobId === j.id}
                color={j.color}
                onClick={() => setSelectedJobId(j.id)}
                isDefault={j.is_default === 1}
                onSetDefault={() => setDefaultJob(j.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Single job — show default badge + change option */}
      {jobs.length === 1 && defaultJob && (
        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: defaultJob.color,
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '0.8rem', color: '#0e0e0e' }}>{defaultJob.name}</span>
          <span style={{ fontSize: '0.65rem', padding: '1px 6px', border: '1px solid #d1c9b8', color: '#6b6b5e' }}>
            DEFAULT
          </span>
        </div>
      )}

      {/* ── Timeframe tabs ───────────────────────────────── */}
      <div
        data-onboarding="timeframe-tabs"
        style={{
          display: 'flex',
          gap: '0',
          borderBottom: '1px solid #d1c9b8',
          marginBottom: '24px',
          overflowX: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#d1c9b8 transparent',
          paddingBottom: '4px',
        }}>
        {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            style={{
              padding: '9px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              border: 'none',
              borderBottom: timeframe === tf ? '2px solid #0e0e0e' : '2px solid transparent',
              background: 'none',
              color: timeframe === tf ? '#0e0e0e' : '#6b6b5e',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              marginBottom: '-1px',
            }}>
            {TIMEFRAME_LABELS[tf]}
          </button>
        ))}
      </div>

      {!isPro() && (
        <div
          style={{
            padding: '8px 12px',
            background: '#fffbeb',
            border: '1px solid #d97706',
            marginBottom: '20px',
            fontSize: '0.72rem',
            color: '#92400e',
          }}>
          Showing last 3 months only ·{' '}
          <a href="/settings" style={{ color: '#d97706' }}>
            Upgrade to Pro
          </a>{' '}
          for full history
        </div>
      )}

      {/* ── KPI strip ────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '1px',
          background: '#d1c9b8',
          marginBottom: '24px',
        }}>
        {[
          { label: 'Sessions', value: String(stats.sessions) },
          { label: 'Hours', value: `${stats.totalHours}h` },
          { label: 'OT days', value: String(stats.otDays) },
          { label: 'Avg/session', value: `${stats.avgHours}h` },
          { label: 'Est. earnings', value: `${currency}${stats.totalEarnings.toLocaleString('en-IN')}`, wide: true },
        ].map((card) => (
          <div
            key={card.label}
            style={{ padding: '16px 14px', background: '#f5f0e8', gridColumn: card.wide ? 'span 2' : undefined }}>
            <p
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '1.6rem',
                color: '#0e0e0e',
                margin: '0 0 4px',
                letterSpacing: '-0.02em',
              }}>
              {card.value}
            </p>
            <p
              style={{
                fontSize: '0.65rem',
                color: '#6b6b5e',
                margin: 0,
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
              }}>
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Last 7 days bar chart ─────────────────────────── */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Last 7 days</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }}>
          {recentDays.map((day) => {
            const pct = day.hours / maxBarHours;
            const dow = new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
            return (
              <div
                key={day.date}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  height: '100%',
                }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div
                    style={{
                      width: '100%',
                      height: `${Math.max(pct * 100, day.hours > 0 ? 4 : 0)}%`,
                      background: day.hours > 0 ? '#0e0e0e' : '#d1c9b8',
                      transition: 'height 0.2s',
                    }}
                    title={`${day.hours}h`}
                  />
                </div>
                <span style={{ fontSize: '0.6rem', color: '#6b6b5e' }}>{dow}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Cumulative earnings ──────────────────────────── */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Cumulative earnings</p>
        {cumulativeEarnings.length === 0 ? (
          <p style={{ fontSize: '0.78rem', color: '#6b6b5e' }}>No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={cumulativeEarnings} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="earningsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#f0fdf4" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#d1c9b8" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b6b5e' }} axisLine={{ stroke: '#d1c9b8' }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b6b5e' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${currency}${v}`}
                width={56}
              />
              <Tooltip formatter={(v) => [`${currency}${v}`, 'Total']} labelStyle={{ color: '#0e0e0e' }} />
              <Area type="monotone" dataKey="total" stroke="#16a34a" strokeWidth={2} fill="url(#earningsFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Location breakdown ───────────────────────────── */}
      {locationBreakdown.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <p style={{ ...sectionLabel, marginBottom: '12px' }}>By location</p>
          <DonutChart
            data={locationBreakdown.map(([loc, hours]) => ({
              name: loc,
              value: Math.round(hours * 10) / 10,
              color: LOCATION_COLORS[loc] ?? '#6b6b5e',
            }))}
            centerValue={`${stats.totalHours}h`}
            centerLabel="Total"
          />
        </div>
      )}

      {/* ── Shift-type breakdown ─────────────────────────── */}
      {stats.totalHours > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <p style={{ ...sectionLabel, marginBottom: '12px' }}>By shift type</p>
          <DonutChart
            data={(['weekday', 'weekend', 'holiday'] as const)
              .filter((k) => shiftBreakdown[k] > 0)
              .map((k) => ({ name: k, value: Math.round(shiftBreakdown[k] * 10) / 10, color: SHIFT_COLORS[k] }))}
            centerValue={`${stats.totalHours}h`}
            centerLabel="Total"
          />
        </div>
      )}

      {/* ── Burnout gauge ─────────────────────────────────── */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Burnout — this week</p>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie
              data={[
                { value: Math.min(thisWeekHours, burnoutThreshold) },
                { value: Math.max(burnoutThreshold - thisWeekHours, 0) },
              ]}
              dataKey="value"
              cx="50%"
              cy="90%"
              startAngle={180}
              endAngle={0}
              innerRadius={70}
              outerRadius={100}
              stroke="none">
              <Cell fill={burnoutColor} />
              <Cell fill="#d1c9b8" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <p style={{ textAlign: 'center', fontFamily: 'var(--font-serif)', fontSize: '1.2rem', color: burnoutColor, margin: 0 }}>
          {thisWeekHours}h / {burnoutThreshold}h
        </p>
      </div>

      {/* ── Earnings by rate tier ─────────────────────────── */}
      {rateTierBuckets.hasPremium && (
        <div style={{ marginBottom: '28px' }}>
          <p style={{ ...sectionLabel, marginBottom: '12px' }}>Earnings by rate tier</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rateTierBuckets.rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="#d1c9b8" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b6b5e' }} axisLine={{ stroke: '#d1c9b8' }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b6b5e' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${currency}${v}`}
                width={56}
              />
              <Tooltip formatter={(v) => `${currency}${v}`} labelStyle={{ color: '#0e0e0e' }} />
              <Bar dataKey="base" stackId="tier" fill="#0e0e0e" name="Base" />
              <Bar dataKey="weekend" stackId="tier" fill="#3B8BD4" name="Weekend premium" />
              <Bar dataKey="holiday" stackId="tier" fill="#d97706" name="Holiday premium" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Status breakdown ─────────────────────────────── */}
      {stats.sessions > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <p style={{ ...sectionLabel, marginBottom: '12px' }}>By status</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1px', background: '#d1c9b8' }}>
            {[
              { key: 'draft', label: 'Draft', color: '#6b6b5e' },
              { key: 'submitted', label: 'Submitted', color: '#d97706' },
              { key: 'approved', label: 'Approved', color: '#16a34a' },
            ].map((s) => (
              <div key={s.key} style={{ padding: '14px 12px', background: '#f5f0e8' }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', color: s.color, margin: '0 0 2px' }}>
                  {statusBreakdown[s.key] ?? 0}
                </p>
                <p
                  style={{
                    fontSize: '0.65rem',
                    color: '#6b6b5e',
                    margin: 0,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {stats.sessions === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b6b5e' }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', color: '#0e0e0e', marginBottom: '8px' }}>
            No data yet.
          </p>
          <p style={{ fontSize: '0.82rem' }}>Log some overtime entries to see your dashboard.</p>
        </div>
      )}
    </div>
  );
}

const LOCATION_COLORS: Record<string, string> = { office: '#0e0e0e', home: '#3B8BD4', client: '#d97706' };
const SHIFT_COLORS: Record<string, string> = { weekday: '#6b6b5e', weekend: '#3B8BD4', holiday: '#d97706' };

function DonutChart({
  data,
  centerValue,
  centerLabel,
}: {
  data: { name: string; value: number; color: string }[];
  centerValue: string;
  centerLabel: string;
}) {
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="none">
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${v}h`} />
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3rem', color: '#0e0e0e', margin: 0 }}>{centerValue}</p>
          <p style={{ fontSize: '0.6rem', color: '#6b6b5e', margin: 0, textTransform: 'uppercase' }}>{centerLabel}</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
        {data.map((d) => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: d.color, display: 'inline-block' }} />
            <span style={{ fontSize: '0.7rem', color: '#0e0e0e', textTransform: 'capitalize' }}>{d.name}</span>
            <span style={{ fontSize: '0.68rem', color: '#6b6b5e' }}>{d.value}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function JobPill({
  label,
  active,
  color,
  onClick,
  isDefault,
  onSetDefault,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
  isDefault?: boolean;
  onSetDefault?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
      <button
        onClick={onClick}
        style={{
          padding: '6px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          border: '1px solid',
          borderColor: active ? color : '#d1c9b8',
          background: active ? color : 'none',
          color: active ? 'white' : '#0e0e0e',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
        {color !== '#0e0e0e' && (
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: active ? 'white' : color,
              display: 'inline-block',
            }}
          />
        )}
        {label}
      </button>
      {onSetDefault && !isDefault && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetDefault();
          }}
          title="Set as default job"
          style={{
            padding: '6px 8px',
            border: '1px solid #d1c9b8',
            borderLeft: 'none',
            background: 'none',
            fontSize: '0.65rem',
            color: '#6b6b5e',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}>
          ★
        </button>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.65rem',
  letterSpacing: '0.1em',
  color: '#6b6b5e',
  textTransform: 'uppercase',
  margin: '0 0 8px',
};
