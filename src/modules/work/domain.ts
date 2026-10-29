/**
 * 业务模型（V2）：项目 → 事项/风机 → 施工记录 → 附件。
 * 与 nest-admin `/api/mobile/*` 接口字段一一对应，本机只做缓存与队列，不做业务裁决。
 */

/** 事项状态 */
export const unitStatusNames: Record<string, string> = {
  planning: '待施工',
  building: '施工中',
  paused: '已暂停',
  done: '已完成',
  canceled: '已取消',
};

/** 记录上传状态 */
export type EntryStatus = 'draft' | 'queued' | 'uploading' | 'failed' | 'submitted';

export const entryStatusNames: Record<EntryStatus, string> = {
  draft: '草稿',
  queued: '待上传',
  uploading: '上传中',
  failed: '需重试',
  submitted: '已提交',
};

/** 审核状态（服务端下发中文，枚举用于样式判断） */
export type ReviewCode = 'pending' | 'approved' | 'rejected';

export const reviewNames: Record<ReviewCode, string> = {
  pending: '待审核',
  approved: '已审核',
  rejected: '退回修改',
};

/** 工序状态 */
export const stepStatusNames: Record<string, string> = {
  pending: '待施工',
  doing: '进行中',
  done: '已完成',
  skipped: '已跳过',
};

export interface Project {
  id: number;
  code: string;
  name: string;
  scope: string;
  status: string;
  role: string;
  location?: string;
  capacityMw?: number | null;
  startDate?: string;
  endDate?: string;
}

export interface UnitType {
  code: string;
  name: string;
  icon?: string;
  codeLabel: string;
}

export interface EntryType {
  code: string;
  name: string;
  shortName?: string;
  icon?: string;
}

export interface StepTemplate {
  typeCode: string;
  code: string;
  name: string;
  sort: number;
  required: boolean;
}

export interface Dict {
  unitTypes: UnitType[];
  entryTypes: EntryType[];
  steps: StepTemplate[];
  /** 本地缓存时间，用于判断是否需要刷新 */
  at: string;
}

export interface UnitStep {
  stepCode: string;
  stepName: string;
  sort: number;
  status: string;
  doneAt?: string;
  doneBy?: number | null;
  remark?: string;
}

export interface Unit {
  id: string;
  projectId: number;
  typeCode: string;
  typeName: string;
  code: string;
  name: string;
  location: string;
  longitude?: number | null;
  latitude?: number | null;
  status: string;
  statusName: string;
  progress: number;
  startDate?: string;
  endDate?: string;
  remark?: string;
  doneSteps: number;
  totalSteps: number;
  entryCount: number;
  attachmentCount: number;
  lastEntryAt?: string;
  /** 详情接口带回的工序清单，离线也能看进度 */
  steps?: UnitStep[];
  updatedAt?: string;
}

export interface Attachment {
  id: string;
  kind: 'photo' | 'doc' | 'audio';
  name: string;
  mime: string;
  size: number;
  /** 本机持久文件路径；服务端台账照片为空 */
  key: string;
  /** 服务端回执 ID，为空表示尚未上传 */
  remoteId?: string;
}

export interface Entry {
  id: string;
  serverId?: string;
  code: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  stepCode?: string | null;
  stepName?: string;
  typeCode: string;
  title: string;
  content: string;
  workDate: string;
  occurredAt?: string;
  location?: string;
  longitude?: number | null;
  latitude?: number | null;
  weather?: string;
  temperature?: number | null;
  status: EntryStatus;
  reviewStatus?: string;
  reviewStatusCode?: ReviewCode;
  reviewRemark?: string;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  error?: string;
  attempts?: number;
  nextRetryAt?: number;
  revision: number;
  /** 所属账号与实例，仅本机使用 */
  owner: string;
  instance: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'worker';
  avatar?: string;
  deptName?: string;
  roles?: string[];
}

export interface Connection {
  service: string;
  instance: string;
  mode: 'trial' | 'linked';
  projectName: string;
  scope: string;
  registrationOpen: boolean;
  integration?: 'desktop' | 'manual' | 'trial';
}

export interface OfflineIdentity {
  user: User;
  instance: string;
  endpoint: string;
  until: number;
}

export interface DirectoryUser {
  id: string;
  name: string;
  memberNumber: string;
  role: User['role'];
  createdAt: string;
  active: boolean;
  records: number;
  photos: number;
  lastSubmittedAt: string;
}

export interface LocalState {
  version: 2;
  entries: Entry[];
  units: Unit[];
  dict?: Dict;
  settings: {
    endpoint: string;
    projectName: string;
    deviceOwner: string;
    connection?: Connection;
    identity?: OfflineIdentity;
    project?: Project;
  };
  storageNotice?: string;
}

/** 单条记录最多 20 张照片；与后端 ArrayMaxSize(20) 对齐 */
export const MAX_PHOTOS = 20;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_CONTENT = 2000;
export const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const n = Math.floor(Math.random() * 16);
    return (char === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function validDate(value: string) {
  const date = new Date(value + 'T12:00:00');
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    localDate(date) === value
  );
}

export function formatTime(value?: string) {
  if (!value) return '尚未提交';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间待确认';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(
    date.getDate(),
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

/** 相对时间：上传队列里比绝对时间更好读 */
export function relativeTime(value?: string) {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  return formatTime(value).slice(0, 10);
}

export const unitStatusName = (code: string) => unitStatusNames[code] || code;
export const stepStatusName = (code: string) => stepStatusNames[code] || code;

/** 是否还能编辑（已上传中的记录锁定，避免与服务端已收到的内容冲突） */
export const canEdit = (entry: Entry) =>
  entry.status !== 'submitted' && entry.status !== 'uploading';

/** 是否在待上传队列里 */
export const isPending = (entry: Entry) =>
  entry.status === 'queued' || entry.status === 'failed' || entry.status === 'uploading';

export const belongs = (entry: Entry, owner: string, instance: string) =>
  entry.owner === owner && entry.instance === instance;

export function freshState(): LocalState {
  return {
    version: 2,
    entries: [],
    units: [],
    settings: {
      endpoint: '',
      projectName: '风电施工现场管理',
      deviceOwner: 'device-' + uuid(),
    },
  };
}

/** 新建草稿：挂在具体事项（风机）下，默认选中该事项的第一道未完成工序 */
export function draftEntry(
  owner: string,
  instance: string,
  unit: Unit,
  stepCode = '',
  typeCode = 'other',
): Entry {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    code: '',
    unitId: unit.id,
    unitCode: unit.code,
    unitName: unit.name,
    stepCode: stepCode || null,
    typeCode,
    title: '',
    content: '',
    workDate: localDate(),
    occurredAt: now,
    location: unit.location || '',
    status: 'draft',
    attachments: [],
    createdAt: now,
    updatedAt: now,
    revision: 1,
    owner,
    instance,
  };
}

export function validateEntry(entry: Entry) {
  if (!entry.unitId) return '请选择所属事项/风机';
  if (!entry.typeCode) return '请选择施工内容类型';
  if (!entry.title.trim() || entry.title.trim().length > 120) return '请填写事项名称，最多120字';
  if (!validDate(entry.workDate)) return '请选择有效的施工日期';
  if (entry.content.length > MAX_CONTENT) return '施工说明最多2000字';
  if (entry.attachments.length > MAX_PHOTOS) return `最多上传${MAX_PHOTOS}个附件`;
  if (entry.attachments.some((item) => !item.size || item.size > MAX_PHOTO_BYTES))
    return '单个文件不能超过20 MB';
  return '';
}

/**
 * 兼容旧版本本机数据：V1 是「记录直接挂项目」的扁平结构，无法映射到新的事项层，
 * 因此只保留登录态与地址设置，旧记录单独标记并提示，绝不静默删除用户资料。
 */
export function migrateState(value: any): LocalState {
  if (value?.version === 2 && Array.isArray(value.entries) && Array.isArray(value.units))
    return value as LocalState;
  const state = freshState();
  if (value?.settings) {
    state.settings.endpoint = value.settings.endpoint || '';
    state.settings.projectName = value.settings.projectName || state.settings.projectName;
    state.settings.deviceOwner = value.settings.deviceOwner || state.settings.deviceOwner;
    state.settings.connection = value.settings.connection;
    state.settings.identity = value.settings.identity;
  }
  const legacy = Array.isArray(value?.records) ? value.records.length : 0;
  if (legacy)
    state.storageNotice = `检测到旧版扁平结构的 ${legacy} 条施工记录：新版按「项目 → 事项/风机 → 记录」管理，旧记录未自动迁移，请核对后重新登记。`;
  return state;
}

export function validateState(value: unknown): LocalState {
  const state = migrateState(value);
  if (
    state.settings === undefined ||
    !state.settings.deviceOwner ||
    !Array.isArray(state.entries) ||
    !Array.isArray(state.units) ||
    state.entries.some(
      (row) =>
        !uuidPattern.test(row.id) ||
        typeof row.owner !== 'string' ||
        !Array.isArray(row.attachments),
    )
  )
    throw new Error('本机台账读取异常，请勿清除应用数据；原资料未覆盖');
  return state;
}

/** 记录所属工序的名称：优先用事项工序清单，其次用字典模板 */
export function stepNameOf(unit: Unit | undefined, stepCode?: string | null, dict?: Dict) {
  if (!stepCode) return '';
  const fromUnit = unit?.steps?.find((step) => step.stepCode === stepCode)?.stepName;
  if (fromUnit) return fromUnit;
  return dict?.steps.find((step) => step.code === stepCode)?.name || stepCode;
}

/** A/B 快照检测意外损坏；这是完整性校验，不是身份认证。 */
export function checksum(value: string) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0).toString(16);
}
