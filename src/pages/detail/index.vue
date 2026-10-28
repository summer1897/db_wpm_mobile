<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import PhotoTile from '../../components/PhotoTile.vue';
import { canEdit, formatTime, statusNames, typeName } from '../../modules/work/domain';
import {
  deleteWork,
  findWork,
  handleError,
  reload,
  requireUser,
  retry,
  state,
  requireManager,
  refreshLedger,
} from '../../modules/work/store';
const management = ref(false),
  owner = ref('');
const id = ref(''),
  busy = ref(false),
  message = ref('');
const row = computed(() =>
  management.value
    ? state.user?.role === 'admin'
      ? state.ledger?.reports.find(
          (record) => record.id === id.value && record.owner === owner.value,
        )
      : undefined
    : findWork(id.value),
);
onLoad((options) => {
  management.value = options?.ledger === '1';
  owner.value = options?.owner || '';
  if (management.value ? requireManager() : requireUser()) id.value = options?.id || '';
});
onShow(() => {
  if (management.value) {
    if (requireManager()) void refreshLedger();
  } else void reload().catch(handleError);
});
function edit() {
  uni.redirectTo({ url: '/pages/report/index?id=' + id.value });
}
async function upload() {
  if (!row.value) return;
  busy.value = true;
  message.value = '';
  try {
    await retry(row.value);
    if (!state.authenticated) uni.navigateTo({ url: '/pages/login/index' });
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
        await deleteWork(row.value);
        uni.navigateBack({
          fail: () => uni.switchTab({ url: '/pages/records/index' }),
        });
      } catch (error: any) {
        message.value = error.message;
      }
    },
  });
}
</script>
<template>
  <view class="screen fade-in"
    ><PageHead title="记录详情" subtitle="施工记录" back />
    <view v-if="message" class="banner error">{{ message }}</view>
    <view v-if="!row" class="card empty"
      ><text class="empty-title">记录不存在或不属于当前账号</text></view
    >
    <template v-else>
      <view v-if="management" class="banner">项目台账只读查看</view>
      <view class="card detail-intro"
        ><view class="between"
          ><text class="record-type">{{ typeName(row.type) }}</text
          ><text class="status" :class="row.status">{{ statusNames[row.status] }}</text></view
        ><text class="detail-location">{{ row.location || '施工地点待填写' }}</text
        ><view class="row caption"
          ><FieldIcon name="calendar" :size="16" /><text>施工日期 {{ row.date }}</text></view
        ><view v-if="row.status === 'submitted'" class="review-line"
          ><view class="status-dot" /><text>{{
            row.reviewStatus === '已审核'
              ? '审核通过'
              : row.reviewStatus === '退回修改'
                ? '审核不通过'
                : '待审核'
          }}</text
          ><text class="caption">{{ row.photos.length }} 张照片已归档</text></view
        ></view
      >
      <view v-if="row.error" class="banner error detail-error">{{ row.error }}</view>
      <view v-if="row.status === 'uploading'" class="card upload-progress"
        ><view class="between"
          ><text>正在上传</text><text>{{ state.progress[row.id] || 0 }}%</text></view
        ><view class="progress-track"
          ><view
            class="progress-fill"
            :style="{ width: (state.progress[row.id] || 0) + '%' }" /></view
      ></view>
      <view class="section-head"><text class="section-title">施工说明</text></view
      ><view class="card"
        ><text class="detail-content">{{ row.content || '施工说明待填写' }}</text></view
      >
      <view class="section-head between"
        ><text class="section-title">现场照片</text
        ><text class="caption">{{ row.photos.length }} 张 · 点击查看</text></view
      ><view class="card"
        ><view v-if="row.photos.length" class="photo-grid"
          ><PhotoTile
            v-for="photo in row.photos"
            :key="photo.id"
            :photo="photo"
            :management="management" /></view
        ><text v-else class="caption">尚未添加施工照片</text></view
      >
      <view class="record-times"
        ><view class="between"
          ><text>创建时间</text><text>{{ formatTime(row.createdAt) }}</text></view
        ><view class="between"
          ><text>{{ row.status === 'submitted' ? '提交时间' : '更新时间' }}</text
          ><text>{{ formatTime(row.submittedAt || row.updatedAt) }}</text></view
        ><text v-if="row.serverId" class="receipt-id"
          >归档编号 {{ row.serverId.slice(0, 8).toUpperCase() }}</text
        ></view
      >
      <view
        v-if="!management && row.status !== 'submitted' && row.status !== 'uploading'"
        class="sticky-actions"
        ><view class="button-row"
          ><button v-if="canEdit(row)" class="secondary" @click="edit">继续编辑</button
          ><button
            v-if="row.status !== 'draft'"
            class="primary"
            :loading="busy"
            :disabled="busy"
            @click="upload"
          >
            {{ state.authenticated ? '继续上传' : '登录并上传' }}
          </button></view
        ><button v-if="canEdit(row)" class="plain-button remove-draft" @click="remove">
          删除本机记录
        </button></view
      >
    </template>
  </view>
</template>
<style scoped>
.detail-location {
  display: block;
  font-size: 27px;
  font-weight: 600;
  margin: 20px 0 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.review-line {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 17px;
  margin-top: 20px;
  border-top: 1px solid #edf1e8;
  font-size: 13px;
  color: #6b8864;
}
.review-line .caption {
  margin-left: auto;
  font-size: 11px;
}
.detail-content {
  white-space: pre-wrap;
  font-size: 16px;
  line-height: 1.95;
  color: #57704f;
  overflow-wrap: anywhere;
}
.detail-error {
  margin-top: 15px;
}
.record-times {
  font-size: 12px;
  color: #9aa48f;
  margin: 26px 4px;
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
.upload-progress {
  margin-top: 15px;
  font-size: 14px;
}
</style>
