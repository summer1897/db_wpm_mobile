<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import FieldIcon from '../../components/FieldIcon.vue';
import PageHead from '../../components/PageHead.vue';
import { formatTime, relativeTime, type Entry } from '../../modules/work/domain';
import {
  deleteEntry,
  handleError,
  myEntries,
  pauseUpload,
  pendingEntries,
  reload,
  requireUser,
  retryEntry,
  state,
  stepName,
  submittedEntries,
  synchronize,
  uploadAll,
} from '../../modules/work/store';

const tab = ref<'pending' | 'done'>('pending');
const busy = ref(false);
const message = ref('');

const pending = computed(() =>
  pendingEntries().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
);
const submitted = computed(() =>
  submittedEntries().sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || '')),
);
const failed = computed(() => pending.value.filter((row) => row.status === 'failed').length);
const photos = computed(() => pending.value.reduce((sum, row) => sum + row.attachments.length, 0));
const all = computed(() => myEntries());
const percent = computed(() => {
  if (state.batch.running || state.batch.total) return state.batch.percent;
  return pending.value.length ? 0 : 100;
});

onShow(() => {
  if (!requireUser()) return;
  void reload()
    .then(() => synchronize(false))
    .catch(handleError);
});

async function refresh() {
  try {
    await synchronize(true);
  } catch (error) {
    handleError(error);
  } finally {
    uni.stopPullDownRefresh();
  }
}
onPullDownRefresh(refresh);

async function startAll() {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await uploadAll();
  } catch (error: any) {
    message.value = error.message || '批量上传未开始';
  } finally {
    busy.value = false;
  }
}

async function retryOne(row: Entry) {
  try {
    await retryEntry(row);
  } catch (error) {
    handleError(error);
  }
}

function removeOne(row: Entry) {
  uni.showModal({
    title: '删除本机记录',
    content: '将删除这条尚未上传的记录及本机照片，是否继续？',
    confirmText: '确认删除',
    confirmColor: '#a96a52',
    success: async (result) => {
      if (!result.confirm) return;
      try {
        await deleteEntry(row);
      } catch (error) {
        handleError(error);
      }
    },
  });
}

const openEntry = (id: string) => uni.navigateTo({ url: '/pages/entry/index?id=' + id });
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="上传中心" subtitle="离线保存 · 联网批量上传" />

    <view class="batch-card">
      <view class="between">
        <text class="batch-title">{{
          state.batch.running ? '正在批量上传' : pending.length ? '等待上传' : '全部已上传'
        }}</text>
        <text class="batch-percent">{{ percent }}%</text>
      </view>
      <view class="progress-track batch-bar">
        <view class="progress-fill" :style="{ width: percent + '%' }" />
      </view>
      <view class="batch-facts">
        <view><text class="fact-number">{{ pending.length }}</text><text class="fact-label">待上传</text></view>
        <view><text class="fact-number">{{ submitted.length }}</text><text class="fact-label">已上传</text></view>
        <view><text class="fact-number" :class="{ warn: failed }">{{ failed }}</text><text class="fact-label">需重试</text></view>
        <view><text class="fact-number">{{ photos }}</text><text class="fact-label">待传附件</text></view>
      </view>
      <text v-if="state.batch.running" class="batch-copy">
        正在传第 {{ Math.min(state.batch.done + state.batch.failed + 1, state.batch.total) }} 条：
        {{ state.batch.currentLabel }}（{{ state.batch.currentPercent }}%）
      </text>
      <text v-else-if="state.batch.finishedAt" class="batch-copy">
        {{ state.batch.message }} · 完成于 {{ relativeTime(new Date(state.batch.finishedAt).toISOString()) }}
      </text>
      <text v-else class="batch-copy"
        >本机共 {{ all.length }} 条记录，其中 {{ pending.length }} 条尚未上传。联网后点击下方按钮一次性上传。</text
      >
      <view class="button-row batch-actions">
        <button v-if="state.batch.running" class="secondary" @click="pauseUpload">暂停上传</button>
        <button
          v-else
          class="primary"
          :loading="busy"
          :disabled="busy || !pending.length || !state.online || !state.authenticated"
          @click="startAll"
        >
          {{ !state.online ? '离线中，联网后上传' : !state.authenticated ? '登录后可上传' : pending.length ? `一键上传 ${pending.length} 条` : '暂无待上传' }}
        </button>
      </view>
    </view>

    <view v-if="message" class="banner error">{{ message }}</view>
    <view v-if="state.error" class="banner error">{{ state.error }}</view>

    <view class="segmented">
      <button class="segment" :class="{ active: tab === 'pending' }" @click="tab = 'pending'">
        待上传 {{ pending.length }}
      </button>
      <button class="segment" :class="{ active: tab === 'done' }" @click="tab = 'done'">
        已上传 {{ submitted.length }}
      </button>
    </view>

    <template v-if="tab === 'pending'">
      <view v-if="!pending.length" class="card empty">
        <FieldIcon name="refresh" :size="30" />
        <text class="empty-title">没有待上传的记录</text>
        <text class="empty-copy">新填报的记录会先保存在本机，这里可以随时批量上传</text>
      </view>
      <view v-for="row in pending" :key="row.id" class="card task-card">
        <view class="between">
          <view class="row">
            <text class="task-code">{{ row.unitCode }}</text>
            <text class="task-title">{{ row.title || stepName(row) || '未命名记录' }}</text>
          </view>
          <text
            class="status"
            :class="row.status"
          >{{ row.status === 'uploading' ? '上传中' : row.status === 'failed' ? '需重试' : row.status === 'queued' ? '排队中' : '草稿' }}</text>
        </view>
        <text class="task-meta">
          {{ row.workDate }} · {{ row.attachments.length }} 个附件<template v-if="row.stepCode"> · {{ stepName(row) }}</template>
        </text>
        <view v-if="row.status === 'uploading'" class="progress-track task-bar">
          <view class="progress-fill" :style="{ width: (state.progress[row.id] || 0) + '%' }" />
        </view>
        <text v-if="row.error" class="task-error">{{ row.error }}</text>
        <view class="task-actions">
          <button class="plain-button" @click="openEntry(row.id)">查看</button>
          <button
            v-if="row.status === 'failed'"
            class="plain-button accent"
            :disabled="!state.online"
            @click="retryOne(row)"
          >
            重新上传
          </button>
          <button v-if="row.status !== 'uploading'" class="plain-button danger" @click="removeOne(row)">
            删除
          </button>
        </view>
      </view>
    </template>

    <template v-else>
      <view v-if="!submitted.length" class="card empty">
        <FieldIcon name="records" :size="30" />
        <text class="empty-title">还没有上传成功的记录</text>
        <text class="empty-copy">上传成功后这里会显示服务端编号与审核状态</text>
      </view>
      <view v-for="row in submitted" :key="row.id" class="card task-card" @click="openEntry(row.id)">
        <view class="between">
          <view class="row">
            <text class="task-code">{{ row.unitCode }}</text>
            <text class="task-title">{{ row.title || '未命名记录' }}</text>
          </view>
          <text class="status" :class="row.reviewStatusCode === 'approved' ? 'submitted' : row.reviewStatusCode === 'rejected' ? 'failed' : 'queued'">
            {{ row.reviewStatus || '待审核' }}
          </text>
        </view>
        <text class="task-meta">{{ row.code || '编号同步中' }} · {{ row.attachments.length }} 个附件</text>
        <text v-if="row.reviewRemark" class="task-error">{{ row.reviewRemark }}</text>
        <view class="record-footer">
          <text>提交 {{ formatTime(row.submittedAt) }}</text>
          <text>{{ row.workDate }}</text>
        </view>
      </view>
    </template>

    <view class="bottom-note">下拉可同步审核状态与最新记录</view>
  </view>
</template>
<style scoped>
.batch-card {
  background: #dfe8d4;
  border-radius: 22px;
  padding: 20px;
  margin-bottom: 16px;
}
.batch-title {
  font-size: 17px;
  font-weight: 650;
  color: #2f5540;
}
.batch-percent {
  font-size: 22px;
  font-weight: 700;
  color: #35603f;
  font-variant-numeric: tabular-nums;
}
.batch-bar {
  margin-top: 12px;
  height: 6px;
}
.batch-facts {
  display: flex;
  margin-top: 17px;
  padding-top: 14px;
  border-top: 1px solid rgba(90, 120, 80, 0.16);
}
.batch-facts > view {
  flex: 1;
  text-align: center;
}
.fact-number {
  display: block;
  font-size: 18px;
  font-weight: 650;
  color: #355940;
  font-variant-numeric: tabular-nums;
}
.fact-number.warn {
  color: #a9705a;
}
.fact-label {
  font-size: 10px;
  color: #82906f;
}
.batch-copy {
  display: block;
  font-size: 12px;
  color: #7b8f6f;
  margin-top: 14px;
  line-height: 1.8;
}
.batch-actions {
  margin-top: 15px;
}
.batch-actions button {
  min-height: 46px;
  font-size: 15px;
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
.task-card {
  margin-bottom: 12px;
  padding: 16px;
}
.task-code {
  font-size: 15px;
  font-weight: 700;
  color: #33573f;
}
.task-title {
  font-size: 14px;
  color: #4f6a55;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 46vw;
}
.task-meta {
  display: block;
  font-size: 12px;
  color: #96a191;
  margin-top: 9px;
}
.task-bar {
  margin-top: 11px;
}
.task-error {
  display: block;
  font-size: 12px;
  color: #ad7257;
  margin-top: 10px;
  line-height: 1.7;
}
.task-actions {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f0f3ea;
}
.task-actions .plain-button {
  font-size: 12px;
  color: #4f7259;
}
.task-actions .accent {
  color: #a07b3f;
  font-weight: 600;
}
.task-actions .danger {
  color: #ad6352;
  margin-left: auto;
}
</style>
