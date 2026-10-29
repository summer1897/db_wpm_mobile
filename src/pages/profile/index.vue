<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import { formatTime } from '../../modules/work/domain';
import {
  handleError,
  myEntries,

  reload,
  requireUser,
  signOut,
  state,
  submittedEntries,
  synchronize,
  uploadStats,
} from '../../modules/work/store';

const records = computed(myEntries);
const stats = computed(() => uploadStats());
const reviewPending = computed(
  () => submittedEntries().filter((row) => row.reviewStatusCode === 'pending').length,
);

onShow(() => {
  if (requireUser()) void reload().catch(handleError);
});

const settings = () => uni.navigateTo({ url: '/pages/settings/index' });
const uploads = () => uni.switchTab({ url: '/pages/uploads/index' });
const units = () => uni.switchTab({ url: '/pages/units/index' });
const projectLedger = () => uni.navigateTo({ url: '/pages/ledger/index' });
const userDirectory = () => uni.navigateTo({ url: '/pages/users/index' });

async function sync() {
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
    content: '本机未上传的记录与照片会保留，退出后需联网登录才能继续上传。',
    confirmText: '退出登录',
    success: (result) => {
      if (result.confirm) void signOut().catch(handleError);
    },
  });
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="我的" subtitle="风电施工现场管理" />

    <view class="profile-card">
      <view class="avatar">{{ state.user?.name.slice(0, 1) || '工' }}</view>
      <view>
        <text class="profile-name">{{ state.user?.name }}</text>
        <text class="profile-role">
          {{ state.user?.role === 'admin' ? '管理人员' : '工作人员' }} ·
          {{ state.authenticated ? '在线账号' : '本机离线身份' }}
        </text>
      </view>
    </view>

    <view v-if="state.error" class="banner error">{{ state.error }}</view>

    <view class="card project-card">
      <view class="between">
        <text class="section-title">当前项目</text>
        <text class="status" :class="state.authenticated ? 'submitted' : 'queued'">
          {{ state.authenticated ? '后端已连接' : '本机模式' }}
        </text>
      </view>
      <text class="project-name">{{ state.project?.name || state.connection?.projectName || '尚未配置项目服务' }}</text>
      <text class="caption">
        {{ state.project?.code || '无编号' }} · {{ state.project?.role === 'owner' ? '项目负责人' : state.project?.role === 'manager' ? '项目管理员' : '记录员' }}
      </text>
      <view class="stat-row">
        <view><text class="stat-number">{{ stats.pending }}</text><text class="stat-label">待上传</text></view>
        <view><text class="stat-number">{{ stats.submitted }}</text><text class="stat-label">已上传</text></view>
        <view><text class="stat-number">{{ reviewPending }}</text><text class="stat-label">待审核</text></view>
      </view>
    </view>

    <view class="section-head"><text class="section-title">工作与设置</text></view>
    <view class="card">
      <view v-if="state.user?.role === 'admin'" class="menu-item" @click="userDirectory">
        <view class="row">
          <FieldIcon name="user" active />
          <view><text class="menu-title">用户信息</text><text class="menu-copy">人员身份与资料概况</text></view>
        </view>
        <FieldIcon name="chevron" :size="16" />
      </view>
      <view v-if="state.user?.role === 'admin'" class="menu-item" @click="projectLedger">
        <view class="row">
          <FieldIcon name="chart" active />
          <view><text class="menu-title">项目工作台账</text><text class="menu-copy">汇总、审核与记录流水</text></view>
        </view>
        <FieldIcon name="chevron" :size="16" />
      </view>
      <view class="menu-item" @click="sync">
        <view class="row">
          <FieldIcon name="refresh" active />
          <view>
            <text class="menu-title">同步与上传</text>
            <text class="menu-copy">{{
              state.busy
                ? '同步中，请稍候'
                : state.lastSync
                  ? '上次同步 ' + formatTime(state.lastSync)
                  : '上传待办并获取最新审核状态'
            }}</text>
          </view>
        </view>
        <FieldIcon name="chevron" :size="16" />
      </view>
      <view class="menu-item" @click="settings">
        <view class="row">
          <FieldIcon name="settings" active />
          <view><text class="menu-title">项目服务与账号</text><text class="menu-copy">服务器地址与当前登录账号</text></view>
        </view>
        <FieldIcon name="chevron" :size="16" />
      </view>
      <view class="menu-item" @click="units">
        <view class="row">
          <FieldIcon name="turbine" active />
          <view><text class="menu-title">事项 / 风机</text><text class="menu-copy">按机位查看工序进度</text></view>
        </view>
        <text class="caption">{{ (state.local?.units || []).length }} 个</text>
      </view>
      <view class="menu-item" @click="uploads">
        <view class="row">
          <FieldIcon name="folder" active />
          <view><text class="menu-title">本机资料</text><text class="menu-copy">草稿、待上传记录及原始照片</text></view>
        </view>
        <text class="caption">{{ records.length }} 条</text>
      </view>
    </view>

    <view class="offline-guide">
      <view class="row"><FieldIcon name="shield" active :size="18" /><text>关于离线保存</text></view>
      <text>现场无网络时记录与照片保存在本机；恢复网络后到「上传」页一键批量上传，可逐条查看进度。</text>
      <text>请勿卸载应用或清理微信 / 浏览器数据，以免丢失未上传资料。</text>
    </view>

    <button class="secondary" @click="logout">退出登录</button>
    <view class="bottom-note">风电施工现场管理 · 2.0</view>
  </view>
</template>
<style scoped>
.profile-card {
  display: flex;
  align-items: center;
  gap: 17px;
  margin: 6px 0 24px;
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
  margin: 16px 0 4px;
  font-weight: 550;
}
.stat-row {
  display: flex;
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid rgba(90, 120, 80, 0.16);
}
.stat-row > view {
  flex: 1;
  text-align: center;
}
.stat-number {
  display: block;
  font-size: 18px;
  font-weight: 650;
  color: #355940;
}
.stat-label {
  font-size: 10px;
  color: #82906f;
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid #f0f3ea;
}
.menu-item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}
.menu-item:first-child {
  padding-top: 0;
}
.menu-title {
  display: block;
  font-size: 15px;
  color: #40584a;
  font-weight: 550;
}
.menu-copy {
  display: block;
  font-size: 11px;
  color: #93a08f;
  margin-top: 3px;
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
