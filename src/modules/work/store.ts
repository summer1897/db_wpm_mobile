import { reactive } from 'vue';
import {
  belongs,
  canEdit,
  clone,
  isPending,
  stepNameOf,
  validateEntry,
  type Connection,
  type Dict,
  type DirectoryUser,
  type Entry,
  type LocalState,
  type Project,
  type UnitStep,
  type User,
} from './domain';
import { createStateDriver } from '../platform/storage';
import { clearPreviews, persistPhoto, removePhotoFile, type choosePhotos } from '../platform/media';
import { resolveEndpoint } from '../../config/deployment';
import { WorkRepository } from './repository';
import { UploadRunner, emptyBatch, type BatchState } from './sync';
import * as api from './api';
import * as backend from './backend';

export const state = reactive({
  ready: false,
  user: null as User | null,
  local: null as LocalState | null,
  project: null as Project | null,
  /** 我在该项目下可参与的项目（后台分配结果），空数组说明还没被分配 */
  projects: [] as Project[],
  dict: null as Dict | null,
  connection: null as Connection | null,
  online: true,
  authenticated: false,
  busy: false,
  refreshing: false,
  error: '',
  storageError: '',
  notice: '',
  /** 单条记录的百分比进度 */
  progress: {} as Record<string, number>,
  /** 批量上传总进度 */
  batch: emptyBatch() as BatchState,
  lastSync: '',
  ledger: null as any,
  ledgerBusy: false,
  ledgerError: '',
  directory: null as { users: DirectoryUser[]; generatedAt: string } | null,
  directoryBusy: false,
  directoryError: '',
});

export const repository = new WorkRepository(createStateDriver());

let initialization: Promise<void> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;

const runner = new UploadRunner(
  repository,
  {
    connection: () => api.getConnection(),
    upload: api.uploadAttachment,
    submit: api.submitEntry,
    active: api.hasSession,
  },
  {
    changed: () => {
      void reload().catch(() => {});
    },
    progress: (id, value) => {
      state.progress[id] = value;
    },
    batch: (value) => {
      state.batch = value;
    },
  },
);

export const handleError = (error: any) => {
  state.error = error?.message || error?.errMsg || '操作未完成，请稍后重试';
  state.authenticated = backend.hasSession();
};

export const toast = (message: string) =>
  uni.showToast({ title: message, icon: 'none', duration: 2400 });

export async function reload() {
  const local = await repository.read();
  state.local = local;
  state.project = local.settings.project || null;
  state.dict = local.dict || null;
  state.authenticated = backend.hasSession();
}

/** 当前账号在本项目下的记录（按更新时间倒序） */
export function myEntries(): Entry[] {
  const local = state.local;
  if (!local || !state.user || !state.connection) return [];
  return local.entries
    .filter((row) => belongs(row, state.user!.id, state.connection!.instance))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export const pendingEntries = () => myEntries().filter(isPending);
export const submittedEntries = () =>
  myEntries().filter((row) => row.status === 'submitted');
export const entriesOf = (unitId: string) =>
  myEntries().filter((row) => row.unitId === unitId);

export function unitById(id: string) {
  return state.local?.units.find((item) => item.id === id);
}

export function unitSteps(id: string): UnitStep[] {
  const unit = unitById(id);
  return unit?.steps || [];
}

/** 上传概览：条数与照片数，供工作台/上传中心展示 */
export function uploadStats() {
  const mine = myEntries();
  const pending = mine.filter(isPending);
  const failed = pending.filter((row) => row.status === 'failed');
  return {
    total: mine.length,
    pending: pending.length,
    failed: failed.length,
    submitted: mine.filter((row) => row.status === 'submitted').length,
    drafts: mine.filter((row) => row.status === 'draft').length,
    photos: pending.reduce((sum, row) => sum + row.attachments.length, 0),
    percent: state.batch.total
      ? Math.round(((state.batch.done + state.batch.failed) / state.batch.total) * 100)
      : pending.length
        ? 0
        : 100,
  };
}

export async function initialize() {
  return (initialization ||= (async () => {
    try {
      const local = await repository.initialize();
      state.local = local;
      state.project = local.settings.project || null;
      state.dict = local.dict || null;
      state.storageError = '';
      state.connection = local.settings.connection || null;
      try {
        backend.configureBackend(resolveEndpoint(local.settings.endpoint));
      } catch {
        /* 安装版尚未配置服务器时仍允许先离线使用，不丢本机资料 */
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
      };
      uni.onNetworkStatusChange((result) => networkChanged(result.isConnected));
      // #ifdef H5
      state.online = navigator.onLine;
      window.addEventListener('online', () => networkChanged(true));
      window.addEventListener('offline', () => networkChanged(false));
      // #endif
      state.notice = local.storageNotice || '';
      state.ready = true;
    } catch (error) {
      handleError(error);
      state.storageError = state.error;
      state.ready = true;
    }
  })());
}

/** 仅在本机资料未能打开时重试，不删除缓存、不重建已有台账 */
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
  void synchronize().catch(handleError);
}

export function stopForeground() {
  if (timer) clearInterval(timer);
  timer = undefined;
  runner.pause();
  api.abortUploads();
}

export async function checkConnection() {
  if (!state.local) throw new Error('本机存储尚未就绪');
  const endpoint = resolveEndpoint(state.local.settings.endpoint);
  backend.configureBackend(endpoint);
  await backend.probe();
  const result = backend.connectionOf(state.local.settings.projectName || '风电施工现场管理');
  try {
    const channel = await backend.channel();
    if (channel?.scope) {
      result.scope = channel.scope;
      if (channel.name) result.projectName = channel.name;
    }
  } catch {
    /* 未登录或服务端未配置项目时保留派生值兜底 */
  }
  state.connection = result;
  await repository.mutate((local) => {
    local.settings.endpoint = endpoint;
    local.settings.connection = result;
    local.settings.projectName = result.projectName;
  });
  await reload();
  return result;
}

/** 登录：账号密码与验证码交给后端校验，身份与角色取账号资料里的 roles */
export async function signIn(
  username: string,
  password: string,
  captcha: { id: string; code: string },
) {
  state.error = '';
  await initialize();
  if (!state.local)
    throw new Error(state.storageError || '本机资料尚未打开，请重新读取本机资料；不要清理缓存');
  if (!captcha?.id || !captcha.code.trim()) throw new Error('请输入验证码');
  const connection = await checkConnection();
  await backend.login(username, password, captcha.id, captcha.code);
  const account = await backend.profile();
  const user = backend.toUser(account);
  await repository.mutate((local) => {
    local.settings.identity = {
      user,
      instance: connection.instance,
      endpoint: local.settings.endpoint,
      until: Date.now() + 7 * 86400000,
    };
    local.settings.projectName = connection.projectName;
    // 同账号同实例：接续旧版本未标记实例的本机任务
    for (const row of local.entries)
      if (row.owner === user.id && !row.instance) row.instance = connection.instance;
  });
  state.user = user;
  state.connection = connection;
  state.authenticated = true;
  await alignProject();
  uni.hideToast();
  await reload();
  uni.switchTab({ url: '/pages/home/index' });
}

/** 登录后对齐服务端项目：只认后台分配给自己的项目，多项目时沿用上次选的那个 */
async function alignProject() {
  try {
    const projects = await api.getProjects();
    state.projects = projects;
    if (!projects.length) {
      await applyProject(null);
      state.notice =
        '你还没有被加入任何项目。请联系管理员在后台「风电施工 → 项目管理」中把你的账号加为项目成员，然后再下拉刷新。';
      return;
    }
    const remembered = state.local?.settings.project?.id;
    const project = projects.find((item) => item.id === remembered) || projects[0];
    state.notice = '';
    await applyProject(project);
  } catch {
    /* 服务端未配置项目时保留本机兜底，不影响离线填报 */
  }
}

/** 切换/落地当前项目：项目信息、通道 scope、字典与事项都要跟着换 */
async function applyProject(project: Project | null) {
  state.project = project;
  await repository.mergeProject(project);
  if (!project || !state.connection) {
    await reload();
    return;
  }
  const connection: Connection = {
    ...state.connection,
    scope: project.scope,
    projectName: project.name,
  };
  state.connection = connection;
  await repository.mutate((local) => {
    local.settings.connection = connection;
    local.settings.projectName = project.name;
  });
  await refreshDict();
  await refreshUnits();
}

/** 手动切换项目（APP 里属于多个项目时使用） */
export async function switchProject(id: number) {
  const project = state.projects.find((item) => item.id === id);
  if (!project || project.id === state.project?.id) return;
  state.busy = true;
  try {
    await applyProject(project);
    await reload();
    toast(`已切换到 ${project.name}`);
  } finally {
    state.busy = false;
  }
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
  uni.switchTab({ url: '/pages/home/index' });
}

export async function signOut() {
  uni.hideToast();
  runner.pause();
  api.abortUploads();
  try {
    if (backend.hasSession()) await backend.logout();
  } catch {
    /* 后端不可达时也要清掉本地登录态，避免卡在登录页无法切换账号 */
  } finally {
    backend.clearSession();
  }
  await repository.mutate((local) => {
    delete local.settings.identity;
  });
  state.user = null;
  state.authenticated = false;
  state.ledger = null;
  state.directory = null;
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

/** 台账只对项目负责人/管理员开放，移动端按角色先挡一层，最终由服务端判定 */
export function requireManager() {
  if (!requireUser()) return false;
  if (state.user?.role !== 'admin') {
    toast('仅项目负责人可查看工作台账');
    uni.switchTab({ url: '/pages/home/index' });
    return false;
  }
  return true;
}

export async function refreshDict(force = false) {
  if (!state.authenticated || !backend.hasSession() || !state.online) return;
  const stale = !state.dict || Date.now() - Date.parse(state.dict.at) > 12 * 3600 * 1000;
  if (!force && !stale) return;
  try {
    const dict = await api.getDict();
    await repository.mergeDict(dict);
    state.dict = dict;
  } catch {
    /* 字典失败不阻塞填报，界面用缓存 */
  }
}

export async function refreshUnits() {
  if (!state.project || !state.authenticated || !backend.hasSession()) return;
  state.refreshing = true;
  try {
    const result = await api.getUnits(state.project.id);
    await repository.mergeUnits(result.items);
    await reload();
  } catch (error: any) {
    // 1515：已被管理员移出项目。清掉本机项目视图，避免继续对着旧项目填报
    if (Number(error?.code) === 1515) {
      await applyProject(null);
      state.notice = '你已不在该项目的成员名单中，请联系管理员重新分配项目。';
      return;
    }
    throw error;
  } finally {
    state.refreshing = false;
  }
}

export async function loadUnit(id: string) {
  const detail = await api.getUnitDetail(id);
  await repository.mergeUnitDetail(detail.unit, detail.steps);
  if (state.user && state.connection)
    await repository.mergeServerEntries(detail.entries, state.user.id, state.connection.instance);
  await reload();
  return detail;
}

export async function createUnit(payload: {
  typeCode: string;
  code: string;
  name?: string;
  location?: string;
}) {
  if (!state.project) throw new Error('尚未获取项目信息，请联网登录后再建事项');
  const unit = await api.createUnit({
    id: cryptoRandomId(),
    projectId: state.project.id,
    ...payload,
  });
  await refreshUnits();
  return unit;
}

/** UUID 由前端生成，服务端以此做主键，离线新建也能保证幂等 */
function cryptoRandomId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const n = Math.floor(Math.random() * 16);
    return (char === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

export async function updateStep(unitId: string, stepCode: string, status: string, remark = '') {
  await api.setStep(unitId, stepCode, status, remark);
  await loadUnit(unitId);
}

/** 默认施工内容类型：按工序关键字推断，减少现场选择成本 */
export function typeForStep(stepCode?: string | null) {
  const dict = state.dict;
  const fallback = dict?.entryTypes[0]?.code || 'other';
  if (!stepCode) return fallback;
  const rules: [RegExp, string][] = [
    [/foundation/, 'foundation'],
    [/anchor|tower|nacelle|blade|hoist/, 'lifting'],
    [/transport|deliver/, 'transport'],
    [/assemble|assembly|install/, 'assembly'],
    [/cable|wiring|electric/, 'electrical'],
    [/commission|debug|test/, 'commissioning'],
  ];
  const hit = rules.find(([pattern]) => pattern.test(stepCode))?.[1];
  return dict?.entryTypes.some((item) => item.code === hit) ? hit! : fallback;
}

export async function newEntry(unitId: string, stepCode = '') {
  if (!state.user || !state.connection) throw new Error('请先登录项目账号');
  const unit = unitById(unitId);
  if (!unit) throw new Error('事项信息未同步，请回到事项列表刷新');
  const draft = await repository.createEntry(
    state.user.id,
    state.connection.instance,
    unit,
    stepCode,
    typeForStep(stepCode),
  );
  await reload();
  uni.navigateTo({ url: '/pages/report/index?id=' + draft.id });
}

export function findEntry(id: string) {
  return myEntries().find((row) => row.id === id);
}

export async function saveEntry(form: Entry) {
  await repository.saveForm(clone(form));
  await reload();
}

export async function addEntryPhotos(
  entry: Entry,
  files: Awaited<ReturnType<typeof choosePhotos>>,
) {
  try {
    for (const file of files) {
      const photo = await persistPhoto(file);
      try {
        await repository.addAttachment(entry.id, entry.owner, entry.instance, photo);
      } catch (error) {
        await removePhotoFile(photo).catch(() => {});
        throw error;
      }
    }
  } finally {
    await reload();
  }
}

export async function removeEntryPhoto(entry: Entry, attachmentId: string) {
  const target = entry.attachments.find((item) => item.id === attachmentId);
  await repository.update(entry.id, entry.owner, entry.instance, (record) => {
    if (!canEdit(record)) throw new Error('上传中的附件不能删除');
    record.attachments = record.attachments.filter((item) => item.id !== attachmentId);
    record.revision++;
  });
  if (target) await removePhotoFile(target).catch(() => {});
  await reload();
}

/** 提交单条：入队后立刻尝试上传，离线则保留为待上传 */
export async function submitEntry(entry: Entry) {
  const message = validateEntry(entry);
  if (message) throw new Error(message);
  await saveEntry(entry);
  await runner.enqueue(entry.id, entry.owner, entry.instance);
  await reload();
  if (state.online && state.authenticated) await runner.run(entry.owner, entry.instance, true, { ids: [entry.id], force: true });
  else toast(state.online ? '已保存待上传，登录后继续' : '已离线保存，恢复网络后继续上传');
}

/** 批量上传：一次把全部待上传（或指定若干条）推进队列 */
export async function uploadAll(ids?: string[]) {
  if (!state.user || !state.connection) throw new Error('请先登录项目账号');
  const target = ids?.length ? ids : pendingEntries().filter((row) => row.status !== 'uploading').map((row) => row.id);
  if (!target.length) {
    toast('没有待上传的记录');
    return;
  }
  if (!state.online) {
    toast('当前离线，联网后会自动继续');
    return;
  }
  if (!state.authenticated) throw new Error('请先联网登录后再上传');
  await runner.enqueueMany(target, state.user.id, state.connection.instance);
  await reload();
  await runner.run(state.user.id, state.connection.instance, true, { ids: target, force: true });
}

export async function retryEntry(entry: Entry) {
  await runner.enqueue(entry.id, entry.owner, entry.instance);
  await reload();
  await runner.run(entry.owner, entry.instance, state.online, { ids: [entry.id], force: true });
}

export function pauseUpload() {
  runner.pause();
  toast('已暂停，剩余任务保留在本机');
}

export async function deleteEntry(entry: Entry) {
  const attachments = await repository.remove(entry.id, entry.owner, entry.instance);
  for (const attachment of attachments) await removePhotoFile(attachment).catch(() => {});
  await reload();
}

/** 同步：先跑上传队列，再拉本人记录回填审核状态 */
export async function synchronize(force = false) {
  if (!state.user || !state.connection || !state.online || !api.hasSession()) return;
  if (refreshing) return;
  refreshing = true;
  state.busy = true;
  const user = state.user;
  const instance = state.connection.instance;
  try {
    const connection = await checkConnection();
    if (connection.instance !== instance) {
      api.clearSession();
      throw new Error('服务实例已变化，请重新登录核实项目');
    }
    if (!state.project) await alignProject();
    else if (connection.scope !== state.project.scope)
      // 通道探测可能拿到别的项目 scope，这里以当前选中的项目为准，避免传错项目
      state.connection = { ...connection, scope: state.project.scope, projectName: state.project.name };
    await refreshDict();
    await runner.run(user.id, instance, true, { force });
    if (!api.hasSession() || state.user?.id !== user.id) return;
    const result = await api.getMine();
    await repository.mergeServerEntries(result.entries, user.id, instance);
    state.lastSync = result.serverTime || new Date().toISOString();
    state.error = '';
    await reload();
    if (state.project) await refreshUnits();
    if (state.user?.role === 'admin' && state.project) await refreshLedger();
  } finally {
    state.busy = false;
    refreshing = false;
    state.authenticated = api.hasSession();
  }
}

export async function refreshLedger() {
  if (state.ledgerBusy || state.user?.role !== 'admin' || !state.project) return;
  if (!state.authenticated || !backend.hasSession()) {
    state.ledgerError = '请联网登录后查看项目工作台账';
    return;
  }
  if (!state.online) {
    state.ledgerError = state.ledger ? '当前离线，展示上次获取的台账' : '当前离线，联网后可获取台账';
    return;
  }
  state.ledgerBusy = true;
  try {
    state.ledger = await api.getLedger();
    state.ledgerError = '';
  } catch (error: any) {
    state.ledgerError = error.message || '项目台账暂时无法获取';
  } finally {
    state.ledgerBusy = false;
  }
}

export async function refreshDirectory() {
  if (state.directoryBusy || state.user?.role !== 'admin') return;
  if (!state.online || !state.authenticated || !backend.hasSession()) {
    state.directoryError = '请联网登录后查看用户信息';
    return;
  }
  state.directoryBusy = true;
  try {
    state.directory = await backend.directory();
    state.directoryError = '';
  } catch (error: any) {
    state.directoryError = error.message || '用户信息暂时无法读取';
  } finally {
    state.directoryBusy = false;
  }
}

export async function setEndpoint(value: string) {
  backend.configureBackend(resolveEndpoint(value));
  backend.clearSession();
  runner.pause();
  clearPreviews();
  await repository.mutate((local) => {
    local.settings.endpoint = value.trim().replace(/\/$/, '');
    delete local.settings.connection;
    delete local.settings.identity;
    delete local.settings.project;
  });
  state.user = null;
  state.connection = null;
  state.project = null;
  state.ledger = null;
  state.directory = null;
  await reload();
}

/** 记录所属工序名称，供列表/详情展示 */
export const stepName = (row: Entry) => stepNameOf(unitById(row.unitId), row.stepCode, state.dict || undefined);
