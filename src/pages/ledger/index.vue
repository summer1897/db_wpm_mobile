<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import { formatTime, unitStatusNames } from '../../modules/work/domain';
import { reviewEntry } from '../../modules/work/api';
import {
  handleError,
  refreshLedger,
  requireManager,
  state,
  toast,
} from '../../modules/work/store';

const tab = ref<'summary' | 'entries'>('summary');
const filter = ref('all');
const busy = ref(false);

const ledger = computed(() => state.ledger);
const summary = computed(() => ledger.value?.summary || {});
const units = computed(() => ledger.value?.units || []);
const entries = computed(() => {
  const list = ledger.value?.entries || [];
  if (filter.value === 'all') return list;
  return list.filter((row: any) => row.reviewStatusCode === filter.value);
});
const filters = [
  { id: 'all', text: '全部' },
  { id: 'pending', text: '待审核' },
  { id: 'approved', text: '已审核' },
  { id: 'rejected', text: '退回修改' },
];

onShow(() => {
  if (requireManager()) void refreshLedger().catch(handleError);
});

async function refresh() {
  try {
    await refreshLedger();
  } finally {
    uni.stopPullDownRefresh();
  }
}
onPullDownRefresh(refresh);

async function review(id: string, action: 'approve' | 'reject') {
  if (busy.value) return;
  busy.value = true;
  try {
    if (action === 'reject') {
      const remark = await new Promise<string>((resolve) => {
        uni.showModal({
          title: '退回修改',
          editable: true,
          placeholderText: '请填写退回原因',
          success: (result) => resolve(result.confirm ? (result.content || '').trim() : ''),
          fail: () => resolve(''),
        });
      });
      if (!remark) {
        toast('退回必须填写原因');
        return;
      }
      await reviewEntry(id, action, remark);
    } else {
      await reviewEntry(id, action, '资料齐全，同意。');
    }
    toast(action === 'approve' ? '已审核通过' : '已退回修改');
    await refreshLedger();
  } catch (error: any) {
    toast(error.message || '审核未完成');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="工作台账" :subtitle="ledger?.project?.name || '项目汇总'" back>
      <text class="caption">{{ ledger ? formatTime(ledger.generatedAt) : '' }}</text>
    </PageHead>

    <view v-if="state.ledgerError" class="banner error">{{ state.ledgerError }}</view>
    <view v-if="!ledger" class="card empty">
      <FieldIcon name="chart" :size="32" />
      <text class="empty-title">台账尚未获取</text>
      <text class="empty-copy">{{ state.online ? '下拉刷新获取最新汇总' : '当前离线，联网后可获取' }}</text>
    </view>

    <template v-else>
      <view class="summary-card">
        <view class="between">
          <text class="summary-title">整体进度</text>
          <text class="summary-percent">{{ summary.progress || 0 }}%</text>
        </view>
        <view class="progress-track summary-bar">
          <view class="progress-fill" :style="{ width: (summary.progress || 0) + '%' }" />
        </view>
        <view class="summary-grid">
          <view><text class="grid-number">{{ summary.totalUnits || 0 }}</text><text class="grid-label">事项</text></view>
          <view><text class="grid-number">{{ summary.unitDone || 0 }}</text><text class="grid-label">已完工</text></view>
          <view><text class="grid-number">{{ summary.totalEntries || 0 }}</text><text class="grid-label">记录</text></view>
          <view><text class="grid-number warn">{{ summary.entriesPending || 0 }}</text><text class="grid-label">待审核</text></view>
          <view><text class="grid-number">{{ summary.totalAttachments || 0 }}</text><text class="grid-label">附件</text></view>
        </view>
      </view>

      <view class="segmented">
        <button class="segment" :class="{ active: tab === 'summary' }" @click="tab = 'summary'">
          按事项
        </button>
        <button class="segment" :class="{ active: tab === 'entries' }" @click="tab = 'entries'">
          记录流水 {{ (ledger.entries || []).length }}
        </button>
      </view>

      <template v-if="tab === 'summary'">
        <view v-for="unit in units" :key="unit.id" class="card unit-row">
          <view class="between">
            <view class="row">
              <text class="unit-code">{{ unit.code }}</text>
              <text class="caption">{{ unit.typeName }}</text>
            </view>
            <text class="status" :class="unit.status === 'done' ? 'submitted' : unit.status === 'building' ? 'uploading' : ''">
              {{ unitStatusNames[unit.status] || unit.status }}
            </text>
          </view>
          <view class="between unit-meta">
            <text class="caption">工序 {{ unit.doneSteps }}/{{ unit.totalSteps }}</text>
            <text class="caption">{{ unit.entryCount }} 条记录 · {{ unit.attachmentCount }} 个附件</text>
          </view>
          <view class="progress-track">
            <view class="progress-fill" :style="{ width: (unit.progress || 0) + '%' }" />
          </view>
        </view>
      </template>

      <template v-else>
        <view class="filter-row">
          <button
            v-for="item in filters"
            :key="item.id"
            class="filter"
            :class="{ active: item.id === filter }"
            @click="filter = item.id"
          >
            {{ item.text }}
          </button>
        </view>
        <view v-if="!entries.length" class="card empty">
          <text class="empty-title">没有符合条件的记录</text>
        </view>
        <view v-for="row in entries" :key="row.id" class="card entry-row">
          <view class="between">
            <view class="row">
              <text class="unit-code">{{ row.unitCode }}</text>
              <text class="entry-title">{{ row.title }}</text>
            </view>
            <text class="status" :class="row.reviewStatusCode === 'approved' ? 'submitted' : row.reviewStatusCode === 'rejected' ? 'failed' : 'queued'">
              {{ row.reviewStatus }}
            </text>
          </view>
          <text class="entry-meta">
            {{ row.workDate }} · {{ row.recorderName }} · {{ row.attachments?.length || 0 }} 个附件
          </text>
          <text v-if="row.content" class="entry-content">{{ row.content }}</text>
          <text v-if="row.reviewRemark" class="entry-remark">审核意见：{{ row.reviewRemark }}</text>
          <view v-if="row.reviewStatusCode === 'pending'" class="review-actions">
            <button class="plain-button accent" :disabled="busy" @click="review(row.id, 'reject')">退回修改</button>
            <button class="plain-button" :disabled="busy" @click="review(row.id, 'approve')">审核通过</button>
          </view>
        </view>
      </template>

      <view class="bottom-note">每次拉取台账都会在服务端归档一份快照，历史口径可回溯</view>
    </template>
  </view>
</template>
<style scoped>
.summary-card {
  background: #dfe8d4;
  border-radius: 22px;
  padding: 20px;
  margin-bottom: 16px;
}
.summary-title {
  font-size: 16px;
  font-weight: 650;
  color: #2f5540;
}
.summary-percent {
  font-size: 22px;
  font-weight: 700;
  color: #35603f;
}
.summary-bar {
  margin-top: 11px;
  height: 6px;
}
.summary-grid {
  display: flex;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(90, 120, 80, 0.16);
}
.summary-grid > view {
  flex: 1;
  text-align: center;
}
.grid-number {
  display: block;
  font-size: 18px;
  font-weight: 650;
  color: #355940;
  font-variant-numeric: tabular-nums;
}
.grid-number.warn {
  color: #a58f63;
}
.grid-label {
  font-size: 10px;
  color: #82906f;
}
.segmented {
  display: flex;
  background: #e8eee6;
  border-radius: 13px;
  padding: 4px;
  margin-bottom: 15px;
}
.segment {
  flex: 1;
  background: transparent;
  color: #6f8274;
  font-size: 13px;
  height: 38px;
  line-height: 38px;
  border-radius: 10px;
}
.segment.active {
  background: #fff;
  color: #2f5540;
  font-weight: 600;
}
.unit-row {
  margin-bottom: 12px;
  padding: 16px;
}
.unit-code {
  font-size: 16px;
  font-weight: 700;
  color: #33573f;
}
.unit-meta {
  margin: 10px 0 8px;
}
.entry-row {
  margin-bottom: 12px;
  padding: 16px;
}
.entry-title {
  font-size: 14px;
  color: #4f6a55;
  margin-left: 8px;
  max-width: 42vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-meta {
  display: block;
  font-size: 12px;
  color: #96a191;
  margin-top: 9px;
}
.entry-content {
  display: block;
  font-size: 13px;
  color: #6d8069;
  margin-top: 9px;
  line-height: 1.75;
}
.entry-remark {
  display: block;
  font-size: 12px;
  color: #a06a4b;
  margin-top: 9px;
}
.review-actions {
  display: flex;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f0f3ea;
}
.review-actions .plain-button {
  font-size: 13px;
  color: #4f7259;
}
.review-actions .accent {
  color: #a9705a;
}
</style>
