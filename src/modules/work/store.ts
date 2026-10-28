import { reactive } from 'vue';
import {
  belongs,
  canEdit,
  clone,
  validateRecord,
  type Connection,
  type LocalState,
  type Photo,
  type User,
  type WorkRecord,
  type DirectoryUser,
} from './domain';
import { createStateDriver } from '../platform/storage';
import { clearPreviews, persistPhoto, removePhotoFile, type choosePhotos } from '../platform/media';
import { WorkRepository } from './repository';
import { UploadQueue } from './sync';
import * as api from './api';
import * as backend from './backend';
import type { LedgerSnapshot } from './ledger';
export const state = reactive({
  ready: false,
  user: null as User | null,
  local: null as LocalState | null,
  connection: null as Connection | null,
  online: true,
  authenticated: false,
  busy: false,
  error: '',
  storageError: '',
  notice: '',
  progress: {} as Record<string, number>,
  lastSync: '',
  ledger: null as LedgerSnapshot | null,
  ledgerBusy: false,
  ledgerError: '',
  directory: null as { users: DirectoryUser[]; generatedAt: string } | null,
  directoryBusy: false,
  directoryError: '',
});
export const repository = new WorkRepository(createStateDriver());
let initialization: Promise<void> | undefined,
  timer: ReturnType<typeof setInterval> | undefined,
  managementTimer: ReturnType<typeof setInterval> | undefined,
  refreshing = false;
let managementEpoch = 0;
function clearManagement() {
  managementEpoch++;
  state.ledger = null;
  state.ledgerError = '';
  state.ledgerBusy = false;
  state.directory = null;
  state.directoryError = '';
  state.directoryBusy = false;
}
const queue = new UploadQueue(
  repository,
  {
    connection: api.getConnection,
    photo: api.uploadPhoto,
    submit: api.submitRecord,
    active: api.hasSession,
  },
  () => {
    void reload().catch(handleError);
  },
  (id, value) => {
    state.progress[id] = value;
  },
);
export const handleError = (error: any) => {
  state.error = error?.message || error?.errMsg || '操作未完成，请稍后重试';
  state.authenticated = backend.hasSession();
};
export const toast = (message: string) =>
  uni.showToast({ title: message, icon: 'none', duration: 2400 });
export const mine = () =>
  state.local?.records
    .filter(
      (row) =>
        state.user && state.connection && belongs(row, state.user.id, state.connection.instance),
    )
    .sort((a, b) => (b.submittedAt || b.updatedAt).localeCompare(a.submittedAt || a.updatedAt)) ||
  [];
export async function reload() {
  state.local = await repository.read();
  state.authenticated = backend.hasSession();
}
export async function initialize() {
  return (initialization ||= (async () => {
    try {
      state.local = await repository.initialize();
      state.storageError = '';
      state.connection = state.local.settings.connection || null;
      try {
        backend.configureBackend(state.local.settings.endpoint);
      } catch {
        /* 安装版尚无服务器时仍允许先配置，不丢失本机资料。 */
      }
      await new Promise<void>((resolve) =>
        uni.getNetworkType({
          success: (result) => {
            state.online = result.networkType !== 'none';
          },
          complete: () => resolve(),
        }),
      );
      const networkChanged = (online: boolean) => {
        // #ifdef H5
        online = online && navigator.onLine;
        // #endif
        state.online = online;
        if (online) void synchronize().catch(handleError);
        else {
          queue.stop();
          api.abortUploads();
        }
      };
      uni.onNetworkStatusChange((result) => networkChanged(result.isConnected));
      // 部分 H5 浏览器的 NetworkInformation 不通知离线，额外监听标准事件；原生端仍使用 uni 接口。
      // #ifdef H5
      state.online = navigator.onLine;
      window.addEventListener('online', () => networkChanged(true));
      window.addEventListener('offline', () => networkChanged(false));
      // #endif
      state.notice = state.local.storageNotice || '';
      state.ready = true;
    } catch (error) {
      handleError(error);
      state.storageError = state.error;
      state.ready = true;
    }
  })());
}
/** 仅在本机资料未能打开时重试，不删除缓存、不重建已有台账，也不改变账号身份。 */
export async function retryLocalStorage() {
  if (initialization) await initialization;
  if (state.local) return;
  initialization = undefined;
  state.ready = false;
  state.storageError = '';
  state.error = '';
  await initialize();
}
export function startForeground() {
  if (!timer)
    timer = setInterval(() => {
      void synchronize().catch(handleError);
    }, 30000);
  // 管理台账独立刷新，个人照片上传失败或长时间上传不阻挡其他人员的新资料进入统计。
  if (!managementTimer)
    managementTimer = setInterval(() => {
      if (state.user?.role !== 'admin') return;
      void refreshLedger();
      if (state.directory) void refreshDirectory();
    }, 5000);
  void synchronize().catch(handleError);
}
export function stopForeground() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (managementTimer) clearInterval(managementTimer);
  managementTimer = undefined;
  queue.stop();
  api.abortUploads();
}
export async function checkConnection() {
  if (!state.local) throw new Error('本机存储尚未就绪');
  backend.configureBackend(state.local.settings.endpoint);
  // 用公开的验证码接口确认地址、端口与服务类型，避免把别的服务误当成后端。
  await backend.probe();
  const result = backend.connectionOf(state.local.settings.projectName || '风电施工现场管理');
  state.connection = result;
  await repository.mutate((local) => {
    local.settings.connection = result;
    local.settings.projectName = result.projectName;
  });
  await reload();
  return result;
}
/**
 * 对接 nest-admin：账号密码与验证码都交给后端校验，身份与角色取账号资料里的 roles。
 * 成功后把身份写入本机，供离线继续填报使用。
 */
export async function signIn(
  username: string,
  password: string,
  captcha: { id: string; code: string },
) {
  state.error = '';
  await initialize();
  if (!state.local)
    throw new Error(
      state.storageError || '本机资料尚未打开，请重新读取本机资料；不要清理缓存',
    );
  if (!captcha?.id || !captcha.code.trim()) throw new Error('请输入验证码');
  const connection = await checkConnection();
  await backend.login(username, password, captcha.id, captcha.code);
  const account = await backend.profile();
  const user = backend.toUser(account);
  clearManagement();
  await repository.mutate((local) => {
    local.settings.identity = {
      user,
      instance: connection.instance,
      endpoint: local.settings.endpoint,
      until: Date.now() + 7 * 86400000,
    };
    local.settings.projectName = connection.projectName;
    // 同一账号、同一通道下，接续旧版本未标记实例的本机任务。
    for (const row of local.records)
      if (
        row.owner === user.id &&
        !row.instance &&
        (!row.scope || row.scope === connection.scope)
      )
        row.instance = connection.instance;
  });
  state.user = user;
  state.connection = connection;
  state.authenticated = true;
  uni.hideToast();
  await reload();
  uni.switchTab({ url: '/pages/home/index' });
}
export function continueOffline(role?: User['role']) {
  const identity = state.local?.settings.identity;
  if (
    !identity ||
    identity.until <= Date.now() ||
    identity.endpoint !== state.local?.settings.endpoint ||
    identity.instance !== state.connection?.instance
  )
    throw new Error('离线使用期限已结束，请先联网登录');
  if (role && identity.user.role !== role) throw new Error('请切换到与离线账号一致的登录身份');
  backend.clearSession();
  state.user = clone(identity.user);
  state.authenticated = false;
  state.error = '';
  clearManagement();
  uni.switchTab({ url: '/pages/home/index' });
}
export async function signOut() {
  uni.hideToast();
  queue.stop();
  api.abortUploads();
  try {
    if (backend.hasSession()) await backend.logout();
  } catch {
    /* 后端不可达时也要清掉本地登录态，避免卡在登录页无法切换账号。 */
  } finally {
    backend.clearSession();
  }
  await repository.mutate((local) => {
    delete local.settings.identity;
  });
  state.user = null;
  clearManagement();
  state.authenticated = false;
  clearPreviews();
  await reload();
  uni.reLaunch({ url: '/pages/login/index' });
}
export function requireUser() {
  if (!state.user) {
    uni.reLaunch({ url: '/pages/login/index' });
    return false;
  }
  return true;
}
export function requireManager() {
  if (!requireUser()) return false;
  if (state.user?.role !== 'admin') {
    toast('仅管理人员可查看项目台账');
    uni.switchTab({ url: '/pages/home/index' });
    return false;
  }
  return true;
}
export async function refreshLedger() {
  // nest-admin 目前没有施工记录的汇总接口，台账只能给出明确提示，不伪造数据。
  if (state.user?.role !== 'admin') return;
  state.ledger = null;
  state.ledgerBusy = false;
  state.ledgerError = '后端暂未提供项目台账接口，本机施工记录不受影响';
}
export async function refreshDirectory() {
  if (state.directoryBusy || state.user?.role !== 'admin') return;
  if (!state.online || !state.authenticated || !backend.hasSession()) {
    state.directoryError = '请联网登录后查看用户信息';
    return;
  }
  const user = state.user,
    epoch = managementEpoch;
  state.directoryBusy = true;
  try {
    const result = await backend.directory();
    if (managementEpoch === epoch && state.user?.id === user.id && state.user.role === 'admin') {
      state.directory = result;
      state.directoryError = '';
    }
  } catch (error: any) {
    if (managementEpoch === epoch && state.user?.id === user.id)
      state.directoryError = error.message || '用户信息暂时无法读取';
  } finally {
    if (managementEpoch === epoch) state.directoryBusy = false;
  }
}
export async function setEndpoint(value: string) {
  backend.configureBackend(value);
  backend.clearSession();
  queue.stop();
  clearPreviews();
  await repository.mutate((local) => {
    local.settings.endpoint = value.trim().replace(/\/$/, '');
    delete local.settings.connection;
    delete local.settings.identity;
  });
  state.user = null;
  state.connection = null;
  clearManagement();
  await reload();
}
export async function synchronize(force = false) {
  // 后端未开放施工记录接口时，不做无效轮询，也不把本机草稿标成上传失败。
  if (!backend.supportsBusiness) return;
  if (refreshing || !state.user || !state.connection || !state.online || !api.hasSession()) return;
  refreshing = true;
  state.busy = true;
  const user = state.user,
    instance = state.connection.instance;
  try {
    const connection = await checkConnection();
    if (connection.instance !== instance) {
      api.clearSession();
      throw new Error('服务实例已变化，请重新登录核实项目');
    }
    await queue.run(user.id, instance, true, force);
    if (!api.hasSession() || state.user?.id !== user.id) return;
    const result = await api.getReports();
    await repository.merge(result.reports, result.deletedIds, user.id, instance, connection.scope);
    state.lastSync = new Date().toISOString();
    state.error = '';
    await reload();
    if (state.user?.role === 'admin') await refreshLedger();
  } finally {
    state.busy = false;
    refreshing = false;
    state.authenticated = api.hasSession();
  }
}
export async function newWork(type: WorkRecord['type'] = '') {
  if (!state.user || !state.connection) throw new Error('请先登录项目账号');
  const row = await repository.create(state.user.id, state.connection.instance, type);
  await repository.update(row.id, row.owner, row.instance!, (record) => {
    record.scope = state.connection!.scope;
  });
  await reload();
  uni.navigateTo({ url: '/pages/report/index?id=' + row.id });
}
export function findWork(id: string) {
  return mine().find((row) => row.id === id);
}
export async function saveForm(row: WorkRecord) {
  await repository.saveForm(clone(row));
  await reload();
}
export async function addPhotos(row: WorkRecord, files: Awaited<ReturnType<typeof choosePhotos>>) {
  try {
    for (const file of files) {
      const photo = await persistPhoto(file);
      try {
        await repository.addPhoto(row.id, row.owner, row.instance!, photo);
      } catch (error) {
        await removePhotoFile(photo).catch(() => {});
        throw error;
      }
    }
  } finally {
    await reload();
  }
}
export async function removePhoto(row: WorkRecord, photo: Photo) {
  await repository.update(row.id, row.owner, row.instance!, (record) => {
    if (!canEdit(record)) throw new Error('已开始上传的照片不能删除');
    record.photos = record.photos.filter((item) => item.id !== photo.id);
  });
  await removePhotoFile(photo).catch(() => {});
  await reload();
}
export async function submit(row: WorkRecord) {
  if (!backend.supportsBusiness) {
    const message = validateRecord(row);
    if (message) throw new Error(message);
    await saveForm(row);
    await reload();
    toast('后端尚未接入施工记录接口，已保存为本机草稿');
    return;
  }
  await saveForm(row);
  await queue.enqueue(row.id, row.owner, row.instance!);
  await reload();
  if (state.online && api.hasSession()) await synchronize(true);
  else toast(state.online ? '已保存待上传，联网登录后继续' : '已离线保存，恢复网络后继续上传');
}
export async function retry(row: WorkRecord) {
  await queue.enqueue(row.id, row.owner, row.instance!);
  await reload();
  await synchronize(true);
}
export async function deleteWork(row: WorkRecord) {
  const photos = await repository.remove(row.id, row.owner, row.instance!);
  for (const photo of photos) await removePhotoFile(photo).catch(() => {});
  await reload();
}
