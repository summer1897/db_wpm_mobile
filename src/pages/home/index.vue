<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import FieldIcon from '../../components/FieldIcon.vue';
import PageHead from '../../components/PageHead.vue';
import { formatTime, localDate, relativeTime } from '../../modules/work/domain';
import {
  handleError,
  myEntries,
  pauseUpload,
  reload,
  requireUser,
  state,
  submittedEntries,
  switchProject,
  synchronize,
  uploadAll,
  uploadStats,
} from '../../modules/work/store';

const units = computed(() => state.local?.units || []);
const stats = computed(() => uploadStats());
const progress = computed(() =>
  units.value.length
    ? Math.round(units.value.reduce((sum, unit) => sum + (unit.progress || 0), 0) / units.value.length)
    : 0,
);
const counts = computed(() => {
  const map: Record<string, number> = { planning: 0, building: 0, done: 0, paused: 0, canceled: 0 };
  for (const unit of units.value) map[unit.status] = (map[unit.status] || 0) + 1;
  return map;
});
const recent = computed(() => myEntries().slice(0, 3));
const reviewPending = computed(
  () => submittedEntries().filter((row) => row.reviewStatusCode === 'pending').length,
);

onShow(() => {
  if (!requireUser()) return;
  void reload()
    .then(() => synchronize(false))
    .catch(handleError);
});

const goUnits = () => uni.switchTab({ url: '/pages/units/index' });
const goUploads = () => uni.switchTab({ url: '/pages/uploads/index' });
const goLedger = () => uni.navigateTo({ url: '/pages/ledger/index' });
const goSettings = () => uni.navigateTo({ url: '/pages/settings/index' });
const openEntry = (id: string) => uni.navigateTo({ url: '/pages/entry/index?id=' + id });

const roleName = computed(() =>
  state.project?.role === 'owner'
    ? '负责人'
    : state.project?.role === 'manager'
      ? '管理员'
      : state.project?.role === 'viewer'
        ? '只读'
        : state.project
          ? '记录员'
          : '未分配',
);

/** 多项目时切换：项目由后台分配，现场只做选择 */
function chooseProject() {
  if (state.projects.length < 2) return;
  uni.showActionSheet({
    itemList: state.projects.map((item) => `${item.code} ${item.name}`),
    success: async (result) => {
      const target = state.projects[result.tapIndex];
      if (!target) return;
      try {
        await switchProject(target.id);
      } catch (error) {
        handleError(error);
      }
    },
  });
}

async function uploadNow() {
  try {
    await uploadAll();
  } catch (error) {
    handleError(error);
  }
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead
      :title="state.project?.name || '现场工作台'"
      :subtitle="localDate().replace(/-/g, ' / ')"
    >
      <view class="status"
        ><view class="status-dot" :class="{ offline: !state.online || !state.authenticated }" />
        <text>{{ !state.online ? '离线' : state.authenticated ? '在线' : '本机模式' }}</text></view
      >
    </PageHead>

    <view v-if="state.notice" class="banner">{{ state.notice }}</view>
    <view v-if="state.error" class="banner error">{{ state.error }}</view>

    <view class="project-card" @click="chooseProject">
      <view class="between">
        <view>
          <text class="project-code">{{ state.project?.code || '未加入项目' }}</text>
          <text class="project-name">{{ state.project?.name || '请联系管理员分配项目' }}</text>
        </view>
        <view class="project-role">{{ roleName }}</view>
      </view>
      <view v-if="state.projects.length > 1" class="project-switch">
        <text class="caption">我参与 {{ state.projects.length }} 个项目，点此切换</text>
        <FieldIcon name="refresh" :size="14" />
      </view>
      <view v-if="!state.project" class="banner empty-project">
        需要管理员在后台「风电施工 → 项目管理」为你创建项目并加为成员后，才能新增风机与填报记录。
      </view>
      <template v-else>
        <view class="project-progress">
          <view class="between">
            <text class="caption">整体进度</text>
            <text class="progress-value">{{ progress }}%</text>
          </view>
          <view class="progress-track"><view class="progress-fill" :style="{ width: progress + '%' }" /></view>
        </view>
        <view class="unit-stats">
          <view><text class="unit-number">{{ units.length }}</text><text class="unit-label">事项总数</text></view>
          <view><text class="unit-number">{{ counts.building }}</text><text class="unit-label">施工中</text></view>
          <view><text class="unit-number">{{ counts.done }}</text><text class="unit-label">已完成</text></view>
          <view><text class="unit-number warn">{{ reviewPending }}</text><text class="unit-label">待审核</text></view>
        </view>
      </template>
    </view>

    <view v-if="stats.pending" class="upload-card">
      <view class="between">
        <view class="row">
          <FieldIcon name="refresh" active :size="20" />
          <text class="upload-title">{{ stats.pending }} 条记录待上传</text>
        </view>
        <text class="caption">{{ stats.photos }} 个附件</text>
      </view>
      <view v-if="state.batch.running" class="progress-track upload-bar">
        <view class="progress-fill" :style="{ width: state.batch.percent + '%' }" />
      </view>
      <text class="upload-copy">{{
        state.batch.running
          ? `正在上传（${state.batch.done + state.batch.failed}/${state.batch.total}）：${state.batch.currentLabel}`
          : stats.failed
            ? `${stats.failed} 条上次未传成功，联网后可继续`
            : '记录已保存在本机，联网后一键批量上传'
      }}</text>
      <view class="button-row upload-actions">
        <button v-if="state.batch.running" class="secondary" @click="pauseUpload">暂停上传</button>
        <button v-else class="primary" :disabled="!state.online || !state.authenticated" @click="uploadNow">
          {{ state.online && state.authenticated ? '立即批量上传' : '联网登录后上传' }}
        </button>
        <button class="secondary" @click="goUploads">上传中心</button>
      </view>
    </view>

    <view v-else-if="stats.drafts" class="banner">
      有 {{ stats.drafts }} 条草稿尚未提交，确认内容后即可加入上传队列。
    </view>

    <view class="section-head between">
      <text class="section-title">现场作业</text>
      <text class="caption">按事项填报</text>
    </view>
    <view class="quick-grid">
      <view class="quick-card primary-card" @click="goUnits">
        <FieldIcon name="turbine" active :size="26" />
        <view>
          <text class="quick-title">选择风机 / 事项</text>
          <text class="quick-copy">按机位记录施工进展</text>
        </view>
      </view>
      <view class="quick-card" @click="goUploads">
        <FieldIcon name="folder" :size="24" />
        <view>
          <text class="quick-title">我的记录</text>
          <text class="quick-copy">上传进度与历史</text>
        </view>
      </view>
      <view v-if="state.user?.role === 'admin'" class="quick-card" @click="goLedger">
        <FieldIcon name="chart" :size="24" />
        <view>
          <text class="quick-title">工作台账</text>
          <text class="quick-copy">项目汇总与审核</text>
        </view>
      </view>
      <view class="quick-card" @click="goSettings">
        <FieldIcon name="settings" :size="24" />
        <view>
          <text class="quick-title">项目服务</text>
          <text class="quick-copy">服务器与账号</text>
        </view>
      </view>
    </view>

    <view class="section-head between">
      <text class="section-title">最近记录</text>
      <button class="plain-button" @click="goUploads">查看全部 →</button>
    </view>
    <view v-if="!recent.length" class="card empty">
      <FieldIcon name="records" :size="32" />
      <text class="empty-title">从第一台风机开始</text>
      <text class="empty-copy">先到「事项」里选择机位，再记录吊装、运输、组装等施工内容</text>
      <button class="secondary" @click="goUnits">去选择风机</button>
    </view>
    <view v-for="row in recent" :key="row.id" class="card record-card" @click="openEntry(row.id)">
      <view class="between">
        <text class="record-type">{{ row.unitCode }} · {{ row.title || '未命名记录' }}</text>
        <text class="status" :class="row.status">{{ row.status === 'submitted' ? row.reviewStatus : row.status === 'failed' ? '需重试' : row.status === 'uploading' ? '上传中' : row.status === 'queued' ? '待上传' : '草稿' }}</text>
      </view>
      <text class="record-content">{{ row.content || '施工说明待填写' }}</text>
      <view class="record-footer">
        <text>{{ row.status === 'submitted' ? formatTime(row.submittedAt) : relativeTime(row.updatedAt) }}</text>
        <text>{{ row.attachments.length }} 个附件</text>
      </view>
    </view>
    <view v-if="state.lastSync" class="bottom-note">上次同步 {{ relativeTime(state.lastSync) }}</view>
  </view>
</template>
<style scoped>
.project-card {
  background: #dfe8d4;
  border-radius: 22px;
  padding: 20px;
  margin-bottom: 16px;
}
.project-code {
  display: block;
  font-size: 11px;
  letter-spacing: 1.4px;
  color: #7b8f6f;
}
.project-name {
  display: block;
  font-size: 21px;
  font-weight: 650;
  color: #294f37;
  margin-top: 6px;
  letter-spacing: -0.4px;
}
.project-role {
  background: #f6faf0;
  color: #4d6d45;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 8px;
}
.project-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: #5c7a52;
}
.project-card .empty-project {
  margin-top: 14px;
  margin-bottom: 0;
  background: #f6faf0;
  color: #6d8264;
}
.project-progress {
  margin-top: 18px;
}
.progress-value {
  font-size: 13px;
  color: #4d6d45;
  font-weight: 600;
}
.unit-stats {
  display: flex;
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid rgba(90, 120, 80, 0.16);
}
.unit-stats > view {
  flex: 1;
  text-align: center;
}
.unit-number {
  display: block;
  font-size: 20px;
  font-weight: 650;
  color: #355940;
  font-variant-numeric: tabular-nums;
}
.unit-number.warn {
  color: #a58f63;
}
.unit-label {
  font-size: 10px;
  color: #82906f;
}
.upload-card {
  background: #fff;
  border: 1px solid #eadfc8;
  border-radius: 18px;
  padding: 17px;
  margin-bottom: 16px;
}
.upload-title {
  font-size: 15px;
  font-weight: 600;
  color: #7c6640;
}
.upload-bar {
  margin-top: 13px;
}
.upload-copy {
  display: block;
  font-size: 12px;
  color: #9a9280;
  margin-top: 11px;
  line-height: 1.7;
}
.upload-actions {
  margin-top: 14px;
}
.upload-actions button {
  min-height: 44px;
  font-size: 14px;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}
.quick-card {
  background: #fcfdf9;
  border: 1px solid #e4eadd;
  border-radius: 16px;
  padding: 15px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.primary-card {
  background: #eaf0e2;
  border-color: #dbe6d1;
}
.quick-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #47653f;
}
.quick-copy {
  display: block;
  font-size: 11px;
  color: #93a08a;
  margin-top: 3px;
}
</style>
