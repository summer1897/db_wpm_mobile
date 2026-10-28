<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import { checkConnection, handleError, initialize, setEndpoint, state, toast } from '../../modules/work/store';
const endpoint = ref(''),
  busy = ref(false),
  message = ref(''),
  status = ref('');
onLoad(async () => {
  await initialize();
  endpoint.value = state.local?.settings.endpoint || '';
  status.value = state.connection ? `${state.connection.instance}` : '';
});
async function saveEndpoint() {
  if (busy.value) return;
  const confirm =
    !state.user ||
    (await new Promise<boolean>((resolve) =>
      uni.showModal({
        title: '修改服务器地址',
        content: '修改后需要重新登录。本机施工记录与照片会保留，不会上传到新服务器。',
        success: (result) => resolve(result.confirm),
      }),
    ));
  if (!confirm) return;
  busy.value = true;
  message.value = '';
  try {
    await setEndpoint(endpoint.value);
    const connection = await checkConnection();
    status.value = connection.instance;
    toast('服务器连接成功');
    uni.reLaunch({ url: '/pages/login/index' });
  } catch (error: any) {
    message.value = error.message;
  } finally {
    busy.value = false;
  }
}
async function testConnection() {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    // 保存过的地址优先，未保存时先按输入框检测。
    if (endpoint.value.trim() !== (state.local?.settings.endpoint || '')) {
      message.value = '地址已修改，请先点击“保存并检测连接”';
      return;
    }
    const connection = await checkConnection();
    status.value = connection.instance;
    toast('连接正常，验证码接口可用');
  } catch (error: any) {
    handleError(error);
    message.value = state.error || error.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <view class="screen fade-in"
    ><PageHead title="项目服务" subtitle="后端地址与账号" back />
    <view v-if="message" class="banner error">{{ message }}</view>
    <view class="card"
      ><text class="section-title">服务器地址</text
      ><text class="settings-copy"
        >填写 nest-admin 后端地址，可带端口，不需要写 /api。局域网可用 http，公网地址必须使用
        HTTPS；H5 预览留空即走同源代理。</text
      ><input
        v-model="endpoint"
        class="field-input endpoint-input"
        placeholder="http://192.168.1.10:7001"
        :maxlength="250"
      /><text class="field-hint">手机真机调试请填写电脑的局域网 IP，不要用 127.0.0.1</text
      ><button
        class="primary setting-button"
        :loading="busy"
        :disabled="busy"
        @click="saveEndpoint"
      >
        保存并检测连接
      </button>
      <button
        class="secondary setting-button"
        :loading="busy"
        :disabled="busy"
        @click="testConnection"
      >
        测试当前连接
      </button>
      <text v-if="status" class="field-hint">当前后端：{{ status }}</text>
    </view>
    <view class="card"
      ><view class="between"
        ><text class="section-title">当前账号</text
        ><text class="status" :class="state.authenticated ? 'submitted' : 'queued'">{{
          state.authenticated ? '在线' : '未登录'
        }}</text></view
      >
      <view v-if="state.user" class="account-box">
        <text class="account-line">{{ state.user.name }}（{{ state.user.username }}）</text>
        <text class="account-line muted"
          >{{ state.user.role === 'admin' ? '管理人员' : '工作人员'
          }}{{ state.user.deptName ? ' · ' + state.user.deptName : '' }}</text
        >
      </view>
      <text v-else class="settings-copy">尚未登录，请返回登录页使用 nest-admin 账号登录。</text>
      <text class="settings-copy"
        >账号、密码与角色由 nest-admin 校验；施工记录目前保存在本机，后端开放记录接口后即可上传。</text
      >
    </view>
    <view class="bottom-note">服务变更不会清空本机记录或原始照片</view>
  </view>
</template>
<style scoped>
.settings-copy {
  display: block;
  font-size: 13px;
  color: #8b9c7e;
  line-height: 1.9;
  margin: 14px 0 18px;
}
.setting-button {
  margin-top: 18px;
  width: 100%;
}
.endpoint-input {
  font-size: 14px;
}
.account-box {
  margin: 12px 0 4px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f2f6ec;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.account-line {
  font-size: 14px;
  color: #35543f;
}
.account-line.muted {
  font-size: 12px;
  color: #8b9c7e;
}
</style>
