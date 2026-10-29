/**
 * 业务接口适配层：只负责调用 nest-admin 的 /mobile 接口并校验回执，
 * 会话、地址与错误封装统一由 backend.ts 处理。
 */
import {
  uuidPattern,
  type Attachment,
  type Connection,
  type Dict,
  type Entry,
  type Project,
  type Unit,
  type UnitStep,
} from './domain';
import { localPhotoUrl } from '../platform/media';
import * as backend from './backend';

export const ApiError = backend.ApiError;
export const hasSession = backend.hasSession;
export const clearSession = backend.clearSession;
export const configureApi = backend.configureBackend;
/** uni.uploadFile 不提供统一的中止句柄，保留空实现兼容调用方 */
export const abortUploads = () => {};

export async function getConnection(): Promise<Connection> {
  return backend.connectionOf();
}

interface ServerAttachment {
  id: string;
  kind: Attachment['kind'];
  name: string;
  mime: string;
  size: number;
  url?: string;
  takenAt?: string;
}

interface ServerEntry {
  id: string;
  serverId?: string;
  code: string;
  unitId: string;
  unitCode?: string;
  unitName?: string;
  stepCode?: string | null;
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
  reviewStatus?: string;
  reviewStatusCode?: string;
  reviewRemark?: string;
  submittedAt?: string;
  updatedAt?: string;
  attachments?: ServerAttachment[];
}

/** 服务端记录 -> 本机记录（已提交） */
function toEntry(remote: ServerEntry): Entry {
  return {
    id: remote.id,
    serverId: remote.serverId || remote.id,
    code: remote.code,
    unitId: remote.unitId,
    unitCode: remote.unitCode || '',
    unitName: remote.unitName || '',
    stepCode: remote.stepCode || null,
    typeCode: remote.typeCode,
    title: remote.title,
    content: remote.content || '',
    workDate: remote.workDate,
    occurredAt: remote.occurredAt,
    location: remote.location || '',
    longitude: remote.longitude ?? null,
    latitude: remote.latitude ?? null,
    weather: remote.weather || '',
    temperature: remote.temperature ?? null,
    status: 'submitted',
    reviewStatus: remote.reviewStatus,
    reviewStatusCode: (remote.reviewStatusCode as Entry['reviewStatusCode']) || 'pending',
    reviewRemark: remote.reviewRemark || '',
    submittedAt: remote.submittedAt,
    updatedAt: remote.updatedAt || remote.submittedAt || new Date().toISOString(),
    createdAt: remote.submittedAt || remote.updatedAt || new Date().toISOString(),
    attachments: (remote.attachments || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      mime: item.mime,
      size: item.size,
      key: '',
      remoteId: item.id,
    })),
    revision: 1,
    owner: '',
    instance: '',
  };
}

export const toEntries = (list: ServerEntry[]) => list.map(toEntry);

/** 字典：事项类型 + 施工内容类型 + 工序模板 */
export async function getDict(): Promise<Dict> {
  const result = await backend.request<Omit<Dict, 'at'>>('/mobile/dict');
  if (!Array.isArray(result?.unitTypes) || !Array.isArray(result?.entryTypes))
    throw new ApiError('字典回执异常，请稍后重试');
  return {
    unitTypes: result.unitTypes,
    entryTypes: result.entryTypes,
    steps: Array.isArray(result.steps) ? result.steps : [],
    at: new Date().toISOString(),
  };
}

/** 我参与的项目 */
export async function getProjects(): Promise<Project[]> {
  const list = await backend.request<Project[]>('/mobile/projects');
  if (!Array.isArray(list)) throw new ApiError('项目回执异常，请稍后重试');
  return list;
}

export async function getUnits(projectId: number): Promise<{ items: Unit[]; total: number }> {
  const result = await backend.request<{ items?: Unit[]; total?: number }>(
    `/mobile/units?projectId=${projectId}&page=1&pageSize=100`,
  );
  if (!Array.isArray(result?.items)) throw new ApiError('事项列表回执异常，请稍后重试');
  return { items: result.items, total: result.total || result.items.length };
}

export async function getUnitDetail(id: string) {
  const result = await backend.request<{
    unit: Unit;
    steps: UnitStep[];
    entries: ServerEntry[];
  }>(`/mobile/units/${id}`);
  if (!result?.unit?.id) throw new ApiError('事项详情回执异常，请稍后重试');
  return {
    unit: { ...result.unit, steps: result.steps || [] },
    steps: result.steps || [],
    entries: toEntries(result.entries || []),
  };
}

export async function createUnit(payload: {
  id: string;
  projectId: number;
  typeCode: string;
  code: string;
  name?: string;
  location?: string;
}) {
  const result = await backend.request<Unit>('/mobile/units', { method: 'POST', data: payload });
  if (!result?.id) throw new ApiError('新建事项回执异常，请稍后重试');
  return result;
}

export async function setStep(unitId: string, stepCode: string, status: string, remark = '') {
  const result = await backend.request<UnitStep[]>(
    `/mobile/units/${unitId}/steps/${stepCode}`,
    { method: 'PUT', data: { status, remark } },
  );
  if (!Array.isArray(result)) throw new ApiError('工序回执异常，请稍后重试');
  return result;
}

/** 提交记录：客户端 UUID 幂等，重复提交返回同一回执 */
export async function submitEntry(entry: Entry) {
  const result = await backend.request<{
    id: string;
    serverId: string;
    code: string;
    createdAt: string;
    reviewStatus: string;
    reviewStatusCode: string;
  }>('/mobile/entries', {
    method: 'POST',
    data: {
      id: entry.id,
      unitId: entry.unitId,
      typeCode: entry.typeCode,
      stepCode: entry.stepCode || undefined,
      title: entry.title.trim(),
      content: entry.content.trim(),
      workDate: entry.workDate,
      occurredAt: entry.occurredAt,
      location: entry.location,
      longitude: entry.longitude ?? undefined,
      latitude: entry.latitude ?? undefined,
      weather: entry.weather,
      temperature: entry.temperature ?? undefined,
      attachmentIds: entry.attachments
        .map((item) => item.remoteId)
        .filter((id): id is string => Boolean(id)),
      clientCreatedAt: entry.createdAt,
    },
  });
  if (result?.id !== entry.id || !uuidPattern.test(result.serverId || ''))
    throw new ApiError('提交回执不完整，请继续核实；不会重复发布');
  return result;
}

/** 本人已提交记录（增量同步用） */
export async function getMine(updatedAfter?: string) {
  const query = updatedAfter ? `?limit=500&updatedAfter=${encodeURIComponent(updatedAfter)}` : '?limit=500';
  const result = await backend.request<{ entries?: ServerEntry[]; serverTime?: string }>(
    `/mobile/entries/mine${query}`,
  );
  if (!Array.isArray(result?.entries)) throw new ApiError('记录同步回执异常，本机数据未覆盖');
  return { entries: toEntries(result.entries), serverTime: result.serverTime || '' };
}

export async function getPending() {
  const result = await backend.request<{ items?: ServerEntry[]; total?: number }>(
    '/mobile/entries/pending?pageSize=100',
  );
  return { items: toEntries(result?.items || []), total: result?.total || 0 };
}

export async function reviewEntry(id: string, action: 'approve' | 'reject', remark = '') {
  const result = await backend.request<{ reviewStatus: string; reviewStatusCode: string }>(
    `/mobile/entries/${id}/review`,
    { method: 'PUT', data: { action, remark } },
  );
  return result;
}

/** 附件上传：X-File-Meta 携带元数据，onProgressUpdate 提供逐张进度 */
export async function uploadAttachment(
  entry: Entry,
  attachment: Attachment,
  progress: (value: number) => void,
) {
  const token = backend.currentToken();
  const filePath = await localPhotoUrl(attachment);
  // 读大图期间可能退出/切换账号，禁止迟到的任务借用新账号令牌提交原账号资料。
  if (!token || token !== backend.currentToken())
    throw new backend.ApiError('登录状态已变化，请重新登录后继续原任务', 401);

  const metadata = encodeURIComponent(
    JSON.stringify({
      id: attachment.id,
      unitId: entry.unitId,
      kind: attachment.kind,
      name: attachment.name,
      takenAt: entry.occurredAt,
      longitude: entry.longitude ?? undefined,
      latitude: entry.latitude ?? undefined,
    }),
  );

  return new Promise<{ id: string; reused: boolean }>((resolve, reject) => {
    const task = uni.uploadFile({
      url: `${backend.currentBase()}/mobile/attachments`,
      filePath,
      name: 'file',
      timeout: 180000,
      header: { Authorization: 'Bearer ' + token, 'X-File-Meta': metadata },
      success: (response) => {
        try {
          const value = JSON.parse(response.data) as {
            code?: number;
            message?: string;
            data?: { id?: string; reused?: boolean };
          };
          if (response.statusCode < 200 || response.statusCode >= 300)
            throw new backend.ApiError(
              value?.message || '附件上传未完成',
              response.statusCode,
              Number(value?.code) || 0,
            );
          if (!value?.data?.id) throw new backend.ApiError(value?.message || '附件回执无效');
          resolve({ id: value.data.id, reused: Boolean(value.data.reused) });
        } catch (error) {
          reject(error);
        }
      },
      fail: () => reject(new backend.ApiError('上传中断，已完成的附件保留，稍后继续')),
    });
    // 部分平台不返回 task，进度回调可缺省
    task?.onProgressUpdate?.((event: { progress: number }) => {
      progress(Math.min(99, Math.max(1, Math.round(event.progress || 0))));
    });
  });
}

export async function getLedger(query = '') {
  const result = await backend.request<any>(`/mobile/admin/ledger${query}`);
  if (!result?.summary || !Array.isArray(result.units) || !Array.isArray(result.entries))
    throw new ApiError('项目台账回执异常，请刷新重试');
  return result;
}

export async function getDashboard() {
  return backend.request<any>('/mobile/dashboard');
}

export async function remoteAttachmentUrl(attachment: Attachment) {
  const id = attachment.remoteId;
  if (!id || !uuidPattern.test(id) || !backend.hasSession())
    throw new Error('请联网登录后查看服务器附件');
  return new Promise<string>((resolve, reject) =>
    uni.downloadFile({
      url: `${backend.currentBase()}/mobile/attachments/${id}`,
      header: { Authorization: 'Bearer ' + backend.currentToken() },
      timeout: 30000,
      success: (value) =>
        value.statusCode === 200
          ? resolve(value.tempFilePath)
          : reject(new Error('附件无法读取，请核对登录状态')),
      fail: reject,
    }),
  );
}
