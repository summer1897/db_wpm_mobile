import { constructionTypes, localDate, validDate, type WorkRecord } from './domain';

export interface LedgerRecord extends WorkRecord {
  reporter: { id: string };
}
export interface LedgerSnapshot {
  reports: LedgerRecord[];
  scope: string;
  projectName: string;
  generatedAt: string;
  ledgerStatus: 'live' | 'receipts';
}
export type LedgerRange = 0 | 7 | 30 | 90;
export type LedgerDateBasis = 'submitted' | 'construction';
export const projectToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export function chartScale(values: number[]) {
  const rough = Math.max(1, Math.ceil(Math.max(4, ...values) / 4));
  const unit = 10 ** Math.floor(Math.log10(rough));
  const tick = ([1, 2, 5, 10].find((step) => step * unit >= rough) || 10) * unit;
  return { tick, upper: tick * 4 };
}
/** 上传统计统一按项目所在的北京时间归日，避免 UTC 午夜及手机时区改变统计结果。 */
export function ledgerDay(row: WorkRecord, basis: LedgerDateBasis) {
  if (basis === 'construction') return row.date;
  const time = Date.parse(row.submittedAt || row.createdAt);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
}
export const typeColors = [
  '#377c65',
  '#699d87',
  '#88ac72',
  '#a7b97d',
  '#bfa978',
  '#8b9da0',
  '#bbc8b4',
];
export const reviewGroups = [
  { id: '已审核', label: '审核通过', color: '#3c8267' },
  { id: '待审核', label: '待审核', color: '#c7a66c' },
  { id: '退回修改', label: '审核不通过', color: '#be8778' },
] as const;
export function dayBefore(day: string, count: number) {
  const date = new Date(day + 'T12:00:00');
  date.setDate(date.getDate() - count);
  return localDate(date);
}
export function inLedgerRange(
  row: WorkRecord,
  range: LedgerRange,
  today = projectToday(),
  basis: LedgerDateBasis = 'construction',
) {
  const day = ledgerDay(row, basis);
  return validDate(day) && day <= today && (!range || day >= dayBefore(today, range - 1));
}
/** 只统计已归档的真实施工记录，不把照片/日志数量冒充工程完成量；复用原施工类型和审核口径。 */
export function analyzeLedger(
  input: LedgerRecord[],
  range: LedgerRange,
  today = projectToday(),
  basis: LedgerDateBasis = 'construction',
) {
  const unique = [
    ...new Map(
      input
        .filter((row) => row.status === 'submitted')
        .map((row) => [row.owner + ':' + row.id, row]),
    ).values(),
  ];
  const rows = unique.filter((row) => inLedgerRange(row, range, today, basis));
  const photos = rows.reduce((sum, row) => sum + row.photos.length, 0);
  const review = reviewGroups.map((group) => ({
    ...group,
    count: rows.filter(
      (row) =>
        (reviewGroups.some((item) => item.id === row.reviewStatus)
          ? row.reviewStatus
          : '待审核') === group.id,
    ).length,
  }));
  const types = constructionTypes.map((type, index) => ({
    ...type,
    count: rows.filter((row) => row.type === type.id).length,
    color: typeColors[index],
  }));
  // 汇总只使用不可见的账号标识去重，不生成姓名排行或向图表传递个人姓名。
  const people = new Set(rows.map((row) => row.owner)).size;
  const photoGroups = [
    { label: '1张照片', min: 1, max: 1, color: '#377c65' },
    { label: '2—3张', min: 2, max: 3, color: '#699d87' },
    { label: '4—6张', min: 4, max: 6, color: '#88ac72' },
    { label: '7—10张', min: 7, max: 10, color: '#bfa978' },
  ].map((group) => ({
    ...group,
    count: rows.filter((row) => row.photos.length >= group.min && row.photos.length <= group.max)
      .length,
  }));
  const span = range || 30,
    daily: { date: string; records: number; photos: number }[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const date = dayBefore(today, i);
    const reports = unique.filter((row) => ledgerDay(row, basis) === date);
    daily.push({
      date,
      records: reports.length,
      photos: reports.reduce((sum, row) => sum + row.photos.length, 0),
    });
  }
  // 90 日按连续七日汇总，减少手机上的折线噪声；全部口径的趋势明确显示近30日。
  const trend =
    span > 30
      ? Array.from({ length: Math.ceil(daily.length / 7) }, (_, index) => {
          const group = daily.slice(index * 7, index * 7 + 7);
          return {
            date: group[group.length - 1].date,
            records: group.reduce((n, day) => n + day.records, 0),
            photos: group.reduce((n, day) => n + day.photos, 0),
          };
        })
      : daily;
  const previousStart = range ? dayBefore(today, range * 2 - 1) : '',
    previousEnd = range ? dayBefore(today, range) : '';
  const previous = range
    ? unique.filter((row) => {
        const date = ledgerDay(row, basis);
        return validDate(date) && date >= previousStart && date <= previousEnd;
      }).length
    : 0;
  return {
    rows,
    total: rows.length,
    photos,
    people,
    today: unique.filter((row) => ledgerDay(row, basis) === today).length,
    review,
    approved: review[0].count,
    rate: rows.length ? Math.round((review[0].count / rows.length) * 100) : 0,
    types,
    photoGroups,
    trend,
    trendLabel:
      range === 90
        ? '近90日 · 每七日汇总'
        : `近${span}日 · 按${basis === 'submitted' ? '上传' : '施工'}日期`,
    previous,
    change: range && previous ? Math.round(((rows.length - previous) / previous) * 100) : null,
  };
}
