<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import { formatTime } from '../../modules/work/domain';
import { refreshDirectory, requireManager, state } from '../../modules/work/store';
const search = ref(''),
  role = ref('');
const users = computed(() => state.directory?.users || []);
const visible = computed(() =>
  users.value
    .filter(
      (user) =>
        (!role.value || user.role === role.value) &&
        (!search.value.trim() ||
          [user.name, user.memberNumber].join(' ').includes(search.value.trim())),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);
onShow(() => {
  if (requireManager()) void refreshDirectory();
});
onPullDownRefresh(async () => {
  try {
    await refreshDirectory();
  } finally {
    uni.stopPullDownRefresh();
  }
});
const filters = [
  { id: '', name: '全部人员' },
  { id: 'admin', name: '管理人员' },
  { id: 'worker', name: '工作人员' },
];
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="用户信息" subtitle="项目人员 · 资料概览" back />
    <view class="people-summary">
      <view
        ><text class="people-total">{{ state.directory ? users.length : '—' }}</text
        ><text>项目人员</text></view
      >
      <view
        ><text>{{ users.filter((user) => user.role === 'admin').length }}</text
        ><text>管理人员</text></view
      >
      <view
        ><text>{{ users.filter((user) => user.role === 'worker').length }}</text
        ><text>工作人员</text></view
      >
    </view>
    <view class="search-box"
      ><FieldIcon name="search" :size="19" /><input
        v-model="search"
        placeholder="搜索姓名或成员编号"
    /></view>
    <view class="filter-row"
      ><button
        v-for="item in filters"
        :key="item.id"
        class="filter"
        :class="{ active: role === item.id }"
        @click="role = item.id"
      >
        {{ item.name }}
      </button></view
    >
    <view class="between people-heading"
      ><text class="caption">{{ visible.length }} 位人员</text
      ><button class="plain-button" :disabled="state.directoryBusy" @click="refreshDirectory">
        {{ state.directoryBusy ? '更新中' : '更新资料' }}
      </button></view
    >
    <view v-if="state.directoryError" class="banner error">{{ state.directoryError }}</view>
    <view v-for="person in visible" :key="person.id" class="card person-card">
      <view class="between"
        ><view class="person-identity"
          ><view class="person-avatar" :class="{ manager: person.role === 'admin' }"
            ><FieldIcon
              :name="person.role === 'admin' ? 'manager' : 'worker'"
              active
              :size="23" /></view
          ><view
            ><text class="person-name">{{ person.name }}</text
            ><text class="person-number">成员编号 {{ person.memberNumber }}</text></view
          ></view
        ><text class="person-role" :class="{ manager: person.role === 'admin' }">{{
          person.role === 'admin' ? '管理人员' : '工作人员'
        }}</text></view
      >
      <view class="person-metrics"
        ><view
          ><text>{{ person.records }}</text
          ><text>施工记录</text></view
        ><view
          ><text>{{ person.photos }}</text
          ><text>现场照片</text></view
        ><view class="person-status"
          ><text :class="{ active: person.active }">{{ person.active ? '正常' : '停用' }}</text
          ><text>使用状态</text></view
        ></view
      >
      <view class="person-dates"
        ><text>注册 {{ formatTime(person.createdAt) }}</text
        ><text v-if="person.lastSubmittedAt">最近上传 {{ formatTime(person.lastSubmittedAt) }}</text
        ><text v-else>尚未上传记录</text></view
      >
    </view>
    <view v-if="!visible.length && !state.directoryBusy" class="card empty"
      ><FieldIcon name="user" :size="34" /><text class="empty-title">暂无符合条件的人员</text
      ><text class="empty-copy">可切换身份筛选或修改搜索内容</text></view
    >
    <view v-if="state.directory" class="bottom-note"
      >资料更新 {{ formatTime(state.directory.generatedAt) }}</view
    >
  </view>
</template>
<style scoped>
.people-summary {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 24px 23px;
  border-radius: 23px;
  background: linear-gradient(135deg, #244f40, #3c6852);
  color: #edf5e5;
  margin-bottom: 24px;
}
.people-summary > view {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.people-summary text:first-child {
  font-size: 27px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.people-summary .people-total {
  font-size: 43px;
}
.people-summary text:last-child {
  font-size: 11px;
  color: #b7cdb7;
}
.people-heading {
  margin-bottom: 15px;
}
.person-card {
  margin-bottom: 14px;
  padding: 20px;
}
.person-identity {
  display: flex;
  gap: 11px;
  align-items: center;
  min-width: 0;
}
.person-avatar {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #edf2e7;
  border-radius: 14px;
  flex-shrink: 0;
}
.person-avatar.manager {
  background: #e2ebdf;
}
.person-name {
  display: block;
  font-size: 17px;
  font-weight: 600;
  color: #2b513c;
}
.person-number {
  display: block;
  margin-top: 5px;
  color: #8b9a83;
  font-size: 12px;
}
.person-role {
  flex-shrink: 0;
  font-size: 10px;
  color: #839379;
  padding: 4px 8px;
  background: #f0f4eb;
  border-radius: 7px;
}
.person-role.manager {
  color: #447252;
  background: #e7efe2;
}
.person-metrics {
  display: flex;
  gap: 15px;
  margin: 20px 0 17px;
  padding: 17px 0 0;
  border-top: 1px solid #edf1e8;
}
.person-metrics > view {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.person-metrics text:first-child {
  font-size: 23px;
  font-variant-numeric: tabular-nums;
  color: #375e44;
}
.person-metrics text:last-child {
  font-size: 11px;
  color: #9ba58f;
}
.person-metrics .person-status text:first-child {
  font-size: 13px;
  line-height: 30px;
  color: #af9770;
}
.person-metrics .person-status text.active:first-child {
  color: #438263;
}
.person-dates {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #9ca68f;
  font-size: 10px;
  line-height: 1.8;
}
</style>
