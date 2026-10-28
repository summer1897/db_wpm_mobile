<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import FieldIcon from '../../components/FieldIcon.vue';
import PageHead from '../../components/PageHead.vue';
import ManagementOverview from '../../components/ManagementOverview.vue';
import { constructionTypes, formatTime, localDate, statusNames } from '../../modules/work/domain';
import {
  handleError,
  mine,
  newWork,
  reload,
  requireUser,
  state,
  refreshLedger,
} from '../../modules/work/store';
const records = computed(mine),
  pending = computed(
    () =>
      records.value.filter((row) => ['queued', 'failed', 'uploading'].includes(row.status)).length,
  );
const submitted = computed(() => records.value.filter((row) => row.status === 'submitted').length);
const recent = computed(() => records.value.slice(0, 2));
onShow(() => {
  if (requireUser())
    void reload()
      .then(() => {
        if (state.user?.role === 'admin') return refreshLedger();
      })
      .catch(handleError);
});
function create(type: (typeof constructionTypes)[number]['id'] | '' = '') {
  void newWork(type).catch(handleError);
}
const allRecords = () => uni.switchTab({ url: '/pages/records/index' });
const detail = (id: string) => uni.navigateTo({ url: '/pages/detail/index?id=' + id });
</script>
<template>
  <view class="screen fade-in">
    <PageHead
      :title="state.user?.role === 'admin' ? '项目工作台' : '现场工作台'"
      :subtitle="localDate().replace(/-/g, ' / ')"
      ><view class="status"
        ><view
          class="status-dot"
          :class="{ offline: !state.online || !state.authenticated }"
        /><text>{{
          !state.online ? '离线' : state.authenticated ? '在线' : '本机模式'
        }}</text></view
      ></PageHead
    >
    <ManagementOverview v-if="state.user?.role === 'admin'" />
    <template v-else>
      <view class="hero"
        ><image src="/static/wind-scene.png" class="hero-scene" mode="aspectFit" /><view
          class="hero-copy"
          ><text class="hero-greeting">{{ state.user?.name }}，你好</text
          ><text class="hero-title">把现场的进展</text><text class="hero-title">妥善记录下来</text
          ><text class="hero-subtitle">{{
            state.connection?.mode === 'linked' ? state.connection.projectName : '风电施工现场管理'
          }}</text
          ><button class="hero-button" @click="create()">
            <text>新建施工记录</text><text>＋</text>
          </button></view
        ></view
      >
      <view class="summary"
        ><view @click="allRecords"
          ><text class="summary-number">{{ records.length }}</text
          ><text class="summary-label">全部记录</text></view
        ><view @click="allRecords"
          ><text class="summary-number">{{ submitted }}</text
          ><text class="summary-label">已提交</text></view
        ><view @click="allRecords"
          ><text class="summary-number pending-number">{{ pending }}</text
          ><text class="summary-label">待上传</text></view
        ></view
      >
      <view v-if="state.error" class="banner error">{{ state.error }}</view>
      <view v-if="!state.authenticated" class="trial-note"
        ><view class="status-dot offline" /><text
          >当前为本机模式，记录只保存在本机；联网登录后账号资料由后端校验</text
        ></view
      >
      <view class="section-head between"
        ><text class="section-title">按施工类型记录</text
        ><text class="caption">快速填报</text></view
      >
      <view class="type-grid"
        ><view
          v-for="(type, index) in constructionTypes"
          :key="type.id"
          class="type-card"
          :class="{ 'type-other': type.id === 'other' }"
          @click="create(type.id)"
          ><view class="type-icon"><FieldIcon :name="type.icon" active :size="25" /></view
          ><view
            ><text class="type-name">{{ type.short }}</text
            ><text v-if="type.id === 'other'" class="caption">补充事项与其他工作</text></view
          ><text class="type-index">{{ String(index + 1).padStart(2, '0') }}</text></view
        ></view
      >
      <view class="section-head between"
        ><text class="section-title">最近记录</text
        ><button class="plain-button" @click="allRecords">查看全部 →</button></view
      >
      <view v-if="!recent.length" class="card empty"
        ><FieldIcon name="records" :size="32" /><text class="empty-title">从第一条施工记录开始</text
        ><text class="empty-copy">现场照片、施工说明，在这里有序留存</text></view
      >
      <view v-for="row in recent" :key="row.id" class="card record-card" @click="detail(row.id)"
        ><view class="between"
          ><text class="record-type">{{
            constructionTypes.find((type) => type.id === row.type)?.name || '待完善记录'
          }}</text
          ><text class="status" :class="row.status">{{ statusNames[row.status] }}</text></view
        ><text class="record-location">{{ row.location || '施工地点待填写' }}</text
        ><text class="record-content">{{ row.content || '继续完善施工内容与现场照片' }}</text
        ><view class="record-footer"
          ><text>{{ formatTime(row.submittedAt || row.updatedAt) }}</text
          ><text>{{ row.photos.length }} 张照片</text></view
        ></view
      >
      <view class="bottom-note">施工有序推进，记录可靠留存</view>
    </template>
  </view>
</template>
<style scoped>
.hero {
  background: #dfe8d4;
  border-radius: 25px;
  padding: 27px 23px;
  position: relative;
  overflow: hidden;
  min-height: 246px;
}
.hero-scene {
  position: absolute;
  right: -52px;
  top: 15px;
  width: 260px;
  height: 215px;
  opacity: 0.9;
}
.hero-copy {
  position: relative;
}
.hero-greeting {
  display: block;
  font-size: 12px;
  color: #6e8660;
  margin-bottom: 10px;
}
.hero-title {
  font-size: 25px;
  font-weight: 650;
  line-height: 1.45;
  letter-spacing: -0.6px;
  color: #294f37;
  display: block;
}
.hero-subtitle {
  display: block;
  font-size: 11px;
  color: #7b8f6f;
  margin: 11px 0 21px;
  max-width: 70%;
}
.hero-button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 165px;
  background: #365f43;
  color: #f8fbee;
  border-radius: 12px;
  padding: 11px 15px;
  font-size: 14px;
}
.hero-button text:last-child {
  font-size: 22px;
  line-height: 1;
}
.summary {
  display: flex;
  margin: 22px 0 18px;
  padding: 8px 0;
}
.summary > view {
  flex: 1;
  text-align: center;
  border-right: 1px solid #dce4d6;
}
.summary > view:last-child {
  border: 0;
}
.summary-number {
  display: block;
  font-size: 29px;
  color: #355940;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}
.pending-number {
  color: #a58f63;
}
.summary-label {
  font-size: 11px;
  color: #92a087;
  margin-top: 6px;
  display: block;
}
.trial-note {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 11px;
  color: #9b956f;
}
.type-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}
.type-card {
  background: #fcfdf9;
  border: 1px solid #e4eadd;
  border-radius: 16px;
  padding: 16px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}
.type-icon {
  width: 36px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #eaf0e2;
  flex-shrink: 0;
}
.type-name {
  display: block;
  font-size: 14px;
  font-weight: 550;
  color: #4d6d45;
}
.type-index {
  position: absolute;
  top: 7px;
  right: 8px;
  font-size: 8px;
  color: #c5cdbb;
}
.type-other {
  grid-column: span 2;
  padding-top: 13px;
  padding-bottom: 13px;
}
.type-other .caption {
  font-size: 11px;
}
</style>
