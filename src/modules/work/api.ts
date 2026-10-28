import {
  normalizeEndpoint,
  scopePattern,
  uuidPattern,
  type Connection,
  type RegistrationDetails,
  type DirectoryUser,
  type Photo,
  type User,
  type WorkRecord,
} from './domain';
import { localPhotoUrl } from '../platform/media';
import type { LedgerSnapshot } from './ledger';
let endpoint = '',
  bearer = '';
const tasks = new Set<{ abort(): void }>();
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export const hasSession = () => Boolean(bearer);
export const clearSession = () => {
  bearer = '';
  abortUploads();
};
export const abortUploads = () => {
  for (const task of tasks) task.abort();
  tasks.clear();
};
export function configureApi(value: string) {
  let browser = false;
  // #ifdef H5
  browser = true;
  // #endif
  const next = normalizeEndpoint(value, browser);
  if (endpoint !== next) clearSession();
  endpoint = next;
}
export function request<T>(path: string, data?: object): Promise<T> {
  if (!endpoint) return Promise.reject(new ApiError('请先配置项目服务地址'));
  const token = bearer;
  return new Promise((resolve, reject) => {
    const task = uni.request({
      url: endpoint + path,
      method: data === undefined ? 'GET' : 'POST',
      data,
      timeout: 20000,
      header: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
      },
      success: (response) => {
        const value = response.data as any;
        if (response.statusCode === 401 && bearer === token) bearer = '';
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const status = response.statusCode;
          // 预览代理在后台停止时可能返回空的500，不能只显示无从排查的“请求未完成”。
          // 保留后端的业务错误；没有业务回执时，给出对应的服务检查方向，不显示HTML或请求凭据。
          const fallback = [500, 502, 503, 504].includes(status)
            ? `手机后台服务暂时不可用（HTTP ${status}），请启动手机服务后重试`
            : status === 404 || status === 405
              ? `未找到手机服务接口（HTTP ${status}），请检查项目服务地址`
              : `手机服务返回异常（HTTP ${status}），请检查项目服务连接`;
          return reject(new ApiError(value?.error || fallback, status));
        }
        if (!value || typeof value !== 'object') return reject(new ApiError('服务器回执格式异常'));
        resolve(value as T);
      },
      fail: () => reject(new ApiError('服务暂时无法连接，本机记录仍保留')),
      complete: () => {
        tasks.delete(task);
      },
    });
    tasks.add(task);
  });
}
export async function getConnection() {
  const result = await request<Connection>('/config');
  if (
    result.service !== 'wind-field-mobile' ||
    !scopePattern.test(result.scope) ||
    !scopePattern.test(result.instance) ||
    !['trial', 'linked'].includes(result.mode)
  )
    throw new ApiError('该地址不是本项目的移动端服务');
  return result;
}
export async function login(
  username: string,
  password: string,
  register = false,
  role?: User['role'],
  details?: RegistrationDetails,
) {
  const result = await request<{
    user: User;
    token: string;
    offlineUntil?: number;
  }>(register ? '/auth/register' : '/auth/login', {
    username: username.trim(),
    password,
    ...(role === undefined ? {} : { role }),
    ...(register && details ? details : {}),
  });
  if (
    !uuidPattern.test(result.user?.id) ||
    !/^[a-f\d]{64}$/.test(result.token) ||
    !['admin', 'worker'].includes(result.user.role)
  )
    throw new ApiError('登录回执异常');
  bearer = result.token;
  return result;
}
export async function getDirectory() {
  const result = await request<{ users: DirectoryUser[]; generatedAt: string }>('/admin/users');
  if (
    !Array.isArray(result.users) ||
    result.users.some(
      (user) => !uuidPattern.test(user.id) || !['admin', 'worker'].includes(user.role),
    )
  )
    throw new ApiError('用户资料回执异常');
  return result;
}
export async function logout() {
  try {
    await request('/auth/logout', {});
  } finally {
    clearSession();
  }
}
export async function uploadPhoto(
  row: WorkRecord,
  photo: Photo,
  progress: (value: number) => void,
) {
  const token = bearer,
    target = endpoint;
  const filePath = await localPhotoUrl(photo);
  // 读大图期间可能退出/切换账号，禁止迟到的任务借用新账号令牌提交原账号资料。
  if (!token || token !== bearer || target !== endpoint)
    throw new ApiError('登录状态已变化，请重新登录后继续原任务', 401);
  const metadata = encodeURIComponent(
    JSON.stringify({
      id: photo.id,
      recordId: row.id,
      module: row.type,
      date: row.date,
      location: row.location.trim(),
      name: photo.name,
      description: row.content.slice(0, 500),
    }),
  );
  return new Promise<{ id: string; scope: string }>((resolve, reject) => {
    const task = uni.uploadFile({
      url: target + '/photos',
      filePath,
      name: 'file',
      timeout: 120000,
      header: { Authorization: 'Bearer ' + token, 'X-File-Meta': metadata },
      success: (response) => {
        try {
          const value = JSON.parse(response.data);
          if (response.statusCode === 401 && bearer === token) bearer = '';
          if (response.statusCode < 200 || response.statusCode >= 300)
            throw new ApiError(value.error || '照片上传未完成', response.statusCode);
          if (!uuidPattern.test(value.id) || !scopePattern.test(value.scope))
            throw new ApiError('照片回执无效，请重试核实');
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      fail: () => reject(new ApiError('照片上传中断，已完成的照片保留，稍后继续')),
      complete: () => {
        tasks.delete(task);
      },
    });
    tasks.add(task);
    task.onProgressUpdate((event) => progress(Math.min(95, event.progress)));
  });
}
export async function submitRecord(row: WorkRecord) {
  const result = await request<{
    id: string;
    serverId: string;
    createdAt: string;
    reviewStatus: string;
  }>('/reports', {
    id: row.id,
    type: row.type,
    date: row.date,
    location: row.location.trim(),
    content: row.content.trim(),
    photoIds: row.photos.map((photo) => photo.remoteId),
  });
  if (
    result.id !== row.id ||
    !uuidPattern.test(result.serverId) ||
    !Number.isFinite(Date.parse(result.createdAt)) ||
    !['已审核', '待审核', '退回修改'].includes(result.reviewStatus)
  )
    throw new ApiError('提交回执不完整，请继续核实；不会重复发布');
  return result;
}
export async function getReports() {
  const result = await request<{ reports: WorkRecord[]; deletedIds: string[] }>('/reports');
  if (
    !Array.isArray(result.reports) ||
    !Array.isArray(result.deletedIds) ||
    result.reports.some(
      (row) =>
        !uuidPattern.test(row.id) ||
        !uuidPattern.test(row.serverId || '') ||
        !scopePattern.test(row.scope || '') ||
        !Array.isArray(row.photos) ||
        row.photos.some(
          (photo) =>
            !uuidPattern.test(photo.remoteId || '') || !scopePattern.test(photo.remoteScope || ''),
        ),
    ) ||
    result.deletedIds.some((id) => !uuidPattern.test(id))
  )
    throw new ApiError('服务器台账格式异常，本机数据未覆盖');
  return result;
}
export async function getLedger() {
  const value = await request<LedgerSnapshot>('/admin/ledger');
  if (
    !scopePattern.test(value.scope) ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !['live', 'receipts'].includes(value.ledgerStatus) ||
    !Array.isArray(value.reports) ||
    value.reports.some(
      (row) =>
        !uuidPattern.test(row.id) ||
        !uuidPattern.test(row.owner) ||
        row.reporter?.id !== row.owner ||
        row.scope !== value.scope ||
        !uuidPattern.test(row.serverId || '') ||
        row.status !== 'submitted' ||
        !Array.isArray(row.photos) ||
        row.photos.some(
          (photo) => !uuidPattern.test(photo.remoteId || '') || photo.remoteScope !== value.scope,
        ),
    )
  )
    throw new ApiError('项目台账回执异常，请刷新重试');
  // 项目记录只读，不混入个人本机队列，也不把后台缓存路径当成手机持久文件。
  return {
    ...value,
    reports: value.reports.map((row) => ({
      ...row,
      photos: row.photos.map((photo) => ({ ...photo, key: '' })),
    })),
  };
}
export async function remotePhotoUrl(photo: Photo, management = false) {
  if (!uuidPattern.test(photo.remoteId || '') || !hasSession())
    throw new Error('请联网登录后查看服务器照片');
  return new Promise<string>((resolve, reject) =>
    uni.downloadFile({
      url: endpoint + (management ? '/admin/photos/' : '/photos/') + photo.remoteId,
      header: { Authorization: 'Bearer ' + bearer },
      timeout: 30000,
      success: (value) =>
        value.statusCode === 200
          ? resolve(value.tempFilePath)
          : reject(new Error('照片无法读取，请核对登录及审核状态')),
      fail: reject,
    }),
  );
}
