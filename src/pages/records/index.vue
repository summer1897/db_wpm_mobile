<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import PhotoTile from '../../components/PhotoTile.vue';
import { formatTime, statusNames, typeName } from '../../modules/work/domain';
import {
  handleError,
  mine,
  newWork,
  reload,
  requireUser,
  state,
  synchronize,
} from '../../modules/work/store';
const filter = ref('all'),
  query = ref('');
const filters = [
  { id: 'all', text: '全部' },
  { id: 'draft', text: '草稿' },
  { id: 'pending', text: '待上传' },
  { id: 'submitted', text: '已提交' },
];
const records = computed(() =>
  mine().filter(
    (row) =>
      (filter.value === 'all' ||
        row.status === filter.value ||
        (filter.value === 'pending' && ['queued', 'failed', 'uploading'].includes(row.status))) &&
      (!query.value ||
        [typeName(row.type), row.location, row.content, row.date]
          .join(' ')
          .includes(query.value.trim())),
  ),
);
onShow(() => {
  if (requireUser()) void reload().catch(handleError);
});
async function refresh() {
  try {
    await synchronize(true);
    await reload();
  } catch (error) {
    handleError(error);
  } finally {
    uni.stopPullDownRefresh();
  }
}
onPullDownRefresh(refresh);
function create() {
  void newWork().catch(handleError);
}
function detail(id: string) {
  uni.navigateTo({ url: '/pages/detail/index?id=' + id });
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="施工记录" subtitle="每一份进展，都有迹可循"
      ><button class="icon-button" aria-label="新建施工记录" @click="create">
        <FieldIcon name="plus" active /></button
    ></PageHead>
    <view class="search-box"
      ><FieldIcon name="search" :size="19" /><input
        v-model="query"
        placeholder="搜索地点、施工内容或日期"
        confirm-type="search"
    /></view>
    <view class="filter-row"
      ><button
        v-for="item in filters"
        :key="item.id"
        class="filter"
        :class="{ active: item.id === filter }"
        @click="filter = item.id"
      >
        {{ item.text }}
      </button></view
    >
    <view v-if="state.error" class="banner error">{{ state.error }}</view>
    <view class="between list-meta"
      ><text class="caption">共 {{ records.length }} 条记录</text
      ><button class="plain-button" :disabled="state.busy" @click="refresh">
        {{ state.busy ? '正在同步' : '刷新记录' }}
      </button></view
    >
    <view v-if="!records.length" class="card empty"
      ><FieldIcon name="folder" :size="38" /><text class="empty-title">{{
        query ? '未找到匹配的记录' : '这里还没有施工记录'
      }}</text
      ><text class="empty-copy">{{
        query ? '试试更换关键词或记录状态' : '点击右上角，记录今天的现场进展'
      }}</text
      ><button v-if="!query" class="secondary" @click="create">新建一条记录</button></view
    >
    <view v-for="row in records" :key="row.id" class="card record-card" @click="detail(row.id)"
      ><view class="between"
        ><text class="record-type">{{ typeName(row.type) }}</text
        ><text class="status" :class="row.status">{{ statusNames[row.status] }}</text></view
      ><view class="record-main"
        ><view class="record-copy"
          ><text class="record-location">{{ row.location || '施工地点待填写' }}</text
          ><text class="record-content">{{ row.content || '施工内容待填写' }}</text></view
        ><view v-if="row.photos.length" class="record-thumb"
          ><PhotoTile :photo="row.photos[0]" /></view></view
      ><view v-if="row.status === 'uploading'" class="progress-track"
        ><view
          class="progress-fill"
          :style="{ width: (state.progress[row.id] || 0) + '%' }" /></view
      ><view class="record-footer"
        ><text
          >{{ row.status === 'submitted' ? '提交' : '更新' }}
          {{ formatTime(row.submittedAt || row.updatedAt) }}</text
        ><text>{{ row.photos.length }} 张照片</text></view
      ><view v-if="row.error" class="record-error">{{ row.error }}</view></view
    >
    <view v-if="records.length" class="bottom-note">{{
      state.authenticated ? '下拉可同步最新记录与审核状态' : '本机记录已保留，联网登录后可同步'
    }}</view>
  </view>
</template>
<style scoped>
.list-meta {
  margin-bottom: 12px;
}
.list-meta .plain-button {
  font-size: 12px;
}
.record-error {
  font-size: 12px;
  color: #b18b61;
  margin-top: 10px;
  line-height: 1.7;
}
</style>
