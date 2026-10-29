<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import PhotoTile from '../../components/PhotoTile.vue';
import { canEdit, formatTime } from '../../modules/work/domain';
import {
  deleteEntry,
  findEntry,
  handleError,
  reload,
  requireUser,
  retryEntry,
  state,
  stepName,
} from '../../modules/work/store';

const id = ref('');
const busy = ref(false);
const message = ref('');

const row = computed(() => findEntry(id.value));

onLoad((options) => {
  if (requireUser()) id.value = options?.id || '';
});
onShow(() => {
  if (requireUser()) void reload().catch(handleError);
});

function edit() {
  uni.redirectTo({ url: '/pages/report/index?id=' + id.value });
}

async function upload() {
  if (!row.value) return;
  busy.value = true;
  message.value = '';
  try {
    await retryEntry(row.value);
  } catch (error: any) {
    message.value = error.message;
  } finally {
    busy.value = false;
  }
}

function remove() {
  if (!row.value) return;
  uni.showModal({
    title: '删除本机记录',
    content: '将删除这条尚未提交的记录及其本机照片，是否继续？',
    confirmText: '确认删除',
    confirmColor: '#a96a52',
    success: async (result) => {
      if (!result.confirm || !row.value) return;
      try {
        await deleteEntry(row.value);
        uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/uploads/index' }) });
      } catch (error: any) {
        message.value = error.message;
      }
    },
  });
}

function backToUnit() {
  if (!row.value) return;
  uni.navigateTo({ url: '/pages/unit/index?id=' + row.value.unitId });
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="记录详情" subtitle="施工记录" back />
    <view v-if="message" class="banner error">{{ message }}</view>
    <view v-if="!row" class="card empty">
      <text class="empty-title">记录不存在或不属于当前账号</text>
    </view>

    <template v-else>
      <view class="card intro">
        <view class="between">
          <view class="row">
            <text class="intro-code" @click="backToUnit">{{ row.unitCode }}</text>
            <text class="status" :class="row.status">{{
              row.status === 'submitted'
                ? row.reviewStatus
                : row.status === 'failed'
                  ? '需重试'
                  : row.status === 'uploading'
                    ? '上传中'
                    : row.status === 'queued'
                      ? '待上传'
                      : '草稿'
            }}</text>
          </view>
          <text class="caption">{{ row.code || '编号待生成' }}</text>
        </view>
        <text class="intro-title">{{ row.title || '未命名记录' }}</text>
        <view class="meta-list">
          <view class="meta-row"><text>所属事项</text><text>{{ row.unitName || row.unitCode }}</text></view>
          <view class="meta-row"><text>关联工序</text><text>{{ stepName(row) || '未关联' }}</text></view>
          <view class="meta-row"><text>施工内容</text><text>{{ state.dict?.entryTypes.find((item) => item.code === row?.typeCode)?.name || row.typeCode }}</text></view>
          <view class="meta-row"><text>施工日期</text><text>{{ row.workDate }}</text></view>
        </view>
      </view>

      <view v-if="row.status === 'uploading'" class="card">
        <view class="between"><text>正在上传</text><text>{{ state.progress[row.id] || 0 }}%</text></view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: (state.progress[row.id] || 0) + '%' }" />
        </view>
      </view>

      <view v-if="row.error" class="banner error">{{ row.error }}</view>

      <view v-if="row.status === 'submitted'" class="card review-card">
        <view class="row">
          <view class="status-dot" :class="{ offline: row.reviewStatusCode === 'pending' }" />
          <text class="review-title">{{ row.reviewStatus || '待审核' }}</text>
        </view>
        <text v-if="row.reviewRemark" class="review-remark">{{ row.reviewRemark }}</text>
        <text class="caption">审核意见由项目负责人填写，退回后可修改重新提交</text>
      </view>

      <view class="section-head"><text class="section-title">施工说明</text></view>
      <view class="card"><text class="content">{{ row.content || '施工说明待填写' }}</text></view>

      <view class="section-head between">
        <text class="section-title">现场照片</text>
        <text class="caption">{{ row.attachments.length }} 个 · 点击查看</text>
      </view>
      <view class="card">
        <view v-if="row.attachments.length" class="photo-grid">
          <PhotoTile v-for="photo in row.attachments" :key="photo.id" :photo="photo" />
        </view>
        <text v-else class="caption">尚未添加现场照片</text>
      </view>

      <view class="record-times">
        <view class="between"><text>创建时间</text><text>{{ formatTime(row.createdAt) }}</text></view>
        <view class="between">
          <text>{{ row.status === 'submitted' ? '提交时间' : '更新时间' }}</text>
          <text>{{ formatTime(row.submittedAt || row.updatedAt) }}</text>
        </view>
        <text v-if="row.serverId" class="receipt-id">服务端编号 {{ row.serverId.slice(0, 8).toUpperCase() }}</text>
      </view>

      <view v-if="row.status !== 'submitted' && row.status !== 'uploading'" class="sticky-actions">
        <view class="button-row">
          <button v-if="canEdit(row)" class="secondary" @click="edit">继续编辑</button>
          <button v-if="row.status !== 'draft'" class="primary" :loading="busy" :disabled="busy" @click="upload">
            {{ state.authenticated ? '重新上传' : '登录并上传' }}
          </button>
        </view>
        <button v-if="canEdit(row)" class="plain-button remove-draft" @click="remove">删除本机记录</button>
      </view>
    </template>
  </view>
</template>
<style scoped>
.intro {
  padding: 19px;
}
.intro-code {
  font-size: 15px;
  font-weight: 700;
  color: #33573f;
  text-decoration: underline dotted #b9c9b4;
}
.intro-title {
  display: block;
  font-size: 22px;
  font-weight: 650;
  color: #2f5540;
  margin: 13px 0 4px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.meta-list {
  margin-top: 16px;
  padding-top: 13px;
  border-top: 1px solid #eef1e8;
}
.meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: #7d8d78;
  padding: 5px 0;
}
.meta-row text:last-child {
  color: #4a6650;
}
.review-card {
  margin-top: 14px;
  background: #edf3ea;
  border-color: #dde8d7;
}
.review-title {
  font-size: 15px;
  font-weight: 600;
  color: #46664a;
}
.review-remark {
  display: block;
  font-size: 13px;
  color: #8a6a4c;
  margin: 10px 0 8px;
  line-height: 1.7;
}
.content {
  white-space: pre-wrap;
  font-size: 15px;
  line-height: 1.95;
  color: #57704f;
  overflow-wrap: anywhere;
}
.record-times {
  font-size: 12px;
  color: #9aa48f;
  margin: 24px 4px;
  line-height: 2.4;
}
.receipt-id {
  display: block;
  text-align: right;
  font-size: 10px;
}
.remove-draft {
  text-align: center;
  margin: 15px auto 0;
  color: #a59176;
  font-size: 12px;
}
</style>
