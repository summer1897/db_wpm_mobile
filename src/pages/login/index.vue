<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import FieldIcon from '../../components/FieldIcon.vue';
import * as backend from '../../modules/work/backend';
import {
  checkConnection,
  continueOffline,
  handleError,
  initialize,
  retryLocalStorage,
  signIn,
  state,
} from '../../modules/work/store';
const username = ref(''),
  password = ref(''),
  reveal = ref(false),
  busy = ref(false);
// nest-admin 登录必须带图形验证码，验证码一次性使用，失败后要重新获取。
const captchaId = ref(''),
  captchaImg = ref(''),
  captchaCode = ref(''),
  captchaLoading = ref(false);
const needsService = computed(() => {
  let native = false;
  // #ifndef H5
  native = true;
  // #endif
  return native && Boolean(state.local) && !state.local?.settings.endpoint.trim();
});
const offline = computed(() => {
  const identity = state.local?.settings.identity;
  return identity &&
    identity.until > Date.now() &&
    identity.endpoint === state.local?.settings.endpoint
    ? identity
    : null;
});
async function refreshCaptcha() {
  if (captchaLoading.value) return;
  captchaLoading.value = true;
  try {
    const result = await backend.loadCaptcha();
    captchaId.value = result.id;
    captchaImg.value = result.img;
  } catch (error: any) {
    captchaId.value = '';
    captchaImg.value = '';
    state.error = error?.message || '验证码加载失败，请检查服务器地址';
  } finally {
    captchaLoading.value = false;
  }
}
onLoad(async () => {
  await initialize();
  if (!state.local) return;
  try {
    await checkConnection();
  } catch (error: any) {
    // 地址未配置或后端未启动时不覆盖登录表单，只提示原因。
    state.error = error?.message || '';
  }
  await refreshCaptcha();
});
// 账号、密码仅保留在本页内存；新打开/退出后页面初值为空，返回配置页不清掉正在填写的表单。
async function submit() {
  if (busy.value) return;
  if (!username.value.trim() || !password.value) {
    state.error = '请输入用户名和密码';
    return;
  }
  if (!captchaId.value) {
    state.error = '验证码未加载，请点击验证码重新获取';
    return;
  }
  if (!captchaCode.value.trim()) {
    state.error = '请输入验证码';
    return;
  }
  busy.value = true;
  state.error = '';
  try {
    await signIn(username.value, password.value, {
      id: captchaId.value,
      code: captchaCode.value.trim(),
    });
    password.value = '';
    captchaCode.value = '';
  } catch (error) {
    handleError(error);
    captchaCode.value = '';
    await refreshCaptcha();
    // #ifndef H5
    uni.showToast({ title: state.error, icon: 'none', duration: 3000 });
    // #endif
  } finally {
    busy.value = false;
  }
}
const configure = () => uni.navigateTo({ url: '/pages/settings/index' });
function enterOffline() {
  try {
    continueOffline();
  } catch (error) {
    handleError(error);
  }
}
async function retryStorage() {
  if (busy.value) return;
  busy.value = true;
  try {
    await retryLocalStorage();
    if (state.local) uni.showToast({ title: '本机资料已打开', icon: 'none' });
  } catch (error) {
    handleError(error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <view class="login-screen">
    <image class="login-background" src="/static/wind-farm.jpg" mode="aspectFill" />
    <view class="login-shade" />
    <view class="login-top"
      ><view class="brand-mark"><FieldIcon name="turbine" active :size="27" /></view
      ><text>风电施工现场管理</text
      ><button class="login-settings" aria-label="配置服务器" @click="configure">
        <FieldIcon name="settings" active :size="21" /></button
    ></view>
    <view class="login-content fade-in">
      <view class="brand-line" />
      <text class="login-title">记录每一步建设</text
      ><text class="login-subtitle">让现场与项目，始终相连。</text>
      <view class="login-card">
        <view class="between"
          ><text class="login-card-title">登录项目</text
          ><view class="login-badge"
            ><view class="status-dot" :class="{ offline: !state.online }" /><text>{{
              state.online ? '项目登录' : '当前离线'
            }}</text></view
          ></view
        >
        <view
          v-if="state.error && (state.local || state.error !== state.storageError)"
          class="banner error"
          >{{ state.error }}</view
        >
        <view v-if="!state.local && state.ready" class="banner error"
          ><text>{{
            state.storageError || '本机资料暂时无法打开，请保留应用数据，勿清理缓存。'
          }}</text>
          <button
            class="plain-button storage-retry"
            :loading="busy"
            :disabled="busy"
            @click="retryStorage"
          >
            重新读取本机资料
          </button></view
        >
        <view class="login-input"
          ><FieldIcon name="user" :size="20" /><input
            v-model="username"
            placeholder="输入用户名"
            :maxlength="50"
            autocomplete="off"
            :auto-focus="false"
            :adjust-position="true"
        /></view>
        <view class="login-input"
          ><FieldIcon name="shield" :size="20" /><input
            v-model="password"
            placeholder="输入密码"
            :password="!reveal"
            :maxlength="128"
            autocomplete="new-password"
            :adjust-position="true"
            @confirm="submit" /><button
            class="reveal"
            :aria-label="reveal ? '隐藏密码' : '显示密码'"
            @click="reveal = !reveal"
          >
            <FieldIcon :name="reveal ? 'eye-off' : 'eye'" :size="20" /></button
        ></view>
        <view class="login-input captcha-row"
          ><FieldIcon name="search" :size="20" /><input
            v-model="captchaCode"
            placeholder="输入验证码"
            :maxlength="4"
            autocomplete="off"
            :adjust-position="true"
            @confirm="submit"
          /><image
            v-if="captchaImg"
            class="captcha-img"
            :src="captchaImg"
            mode="aspectFit"
            @click="refreshCaptcha"
          /><text v-else class="captcha-retry" @click="refreshCaptcha">{{
            captchaLoading ? '加载中' : '点击获取'
          }}</text></view
        >
        <button
          class="primary login-submit"
          style="background-color: #23664e; color: #ffffff"
          hover-class="login-submit-pressed"
          :loading="busy"
          :disabled="busy"
          :aria-busy="busy"
          @click="submit"
        >
          登录<text class="login-arrow">→</text>
        </button>
        <view v-if="needsService" class="service-setup-hint">
          <text>首次使用，请先连接项目服务</text>
          <button class="plain-button" :disabled="busy" @click="configure">配置服务地址 →</button>
        </view>
        <button v-if="offline" class="offline-button" @click="enterOffline">
          继续本机离线填报
        </button>
        <view v-if="offline" class="offline-copy">仅保存到本机，联网登录后上传</view>
      </view>
      <button class="server-entry" @click="configure">
        {{ state.local?.settings.endpoint ? '项目服务已配置 · 修改' : '配置项目服务' }}
      </button>
    </view>
    <view class="login-footer">现场记录 · 可靠留存 · 同步归档</view>
  </view>
</template>
<style scoped>
.login-screen {
  min-height: 100vh;
  background: #193c32;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: #f8fcf2;
}
.login-background,
.login-shade {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
}
.login-background {
  opacity: 0.6;
}
.login-shade {
  background: linear-gradient(
    180deg,
    rgba(19, 50, 43, 0.24) 0%,
    rgba(16, 47, 37, 0.34) 25%,
    rgba(19, 47, 36, 0.92) 100%
  );
}
.login-top {
  position: relative;
  padding: 30px 26px;
  padding-top: calc(28px + env(safe-area-inset-top));
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
}
.brand-mark {
  width: 40px;
  height: 40px;
  border: 1px solid rgba(229, 244, 207, 0.28);
  background: #f1f6e8;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-settings {
  margin-left: auto;
  width: 44px;
  height: 44px;
  padding: 0;
  background: rgba(241, 247, 230, 0.94);
  border: 1px solid rgba(250, 255, 243, 0.42);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 5px 18px rgba(13, 39, 29, 0.1);
}
.role-switch {
  display: flex;
  gap: 5px;
  padding: 5px;
  margin: -5px -3px 24px;
  border-radius: 16px;
  background: #eaf0e3;
}
.role-option {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 12px 4px;
  border-radius: 12px;
  background: transparent;
  text-align: left;
}
.role-option.selected {
  background: #fcfef8;
  box-shadow: 0 3px 12px rgba(40, 70, 37, 0.07);
}
.role-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  color: #7f9177;
}
.selected .role-name {
  color: #2e6045;
}
.role-detail {
  display: block;
  font-size: 9px;
  font-weight: 400;
  color: #9ca990;
  letter-spacing: 0;
  margin-top: 3px;
}
.login-content {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 510px;
  margin: auto;
  padding: 24px 26px 20px;
}
.brand-line {
  width: 36px;
  height: 3px;
  background: #d6e5b4;
  margin-bottom: 19px;
  border-radius: 4px;
}
.login-title {
  display: block;
  font-size: 29px;
  font-weight: 600;
  letter-spacing: -0.8px;
  line-height: 1.4;
}
.login-subtitle {
  display: block;
  font-size: 15px;
  color: #c7d4bf;
  margin: 10px 0 26px;
  letter-spacing: 1px;
}
.login-card {
  background: #fafcf6;
  color: #244a38;
  padding: 25px 22px 22px;
  border-radius: 25px;
  box-shadow: 0 20px 60px rgba(3, 25, 12, 0.17);
}
.login-card-title {
  font-size: 21px;
  font-weight: 650;
}
.login-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #92a083;
}
.login-card .between {
  margin-bottom: 22px;
}
.login-input {
  height: 57px;
  background: #eef2e8;
  border: 1px solid #e3e9da;
  border-radius: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  margin-bottom: 13px;
}
.login-input input {
  flex: 1;
  min-width: 0;
  font-size: 15px;
}
.reveal {
  background: transparent;
  padding: 5px 0 5px 7px;
  display: flex;
  align-items: center;
}
.captcha-row {
  gap: 10px;
}
.captcha-img {
  width: 96px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #dfe6d7;
}
.captcha-retry {
  flex-shrink: 0;
  font-size: 12px;
  color: #4b7a5d;
  padding: 6px 2px;
}
.login-submit {
  margin-top: 22px;
  text-align: left;
  border-radius: 13px;
  font-size: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-height: 52px;
  background-color: #23664e;
  color: #fff;
}
.login-submit-pressed {
  opacity: 0.85;
}
.login-arrow {
  font-size: 23px;
  line-height: 1;
  font-weight: 400;
}
.register-button {
  margin: 16px auto 0;
  text-align: center;
  font-size: 12px;
}
.service-setup-hint {
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  background: #eef2e8;
  color: #76866c;
  font-size: 12px;
  line-height: 1.7;
}
.service-setup-hint button {
  padding: 5px 0 0;
  color: #356b4e;
  text-align: left;
  font-size: 13px;
}
.storage-retry {
  margin-top: 10px;
  padding: 4px 0;
  text-align: left;
  color: #965d44;
  font-size: 13px;
}
.offline-button {
  margin-top: 18px;
  width: 100%;
  color: #66825e;
  font-size: 13px;
  background: transparent;
  padding: 8px 0 0;
}
.offline-copy {
  text-align: center;
  font-size: 11px;
  color: #99a48e;
  margin-top: 3px;
}
.server-entry {
  margin: 19px auto 0;
  background: transparent;
  color: #d2ddc6;
  font-size: 12px;
  letter-spacing: 1px;
}
.login-footer {
  position: relative;
  z-index: 1;
  padding: 28px 20px;
  padding-bottom: calc(28px + env(safe-area-inset-bottom));
  text-align: center;
  color: #9eaf96;
  font-size: 11px;
  letter-spacing: 2px;
}
@media (max-height: 730px) {
  .login-content {
    padding-top: 18px;
  }
  .login-top {
    padding-bottom: 16px;
  }
  .login-subtitle {
    margin-bottom: 23px;
  }
  .login-footer {
    padding-top: 15px;
    padding-bottom: 16px;
  }
}
</style>
