<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import { formatTime } from '../../modules/work/domain';
import * as backend from '../../modules/work/backend';
import {
  handleError,
  mine,
  reload,
  requireUser,
  signOut,
  state,
  synchronize,
} from '../../modules/work/store';
const records = computed(mine),
  drafts = computed(() => records.value.filter((row) => row.status !== 'submitted').length);
onShow(() => {
  if (requireUser()) void reload().catch(handleError);
});
function settings() {
  uni.navigateTo({ url: '/pages/settings/index' });
}
function localRecords() {
  uni.switchTab({ url: '/pages/records/index' });
}
function projectLedger() {
  uni.navigateTo({ url: '/pages/ledger/index' });
}
const userDirectory = () => uni.navigateTo({ url: '/pages/users/index' });
async function sync() {
  if (!backend.supportsBusiness) {
    uni.showToast({ title: '后端暂未开放记录同步接口，记录保存在本机', icon: 'none', duration: 2400 });
    return;
  }
  try {
    await synchronize(true);
    if (!state.authenticated) uni.navigateTo({ url: '/pages/login/index' });
  } catch (error) {
    handleError(error);
  }
}
function logout() {
  uni.showModal({
    title: '退出当前账号',
    content: '本机施工资料将保留，退出后需联网登录才能再次使用此账号。',
    confirmText: '退出登录',
    success: (result) => {
      if (result.confirm) void signOut().catch(handleError);
    },
  });
}
</script>
<template>
  <view class="screen fade-in"
    ><PageHead title="我的" subtitle="风电施工现场管理" />
    <view class="profile-card"
      ><view class="avatar">{{ state.user?.name.slice(0, 1) || '工' }}</view
      ><view
        ><text class="profile-name">{{ state.user?.name }}</text
        ><text class="profile-role"
          >{{ state.user?.role === 'admin' ? '管理人员' : '工作人员' }} ·
          {{ state.authenticated ? '在线账号' : '本机离线身份' }}</text
        ></view
      ></view
    >
    <view v-if="state.error" class="banner error">{{ state.error }}</view>
    <view class="card project-card"
      ><view class="between"
        ><text class="section-title">当前项目</text
        ><text class="status" :class="state.authenticated ? 'submitted' : 'queued'">{{
          state.authenticated ? '后端已连接' : '本机模式'
        }}</text
        ></view
      ><text class="project-name">{{ state.connection?.projectName || '尚未配置项目服务' }}</text
      ><text class="caption"
        >{{ drafts }} 条本机记录待完成 · {{ records.length }} 条个人记录</text
      ></view
    >
    <view class="section-head"><text class="section-title">工作与设置</text></view>
    <view class="card"
      ><view v-if="state.user?.role === 'admin'" class="menu-item" @click="userDirectory">
        <view class="row"
          ><FieldIcon name="user" active /><view
            ><text class="menu-title">用户信息</text
            ><text class="menu-copy">人员身份与资料概况</text></view
          ></view
        ><FieldIcon name="chevron" :size="16" /> </view
      ><view v-if="state.user?.role === 'admin'" class="menu-item" @click="projectLedger"
        ><view class="row"
          ><FieldIcon name="chart" active /><view
            ><text class="menu-title">项目工作台账</text
            ><text class="menu-copy">查看各人员已提交记录与现场资料</text></view
          ></view
        ><FieldIcon name="chevron" :size="16" /></view
      ><view class="menu-item" @click="sync"
        ><view class="row"
          ><FieldIcon name="refresh" active /><view
            ><text class="menu-title">同步施工记录</text
            ><text class="menu-copy">{{
              state.busy
                ? '同步中，请稍候'
                : !backend.supportsBusiness
                  ? '后端暂未开放记录接口，记录保存在本机'
                  : state.lastSync
                    ? '上次同步 ' + formatTime(state.lastSync)
                    : '上传待办并获取最新审核状态'
            }}</text></view
          ></view
        ><FieldIcon name="chevron" :size="16" /></view
      ><view class="menu-item" @click="settings"
        ><view class="row"
          ><FieldIcon name="settings" active /><view
            ><text class="menu-title">项目服务与账号</text
            ><text class="menu-copy">服务器地址与当前登录账号</text></view
          ></view
        ><FieldIcon name="chevron" :size="16" /></view
      ><view class="menu-item" @click="localRecords"
        ><view class="row"
          ><FieldIcon name="folder" active /><view
            ><text class="menu-title">本机资料</text
            ><text class="menu-copy">草稿、待上传记录及原始照片</text></view
          ></view
        ><text class="caption">{{ drafts }} 条</text></view
      ></view
    >
    <view class="offline-guide"
      ><view class="row"
        ><FieldIcon name="shield" active :size="18" /><text>关于离线保存</text></view
      ><text
        >提交时优先上传；没有网络时保存至本机。恢复网络并保持应用在前台，任务将继续上传。草稿需手动提交。</text
      ><text>请勿卸载应用或清理微信 / 浏览器数据，以免丢失未上传资料。</text></view
    >
    <button class="secondary" @click="logout">退出登录</button
    ><view class="bottom-note">风电施工现场管理 · 1.0</view>
  </view>
</template>
<style scoped>
.profile-card {
  display: flex;
  align-items: center;
  gap: 17px;
  margin: 6px 0 28px;
}
.avatar {
  width: 65px;
  height: 65px;
  border-radius: 22px;
  background: #dce8d4;
  color: #567450;
  font-size: 29px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.profile-name {
  display: block;
  font-size: 24px;
  font-weight: 600;
}
.profile-role {
  display: block;
  font-size: 12px;
  color: #92a087;
  margin-top: 4px;
}
.project-card {
  background: #e8eee1;
  border-color: #dce6d3;
}
.project-name {
  display: block;
  font-size: 18px;
  margin: 19px 0 6px;
  font-weight: 550;
}
.offline-guide {
  margin: 26px 5px;
  color: #91a086;
  font-size: 12px;
  line-height: 1.95;
}
.offline-guide > text {
  display: block;
  margin-top: 10px;
}
.offline-guide .row {
  color: #69815a;
  font-size: 13px;
  font-weight: 600;
}
</style>
