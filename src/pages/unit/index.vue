<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import FieldIcon from '../../components/FieldIcon.vue';
import PageHead from '../../components/PageHead.vue';
import {
  formatTime,
  relativeTime,
  stepStatusName,
  unitStatusNames,
  type Entry,
  type UnitStep,
} from '../../modules/work/domain';
import {
  entriesOf,
  handleError,
  loadUnit,
  newEntry,
  reload,
  requireUser,
  state,
  stepName,
  toast,
  unitById,
  updateStep,
} from '../../modules/work/store';

const id = ref('');
const busy = ref(false);
const message = ref('');

const unit = computed(() => unitById(id.value));
const steps = computed<UnitStep[]>(() => unit.value?.steps || []);
const entries = computed<Entry[]>(() =>
  entriesOf(id.value).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
);
const doneCount = computed(() => steps.value.filter((step) => step.status === 'done').length);
const progress = computed(() =>
  steps.value.length ? Math.round((doneCount.value / steps.value.length) * 100) : unit.value?.progress || 0,
);

onLoad((options) => {
  if (requireUser()) id.value = options?.id || '';
});

onShow(() => {
  if (!requireUser() || !id.value) return;
  void reload()
    .then(() => {
      if (state.online && state.authenticated) return loadUnit(id.value);
    })
    .catch(handleError);
});

async function refresh() {
  try {
    if (!state.online || !state.authenticated) return;
    await loadUnit(id.value);
  } catch (error) {
    handleError(error);
  } finally {
    uni.stopPullDownRefresh();
  }
}
onPullDownRefresh(refresh);

function record(step?: UnitStep) {
  void newEntry(id.value, step?.stepCode || '').catch((error) => {
    message.value = error.message;
  });
}

function pickStep(step: UnitStep) {
  const actions = ['记录这道工序', step.status === 'done' ? '取消完成' : '标记已完成', '标记进行中', '跳过该工序'];
  uni.showActionSheet({
    itemList: actions,
    success: (result) => {
      const index = result.tapIndex;
      if (index === 0) return record(step);
      const status = index === 1 ? (step.status === 'done' ? 'pending' : 'done') : index === 2 ? 'doing' : 'skipped';
      void applyStep(step, status);
    },
  });
}

async function applyStep(step: UnitStep, status: string) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await updateStep(id.value, step.stepCode, status);
    toast(`${step.stepName} 已更新为「${stepStatusName(status)}」`);
  } catch (error: any) {
    message.value = error.message || '工序更新未完成';
  } finally {
    busy.value = false;
  }
}

function openEntry(entryId: string) {
  uni.navigateTo({ url: '/pages/entry/index?id=' + entryId });
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead :title="unit?.code || '事项详情'" :subtitle="unit?.typeName || '事项 / 风机'" back>
      <text class="status" :class="unit?.status === 'done' ? 'submitted' : unit?.status === 'building' ? 'uploading' : ''">
        {{ unitStatusNames[unit?.status || 'planning'] }}
      </text>
    </PageHead>

    <view v-if="message" class="banner error">{{ message }}</view>
    <view v-if="!unit" class="card empty">
      <FieldIcon name="turbine" :size="34" />
      <text class="empty-title">本机还没有这台风机</text>
      <text class="empty-copy">联网登录后下拉刷新，或回到事项列表重新选择</text>
    </view>

    <template v-else>
      <view class="card unit-head">
        <text class="unit-name">{{ unit.name || unit.location || unit.code }}</text>
        <text v-if="unit.location" class="caption">{{ unit.location }}</text>
        <view class="progress-head">
          <text class="caption">工序进度 {{ doneCount }}/{{ steps.length || unit.totalSteps }}</text>
          <text class="progress-value">{{ progress }}%</text>
        </view>
        <view class="progress-track"><view class="progress-fill" :style="{ width: progress + '%' }" /></view>
        <view class="unit-facts">
          <view><text class="fact-number">{{ unit.entryCount }}</text><text class="fact-label">记录</text></view>
          <view><text class="fact-number">{{ unit.attachmentCount }}</text><text class="fact-label">附件</text></view>
          <view><text class="fact-number">{{ unit.doneSteps }}/{{ unit.totalSteps }}</text><text class="fact-label">工序</text></view>
        </view>
      </view>

      <view class="section-head between">
        <text class="section-title">标准工序</text>
        <text class="caption">点击工序可推进或直接填报</text>
      </view>
      <view v-if="!steps.length" class="card">
        <text class="caption">尚未同步工序清单，联网后下拉刷新</text>
      </view>
      <view v-else class="card step-list">
        <view
          v-for="step in steps"
          :key="step.stepCode"
          class="step-item"
          :class="{ done: step.status === 'done', doing: step.status === 'doing' }"
          @click="pickStep(step)"
        >
          <view class="step-dot" :class="step.status" />
          <view class="step-copy">
            <text class="step-name">{{ step.stepName }}</text>
            <text class="step-meta">{{ stepStatusName(step.status) }}<template v-if="step.doneAt"> · {{ formatTime(step.doneAt) }}</template></text>
          </view>
          <button class="step-action" @click.stop="record(step)">记录</button>
        </view>
      </view>

      <view class="section-head between">
        <text class="section-title">施工记录</text>
        <text class="caption">{{ entries.length }} 条</text>
      </view>
      <view v-if="!entries.length" class="card empty">
        <FieldIcon name="records" :size="30" />
        <text class="empty-title">还没有记录</text>
        <text class="empty-copy">拍照 + 备注即可留存这台风机的施工过程</text>
      </view>
      <view v-for="row in entries" :key="row.id" class="card record-card" @click="openEntry(row.id)">
        <view class="between">
          <text class="record-type">{{ row.title || stepName(row) || '未命名记录' }}</text>
          <text class="status" :class="row.status">{{ row.status === 'submitted' ? row.reviewStatus : row.status === 'failed' ? '需重试' : row.status === 'uploading' ? '上传中' : row.status === 'queued' ? '待上传' : '草稿' }}</text>
        </view>
        <text class="record-content">{{ row.content || '施工说明待填写' }}</text>
        <view v-if="row.status === 'uploading'" class="progress-track">
          <view class="progress-fill" :style="{ width: (state.progress[row.id] || 0) + '%' }" />
        </view>
        <view class="record-footer">
          <text>{{ row.status === 'submitted' ? formatTime(row.submittedAt) : relativeTime(row.updatedAt) }}</text>
          <text>{{ row.attachments.length }} 个附件</text>
        </view>
      </view>

      <view class="sticky-actions">
        <button class="primary" @click="record()">＋ 记录这台风机的施工</button>
        <view class="submit-note">记录先保存在本机，联网后在「上传中心」批量上传</view>
      </view>
    </template>
  </view>
</template>
<style scoped>
.unit-head {
  padding: 20px;
}
.unit-name {
  display: block;
  font-size: 23px;
  font-weight: 650;
  color: #2f5540;
  margin-bottom: 6px;
  overflow-wrap: anywhere;
}
.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 9px;
}
.progress-value {
  font-size: 13px;
  font-weight: 600;
  color: #4d6d45;
}
.unit-facts {
  display: flex;
  margin-top: 17px;
  padding-top: 14px;
  border-top: 1px solid #eef1e8;
}
.unit-facts > view {
  flex: 1;
  text-align: center;
}
.fact-number {
  display: block;
  font-size: 17px;
  font-weight: 650;
  color: #3d6047;
}
.fact-label {
  font-size: 10px;
  color: #97a48f;
}
.step-list {
  padding: 6px 18px;
}
.step-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid #f0f3ea;
}
.step-item:last-child {
  border-bottom: 0;
}
.step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #dfe6d8;
  flex-shrink: 0;
}
.step-dot.done {
  background: #5b9a72;
}
.step-dot.doing {
  background: #c3a463;
}
.step-dot.skipped {
  background: #c9cfc4;
}
.step-copy {
  flex: 1;
  min-width: 0;
}
.step-name {
  display: block;
  font-size: 15px;
  color: #40604a;
  font-weight: 550;
}
.step-item.done .step-name {
  color: #7d9184;
}
.step-meta {
  display: block;
  font-size: 11px;
  color: #9aa694;
  margin-top: 3px;
}
.step-action {
  background: #eef3e8;
  color: #4f6f52;
  font-size: 12px;
  padding: 0 13px;
  height: 32px;
  line-height: 32px;
  border-radius: 9px;
}
.sticky-actions {
  margin-top: 26px;
}
.submit-note {
  text-align: center;
  margin-top: 11px;
  color: #94a18a;
  font-size: 10px;
}
</style>
