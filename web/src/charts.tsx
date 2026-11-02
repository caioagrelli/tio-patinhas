import { useEffect, useRef } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { brl, localDate } from './api';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

// Same periods as Django's PeriodFilterForm.
export const periods: [string, string][] = [
  ['mes_atual', 'Mês atual'],
  ['mes_anterior', 'Mês anterior'],
  ['30_dias', 'Últimos 30 dias'],
  ['ano_atual', 'Este ano'],
  ['tudo', 'Tudo'],
  ['personalizado', 'Personalizado'],
];
const shift = (date: string, days: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
/** Period from the query string; `from`/`to` are absent for "tudo". The current month runs to its last day to include forecasts. */
export function resolvePeriod(query: URLSearchParams): { period: string; from?: string; to?: string } {
  const today = localDate(),
    month = today.slice(0, 7),
    period = query.get('period') || 'mes_atual';
  const valid = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  switch (period) {
    case '30_dias':
      return { period, from: shift(today, -29), to: today };
    case 'mes_anterior': {
      const prev = shift(month + '-01', -1).slice(0, 7);
      return { period, from: prev + '-01', to: lastDay(prev) };
    }
    case 'ano_atual':
      return { period, from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31' };
    case 'tudo':
      return { period };
    case 'personalizado':
      return {
        period,
        from: valid(query.get('start_date')) || month + '-01',
        to: valid(query.get('end_date')) || today,
      };
    default:
      return { period: 'mes_atual', from: month + '-01', to: lastDay(month) };
  }
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const themeColors = () => ({
  text: css('--muted'),
  grid: css('--line'),
  accent: css('--accent'),
  fg: css('--fg'),
  panel: css('--panel'),
});
const withAlpha = (color: string, alpha: number) =>
  color.startsWith('#') && color.length === 7
    ? color +
      Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0')
    : color;
export const fade = withAlpha;
export const moneyTick = (v: string | number) => brl(Number(v) * 100).replace(/,00$/, '');

/** A Chart.js canvas rebuilt when its config or the theme changes. */
export function ChartCanvas({
  build,
  height,
  label,
}: {
  build: () => ChartConfiguration;
  height: number;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let chart = new Chart(canvas.current!, build());
    const observer = new MutationObserver(() => {
      chart.destroy();
      chart = new Chart(canvas.current!, build());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      observer.disconnect();
      chart.destroy();
    };
  }, [build]);
  return (
    <div className="chart-box" style={{ height }}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
export const legend = (text: string) => ({
  position: 'bottom' as const,
  labels: { color: text, boxWidth: 10, padding: 14 },
});
export const tooltipMoney = {
  callbacks: {
    label: (c: { dataset: { label?: string }; parsed: { y?: number } | number; label?: string }) => {
      const v = typeof c.parsed === 'number' ? c.parsed : (c.parsed.y ?? 0);
      return `${c.dataset.label || c.label || ''}: ${brl(Math.round(v * 100))}`;
    },
  },
};
