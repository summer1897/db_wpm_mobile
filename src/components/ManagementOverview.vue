<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import FieldIcon from './FieldIcon.vue';
import LedgerChart from './LedgerChart.vue';
import { analyzeLedger, type LedgerRange, type LedgerDateBasis } from '../modules/work/ledger';
import { formatTime, typeName } from '../modules/work/domain';
import { handleError, newWork, refreshLedger, state } from '../modules/work/store';
const range = ref<LedgerRange>(30),
  basis = ref<LedgerDateBasis>('submitted'),
  metric = ref<'records' | 'photos'>('records');
const ranges = [
  { value: 7 as const, name: '近7天' },
  { value: 30 as const, name: '近30天' },
  { value: 90 as const, name: '近90天' },
  { value: 0 as const, name: '全部' },
];
const reports = computed(() => state.ledger?.reports || []);
const analysis = computed(() => analyzeLedger(reports.value, range.value, undefined, basis.value));
const recent = computed(() =>
  [...analysis.value.rows]
    .sort((a, b) => (b.submittedAt || b.createdAt).localeCompare(a.submittedAt || a.createdAt))
    .slice(0, 3),
);
const largestType = computed(() => Math.max(1, ...analysis.value.types.map((type) => type.count)));
const largestPhotoGroup = computed(() =>
  Math.max(1, ...analysis.value.photoGroups.map((group) => group.count)),
);
const ledger = () => uni.navigateTo({ url: '/pages/ledger/index' });
const users = () => uni.navigateTo({ url: '/pages/users/index' });
const create = () => {
  void newWork().catch(handleError);
};
const personal = () => uni.switchTab({ url: '/pages/records/index' });
const details = (id: string, owner: string) =>
  uni.navigateTo({ url: `/pages/detail/index?id=${id}&owner=${owner}&ledger=1` });
onMounted(() => {
  void refreshLedger();
});
</script>
<template>
  <view class="management-overview">
    <view class="management-hero">
      <view class="between">
        <view class="manager-kicker"> <view class="hero-dot" /><text>项目工作台账</text> </view
        ><text class="manager-badge">管理人员</text>
      </view>
      <text class="management-project">{{
        state.connection?.projectName || '风电施工现场管理'
      }}</text>
      <view class="hero-stat"
        ><text class="hero-total">{{ state.ledger ? analysis.total : '—' }}</text>
        <view class="hero-unit"
          ><text>条施工记录</text
          ><text class="hero-range"
            >{{ ranges.find((item) => item.value === range)?.name }} · 已提交</text
          ></view
        >
        <FieldIcon name="chart" :size="45" />
      </view>
      <view class="hero-bottom">
        <view
          ><text>{{ state.ledger ? analysis.photos : '—' }}</text
          ><text>现场照片</text></view
        >
        <view
          ><text>{{ state.ledger ? analysis.people : '—' }}</text
          ><text>填报账号</text></view
        >
        <view
          ><text>{{ state.ledger ? analysis.today : '—' }}</text
          ><text>{{ basis === 'submitted' ? '今日上传记录' : '今日施工记录' }}</text></view
        >
      </view>
    </view>
    <view class="manager-actions"
      ><button class="primary" @click="create">
        <FieldIcon name="plus" :size="19" /><text>新增施工记录</text></button
      ><button class="secondary" @click="ledger">
        <FieldIcon name="records" active :size="19" /><text>查看工作台账</text>
      </button></view
    >
    <view class="management-utility"
      ><button class="plain-button" @click="users">
        <FieldIcon name="user" active :size="16" />用户信息 →</button
      ><view class="auto-update"
        ><view class="status-dot" :class="{ offline: !state.online }" /><text>{{
          state.online ? '自动更新' : '当前离线'
        }}</text></view
      ></view
    >
    <view class="statistics-head between"
      ><text class="section-title">项目资料概览</text
      ><button class="plain-button" :disabled="state.ledgerBusy" @click="refreshLedger">
        {{ state.ledgerBusy ? '更新中' : '更新数据' }}
      </button></view
    >
    <view class="date-range"
      ><button
        v-for="item in ranges"
        :key="item.value"
        :class="{ active: range === item.value }"
        @click="range = item.value"
      >
        {{ item.name }}
      </button></view
    >
    <view class="statistics-basis"
      ><button :class="{ active: basis === 'submitted' }" @click="basis = 'submitted'">
        按上传日期</button
      ><button :class="{ active: basis === 'construction' }" @click="basis = 'construction'">
        按施工日期
      </button></view
    >
    <view v-if="state.ledgerError" class="banner error">{{ state.ledgerError }}</view>
    <view v-if="state.ledger?.ledgerStatus === 'receipts'" class="banner"
      >当前为服务器归档回执统计，原项目实时审核台账暂不可读取。</view
    >
    <template v-if="state.ledger">
      <view class="card trend-card">
        <view class="between">
          <view
            ><text class="chart-title">施工记录趋势</text
            ><text class="chart-caption">{{ analysis.trendLabel }}</text>
          </view>
          <view class="metric-switch"
            ><button :class="{ active: metric === 'records' }" @click="metric = 'records'">
              记录</button
            ><button :class="{ active: metric === 'photos' }" @click="metric = 'photos'">
              照片
            </button></view
          >
        </view>
        <view class="trend-heading"
          ><text>{{ metric === 'records' ? analysis.total : analysis.photos }}</text
          ><text>{{ metric === 'records' ? '条' : '张' }}</text
          ><text
            v-if="range && metric === 'records' && analysis.change !== null"
            class="period-change"
            >较前期 {{ analysis.change > 0 ? '+' : '' }}{{ analysis.change }}%</text
          ></view
        >
        <LedgerChart kind="trend" :points="analysis.trend" :metric="metric" /><text
          v-if="!analysis.total"
          class="no-data-copy"
          >所选时段暂无已提交资料</text
        >
      </view>
      <view class="card chart-card">
        <view class="between"
          ><text class="chart-title">施工类型分布</text
          ><text class="chart-caption"
            >{{ analysis.types.filter((type) => type.count).length }} / 7 类</text
          ></view
        >
        <view class="type-ranks">
          <view v-for="type in analysis.types" :key="type.id" class="type-rank"
            ><text class="type-label">{{ type.short }}</text>
            <view class="rank-track">
              <view
                class="rank-fill"
                :style="{
                  width: (type.count / largestType) * 100 + '%',
                  background: type.color,
                }"
              /> </view
            ><text class="rank-value">{{ type.count }}</text>
          </view>
        </view>
        <view class="chart-footnote">按已归档施工记录数量统计</view>
      </view>
      <view class="card chart-card">
        <view class="between"
          ><text class="chart-title">资料审核情况</text
          ><text class="chart-caption">{{ analysis.approved }} 条已通过</text></view
        >
        <view class="review-layout">
          <LedgerChart
            kind="review"
            :groups="analysis.review"
            :total="analysis.total"
            :rate="analysis.rate"
          />
          <view class="review-legend">
            <view v-for="group in analysis.review" :key="group.id">
              <view class="legend-name">
                <view class="legend-dot" :style="{ background: group.color }" /><text>{{
                  group.label
                }}</text> </view
              ><text class="legend-value">{{ group.count }}<text> 条</text></text>
            </view>
          </view>
        </view>
      </view>
      <view class="card chart-card">
        <view class="between"
          ><text class="chart-title">现场照片分布</text
          ><text class="chart-caption">按每条记录的照片数量</text>
        </view>
        <view v-if="!analysis.total" class="no-data-copy">所选时段暂无施工记录</view>
        <view v-for="(group, index) in analysis.photoGroups" :key="group.label" class="person-rank"
          ><text class="person-number">{{ String(index + 1).padStart(2, '0') }}</text>
          <view class="person-info">
            <view class="between"
              ><text class="person-name">{{ group.label }}</text
              ><text class="person-count">{{ group.count }} 条</text></view
            >
            <view class="person-track">
              <view
                :style="{
                  width: (group.count / largestPhotoGroup) * 100 + '%',
                  background: group.color,
                }"
              />
            </view>
          </view> </view
        ><text class="chart-footnote">仅统计已提交记录，不展示填报人员姓名</text>
      </view>
      <view class="section-head between"
        ><text class="section-title">最新项目记录</text
        ><button class="plain-button" @click="ledger">全部台账 →</button></view
      >
      <view v-if="!recent.length" class="card empty">
        <FieldIcon name="folder" :size="30" /><text class="empty-title">等待第一份现场记录</text
        ><text class="empty-copy">人员提交后，台账与图表同步更新</text>
      </view>
      <view
        v-for="row in recent"
        :key="row.owner + ':' + row.id"
        class="card record-card"
        @click="details(row.id, row.owner)"
      >
        <view class="between"
          ><text class="record-type">{{ typeName(row.type) }}</text
          ><text class="reporter-chip">{{ row.date }}</text></view
        ><text class="record-location">{{ row.location }}</text
        ><text class="record-content">{{ row.content }}</text>
        <view class="record-footer"
          ><text>提交 {{ formatTime(row.submittedAt) }}</text
          ><text>{{ row.photos.length }} 张照片</text></view
        >
      </view>
    </template>
    <view v-else-if="!state.ledgerBusy" class="card empty">
      <FieldIcon name="chart" :size="36" /><text class="empty-title">联网获取项目台账</text
      ><text class="empty-copy">离线时仍可填写并保存自己的施工记录</text
      ><button class="secondary" @click="personal">查看我的记录</button>
    </view>
    <view class="statistics-note"
      ><text
        >统计已归档资料，当前按{{
          basis === 'submitted' ? '上传日期' : '施工日期'
        }}筛选，不包含未上传草稿。</text
      ><text v-if="state.ledger">更新于 {{ formatTime(state.ledger.generatedAt) }}</text></view
    >
    <button class="plain-button personal-entry" @click="personal">
      查看我的记录与待上传任务 →
    </button>
  </view>
</template>
<style scoped>
.management-utility {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -12px 0 24px;
}
.management-utility button,
.auto-update {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.auto-update {
  color: #8fa184;
  font-size: 11px;
}
.statistics-basis {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: -3px 0 20px;
  border-bottom: 1px solid #dfe7d9;
}
.statistics-basis button {
  padding: 8px 0 10px;
  border-radius: 0;
  background: transparent;
  font-size: 12px;
  color: #97a48c;
  border-bottom: 2px solid transparent;
}
.statistics-basis button.active {
  color: #356b4e;
  border-bottom-color: #5b8a65;
  font-weight: 600;
}
.management-hero {
  padding: 23px 23px 20px;
  border-radius: 25px;
  background: linear-gradient(135deg, #234e40, #335e4c);
  color: #eff5e8;
  box-shadow: 0 12px 25px rgba(31, 64, 43, 0.08);
}

.manager-kicker {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #becdb1;
}

.hero-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c1d7a0;
}

.manager-badge {
  border: 1px solid #66816a;
  border-radius: 7px;
  font-size: 10px;
  color: #cfdec1;
  padding: 3px 7px;
}

.management-project {
  display: block;
  font-size: 15px;
  font-weight: 500;
  color: #e1ebd6;
  margin-top: 15px;
}

.hero-stat {
  display: flex;
  gap: 11px;
  align-items: flex-end;
  padding: 11px 0 22px;
}

.hero-total {
  font-size: 57px;
  letter-spacing: -2px;
  line-height: 1.05;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}

.hero-unit {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  margin-bottom: 5px;
  color: #d5e1c8;
}

.hero-range {
  font-size: 9px;
  color: #9fb495;
  margin-top: 4px;
}

.hero-stat .field-icon {
  margin-left: auto;
  opacity: 0.65;
  margin-bottom: 7px;
}

.hero-bottom {
  border-top: 1px solid rgba(204, 224, 184, 0.16);
  padding-top: 17px;
  display: flex;
}

.hero-bottom > view {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.hero-bottom > view > text:first-child {
  font-size: 22px;
  color: #e1edd0;
  font-weight: 550;
  line-height: 1.3;
}

.hero-bottom > view > text:last-child {
  font-size: 10px;
  color: #a1b393;
  margin-top: 6px;
}

.manager-actions {
  display: flex;
  gap: 11px;
  margin: 17px 0 27px;
}

.manager-actions button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 14px 7px;
  font-size: 13px;
}

.manager-actions .primary .field-icon {
  background: #e2ebd4;
  border-radius: 4px;
}

.statistics-head .plain-button {
  font-size: 12px;
}

.date-range {
  display: flex;
  gap: 6px;
  margin: 16px 0 19px;
  padding: 4px;
  background: #e6ede1;
  border-radius: 13px;
}

.date-range button {
  flex: 1;
  background: transparent;
  padding: 8px 3px;
  font-size: 12px;
  color: #8a9a7f;
  border-radius: 10px;
}

.date-range .active {
  background: #fcfef8;
  color: #426a4c;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(48, 71, 37, 0.04);
}

.chart-title {
  display: block;
  font-size: 17px;
  font-weight: 600;
  color: #3f6046;
}

.chart-caption {
  display: block;
  font-size: 11px;
  color: #98a58c;
  margin-top: 4px;
}

.trend-card {
  padding: 21px 17px 15px;
  margin-bottom: 15px;
}

.metric-switch {
  display: flex;
  background: #eef2e7;
  border-radius: 8px;
  padding: 3px;
}

.metric-switch button {
  background: transparent;
  padding: 4px 9px;
  color: #97a48c;
  border-radius: 6px;
  font-size: 10px;
}

.metric-switch .active {
  background: #fff;
  color: #4f7652;
}

.trend-heading {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin: 17px 8px 0;
}

.trend-heading > text:first-child {
  color: #3c644a;
  font-size: 32px;
  font-weight: 550;
  line-height: 1.2;
}

.trend-heading > text:nth-child(2) {
  color: #9caa91;
  font-size: 10px;
}

.period-change {
  font-size: 10px;
  color: #8a9a78;
  margin-left: auto;
}

.chart-card {
  margin-bottom: 15px;
  padding: 21px;
}

.type-ranks {
  margin-top: 23px;
}

.type-rank {
  display: flex;
  gap: 11px;
  align-items: center;
  margin: 15px 0;
}

.type-label {
  width: 64px;
  font-size: 12px;
  flex-shrink: 0;
  color: #829276;
}

.rank-track {
  flex: 1;
  height: 8px;
  background: #f0f3eb;
  border-radius: 5px;
  overflow: hidden;
}

.rank-fill {
  height: 100%;
  border-radius: 5px;
  transition: width 0.4s;
}

.rank-value {
  width: 24px;
  text-align: right;
  font-size: 12px;
  font-weight: 550;
  color: #64835d;
}

.chart-footnote {
  display: block;
  font-size: 9px;
  color: #adb6a1;
  margin-top: 18px;
  padding-top: 13px;
  border-top: 1px solid #f0f3e9;
}

.review-layout {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 17px;
}

.review-legend {
  flex: 1;
  min-width: 0;
}

.review-legend > view {
  margin: 13px 0;
}

.legend-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #9ba88e;
  white-space: nowrap;
}

.legend-dot {
  width: 5px;
  height: 5px;
  border-radius: 2px;
}

.legend-value {
  display: block;
  font-size: 16px;
  color: #607e57;
  font-weight: 550;
  margin-left: 10px;
  line-height: 1.4;
}

.legend-value > text {
  font-size: 9px;
  font-weight: 400;
  color: #a1ad94;
}

.person-rank {
  display: flex;
  gap: 13px;
  margin-top: 22px;
  align-items: center;
}

.person-number {
  font-size: 11px;
  color: #b1bba6;
}

.person-info {
  flex: 1;
  min-width: 0;
}

.person-name {
  color: #67805a;
  font-size: 12px;
  max-width: 80px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.person-count {
  color: #68825b;
  font-size: 11px;
  white-space: nowrap;
}

.person-count > text {
  color: #a3ad97;
  font-size: 9px;
}

.person-track {
  height: 4px;
  background: #edf2e6;
  margin-top: 10px;
  border-radius: 3px;
  overflow: hidden;
}

.person-track > view {
  height: 100%;
  background: linear-gradient(90deg, #75976a, #afc39b);
  border-radius: 3px;
  transition: width 0.4s;
}

.no-data-copy {
  display: block;
  font-size: 11px;
  color: #a2af94;
  text-align: center;
  padding: 10px 0;
}

.reporter-chip {
  padding: 2px 7px;
  border-radius: 7px;
  background: #eef3e7;
  font-size: 10px;
  color: #8b9e7b;
}

.statistics-note {
  font-size: 10px;
  color: #a6b19c;
  line-height: 1.9;
  margin: 22px 5px 6px;
}

.statistics-note text {
  display: block;
}

.personal-entry {
  text-align: center;
  margin: 8px auto 18px;
  font-size: 11px;
}

@media (max-width: 360px) {
  .chart-card {
    padding: 16px;
  }

  .review-layout {
    gap: 0;
  }

  .type-label {
    width: 58px;
  }

  .manager-actions button {
    font-size: 12px;
  }
}
</style>
