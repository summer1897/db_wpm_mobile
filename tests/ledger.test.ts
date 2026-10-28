import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeLedger,
  inLedgerRange,
  ledgerDay,
  chartScale,
  type LedgerRecord,
} from '../src/modules/work/ledger';
import { draft, uuid } from '../src/modules/work/domain';
function row(
  owner: string,
  date: string,
  type: LedgerRecord['type'] = 'foundation',
  reviewStatus = '已审核',
  count = 1,
): LedgerRecord {
  return {
    ...draft(owner, 'a'.repeat(64), type),
    date,
    status: 'submitted',
    reviewStatus,
    reporter: { id: owner },
    serverId: uuid(),
    photos: Array.from({ length: count }, () => ({
      id: uuid(),
      key: '',
      name: '图片.png',
      size: 100,
      mime: 'image/png',
    })),
  };
}
test('补录历史施工资料按上传日期立即计入，施工日期口径仍可独立查看', () => {
  const report = { ...row('a', '2026-01-01'), submittedAt: '2026-10-25T16:10:00Z' };
  assert.equal(ledgerDay(report, 'submitted'), '2026-10-26');
  assert.equal(analyzeLedger([report], 7, '2026-10-26', 'submitted').total, 1);
  assert.equal(analyzeLedger([report], 7, '2026-10-26', 'submitted').today, 1);
  assert.equal(analyzeLedger([report], 7, '2026-10-26', 'construction').total, 0);
});
test('审核未知状态归入待审核，图表整数刻度覆盖真实最大值', () => {
  const report = row('a', '2026-10-26', 'foundation', '历史状态');
  const result = analyzeLedger([report], 7, '2026-10-26');
  assert.equal(
    result.review.reduce((sum, group) => sum + group.count, 0),
    result.total,
  );
  assert.equal(result.review[1].count, 1);
  for (const values of [[], [0], [1, 7, 13], [140, 451, 590], [9999]]) {
    const scale = chartScale(values);
    assert.ok(Number.isInteger(scale.tick) && scale.tick >= 1);
    assert.ok(scale.upper >= Math.max(0, ...values));
  }
});
test('管理统计跨人员汇总，忽略草稿，重复回执不重复计数，同编号不同人员分别计数', () => {
  const a = row('a', '2026-10-25', 'foundation', '已审核', 3),
    b = row('b', '2026-10-24', 'transport', '待审核', 2);
  b.id = a.id;
  const report = analyzeLedger(
    [a, a, b, { ...row('c', '2026-10-25'), status: 'draft' }],
    7,
    '2026-10-25',
  );
  assert.equal(report.total, 2);
  assert.equal(report.photos, 5);
  assert.equal(report.people, 2);
  assert.equal(report.today, 1);
  assert.equal(report.rate, 50);
  assert.equal(report.types.find((type) => type.id === 'transport')?.count, 1);
});
test('施工日期口径含今天，排除未来与无效日期，跨月/年窗口不依赖UTC偏移', () => {
  const rows = [
    row('a', '2025-12-30'),
    row('a', '2025-12-31'),
    row('b', '2026-01-05'),
    row('b', '2026-01-06'),
    row('b', '2026-02-31'),
  ];
  const report = analyzeLedger(rows, 7, '2026-01-05');
  assert.equal(report.total, 3);
  assert.equal(report.trend.length, 7);
  assert.equal(report.trend[0].date, '2025-12-30');
  assert.equal(report.trend.at(-1)?.date, '2026-01-05');
  assert.equal(inLedgerRange(rows[3], 0, '2026-01-05'), false);
  assert.equal(inLedgerRange(rows[4], 0, '2026-01-05'), false);
});
test('审核分布、人员填报和类型分布与总量一致，90天趋势按七日汇总不丢记录', () => {
  const rows = [
    row('a', '2026-10-25', 'lifting', '退回修改', 2),
    row('b', '2026-09-02', 'road', '待审核', 1),
    row('c', '2026-08-01', 'substation', '已审核', 4),
  ];
  const report = analyzeLedger(rows, 90, '2026-10-25');
  assert.equal(report.total, 3);
  assert.equal(
    report.review.reduce((sum, group) => sum + group.count, 0),
    3,
  );
  assert.equal(
    report.types.reduce((sum, type) => sum + type.count, 0),
    3,
  );
  assert.equal(
    report.trend.reduce((sum, point) => sum + point.records, 0),
    3,
  );
  assert.equal(
    report.trend.reduce((sum, point) => sum + point.photos, 0),
    7,
  );
  assert.equal(report.people, 3);
  assert.equal(
    report.photoGroups.reduce((sum, group) => sum + group.count, 0),
    3,
  );
});
test('没有前期记录时不虚构增长率，全部口径的趋势明确仅展示近30天', () => {
  const rows = [row('a', '2026-10-25'), row('b', '2025-01-01')];
  const recent = analyzeLedger(rows, 7, '2026-10-25'),
    all = analyzeLedger(rows, 0, '2026-10-25');
  assert.equal(recent.change, null);
  assert.equal(all.total, 2);
  assert.equal(all.trend.length, 30);
  assert.match(all.trendLabel, /近30日/);
  assert.equal(analyzeLedger([], 30, '2026-10-25').rate, 0);
});
