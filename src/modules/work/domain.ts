/** 业务模型与平台无关：施工日期用于分类归档，提交时间用于工作动态排序。 */
export const constructionTypes = [
  {
    id: 'foundation',
    name: '风机基础施工',
    short: '风机基础',
    icon: 'foundation',
  },
  { id: 'road', name: '道路施工', short: '道路施工', icon: 'road' },
  { id: 'lifting', name: '风机吊装', short: '风机吊装', icon: 'turbine' },
  { id: 'collector', name: '集电线路施工', short: '集电线路', icon: 'power' },
  { id: 'substation', name: '升压站施工', short: '升压站', icon: 'station' },
  { id: 'transport', name: '风机运输', short: '风机运输', icon: 'truck' },
  { id: 'other', name: '其他', short: '其他', icon: 'grid' },
] as const;
export type WorkType = (typeof constructionTypes)[number]['id'];
export type WorkStatus = 'draft' | 'queued' | 'uploading' | 'failed' | 'submitted';
export interface Photo {
  id: string;
  key: string;
  name: string;
  mime: string;
  size: number;
  remoteId?: string;
  remoteScope?: string;
}
export interface WorkRecord {
  id: string;
  owner: string;
  instance?: string;
  type: WorkType | '';
  date: string;
  location: string;
  content: string;
  photos: Photo[];
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  serverId?: string;
  reviewStatus?: string;
  error?: string;
  scope?: string;
  revision: number;
  attempts?: number;
  nextRetryAt?: number;
}
export interface User {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'worker';
  /** 以下字段来自 nest-admin 账号资料，缺失时界面按空值处理。 */
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
  expiresAt?: string;
  registrationOpen: boolean;
  integration?: 'desktop' | 'manual' | 'trial';
  syncStatus?: 'ready' | 'unavailable' | 'trial';
}
export interface RegistrationDetails {
  name: string;
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
export interface OfflineIdentity {
  user: User;
  instance: string;
  endpoint: string;
  until: number;
}
export interface LocalState {
  version: 1;
  records: WorkRecord[];
  settings: {
    endpoint: string;
    projectName: string;
    deviceOwner: string;
    connection?: Connection;
    identity?: OfflineIdentity;
  };
  storageNotice?: string;
}
export const MAX_PHOTOS = 10;
export const MAX_BYTES = 20 * 1024 * 1024;
export const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
export const scopePattern = /^[a-f\d]{64}$/;
export const statusNames: Record<WorkStatus, string> = {
  draft: '草稿',
  queued: '待上传',
  uploading: '上传中',
  failed: '需重试',
  submitted: '已提交',
};
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// UUID 只用于本机记录/请求幂等，不作为密码、会话或权限凭证；鉴权令牌由服务端安全生成。
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
export const typeName = (id: string) =>
  constructionTypes.find((row) => row.id === id)?.name || '未选择类型';
export const canEdit = (row: WorkRecord) =>
  row.status !== 'submitted' &&
  row.status !== 'uploading' &&
  !row.photos.some((photo) => photo.remoteId);
export const belongs = (row: WorkRecord, owner: string, instance: string) =>
  row.owner === owner && row.instance === instance;
export function freshState(): LocalState {
  return {
    version: 1,
    records: [],
    settings: {
      endpoint: '',
      projectName: '风电施工现场管理',
      deviceOwner: 'device-' + uuid(),
    },
  };
}
export function draft(owner: string, instance: string, type: WorkRecord['type'] = ''): WorkRecord {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    owner,
    instance,
    type,
    date: localDate(),
    location: '',
    content: '',
    photos: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}
export function validateRecord(row: WorkRecord) {
  if (!constructionTypes.some((type) => type.id === row.type)) return '请选择施工类型';
  if (!validDate(row.date)) return '请选择有效的施工日期';
  if (!row.location.trim() || row.location.trim().length > 120) return '请填写施工地点，最多120字';
  if (!row.content.trim() || row.content.trim().length > 2000) return '请填写施工说明，最多2000字';
  if (!row.photos.length || row.photos.length > MAX_PHOTOS) return '请添加1—10张施工照片';
  if (row.photos.some((photo) => !photo.size || photo.size > MAX_BYTES))
    return '单张照片不能超过20 MB';
  return '';
}
export function validateState(value: unknown): LocalState {
  const state = value as LocalState;
  if (
    state?.version !== 1 ||
    !state.settings?.deviceOwner ||
    !Array.isArray(state.records) ||
    state.records.some(
      (row) =>
        !uuidPattern.test(row.id) || typeof row.owner !== 'string' || !Array.isArray(row.photos),
    )
  )
    throw new Error('本机台账读取异常，请勿清除应用数据；原资料未覆盖');
  return state;
}
export function formatTime(value?: string) {
  if (!value) return '尚未提交';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间待确认';
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function normalizeEndpoint(value: string, browser = false) {
  if (!value.trim()) {
    if (browser) return '/api/mobile/v1';
    throw new Error('请先配置项目服务地址');
  }
  const match = /^(https?):\/\/([^/?#]+)(\/api\/mobile\/v1\/?)?\/?$/i.exec(value.trim());
  if (!match || /[@\s]/.test(match[2]))
    throw new Error('请输入服务器根地址，例如 https://项目服务域名');
  const host = match[2].split(':')[0];
  const privateHost =
    /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      host,
    );
  if (match[1] !== 'https' && !privateHost) throw new Error('外部服务必须使用 HTTPS 地址');
  return `${match[1]}://${match[2]}/api/mobile/v1`;
}
/** A/B 快照检测意外损坏；这是完整性校验，不是身份认证。 */
export function checksum(value: string) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0).toString(16);
}
