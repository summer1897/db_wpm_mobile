/**
 * nest-admin 后端客户端。
 *
 * 与旧版「手机业务服务」不同，nest-admin 的接口契约是：
 *   - 统一包一层 { code, message, data }，业务成功时 code = 200（HTTP 可能是 201）
 *   - 登录 POST /auth/login { username, password, captchaId, verifyCode } -> { token }
 *   - 验证码 GET  /auth/captcha/img?width&height -> { id, img }，img 是 SVG 的 data URI
 *   - 账号 GET /account/profile -> { id, username, nickname, avatar, phone, roles[], dept }
 *   - 用户 GET /system/users?page&pageSize -> { items: [...] }
 * 密码校验、角色、权限全部由后端决定，移动端不再自行判断身份。
 */
import type { Connection, DirectoryUser, User } from './domain';

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 0,
  ) {
    super(message);
  }
}

export interface AccountProfile {
  id: number;
  username: string;
  nickname?: string;
  avatar?: string;
  phone?: string;
  email?: string;
  status?: number;
  createdAt?: string;
  roles?: { id?: number; name?: string; value?: string }[];
  dept?: { id?: number; name?: string } | null;
}

export interface Captcha {
  id: string;
  img: string;
}

/** 后端已提供施工记录/照片/台账接口，业务数据同步开关 */
export const supportsBusiness = true;

let root = '';
let bearer = '';

export const hasSession = () => Boolean(bearer);
export const currentToken = () => bearer;
export const currentRoot = () => root;
/** 请求基地址：留空地址时走同源 /api（由 vite 代理转发），与 request() 内的拼接保持一致 */
export const currentBase = () => root || '/api';
export const clearSession = () => {
  bearer = '';
};

/**
 * 只接受服务器根地址，允许附带 /api；内网地址可以用 http，公网必须是 https。
 * H5 传空串时走同源 /api（由 vite 代理转发），与旧版行为一致。
 */
export function normalizeRoot(value: string, browser = false) {
  const input = value.trim().replace(/\/+$/, '');
  if (!input) {
    if (browser) return '';
    throw new ApiError('请先配置服务器地址，例如 http://192.168.1.10:7001');
  }
  const match = /^(https?):\/\/([^/?#]+)(\/api)?$/i.exec(input);
  if (!match || /[@\s]/.test(match[2])) throw new ApiError('请输入服务器地址，例如 http://192.168.1.10:7001');
  const host = match[2].split(':')[0];
  const privateHost =
    /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      host,
    );
  if (match[1].toLowerCase() !== 'https' && !privateHost)
    throw new ApiError('公网服务器必须使用 HTTPS 地址');
  return `${match[1].toLowerCase()}://${match[2]}/api`;
}

export function configureBackend(value: string) {
  let browser = false;
  // #ifdef H5
  browser = true;
  // #endif
  const next = normalizeRoot(value, browser);
  if (next !== root) clearSession();
  root = next;
}

const url = (path: string) => `${root || '/api'}${path}`;

/** 业务请求统一入口：自动带 Bearer、解析 {code,message,data} 包裹、401 清会话 */
export function request<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; data?: object } = {},
) {
  const method = options.method || (options.data === undefined ? 'GET' : 'POST');
  const token = bearer;
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: url(path),
      method,
      data: options.data,
      timeout: 20000,
      header: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
      },
      success: (response) => {
        const status = response.statusCode;
        const body = response.data as any;
        const envelope = body && typeof body === 'object' && 'code' in body ? body : null;
        if (status === 401 || (envelope && [1101, 1105].includes(Number(envelope.code)))) {
          if (bearer === token) bearer = '';
          if (status === 401) return reject(new ApiError('登录状态已失效，请重新登录', 401, 401));
        }
        if (envelope) {
          if (Number(envelope.code) === 200) return resolve(envelope.data as T);
          return reject(
            new ApiError(
              envelope.message || `服务器返回异常（${envelope.code}）`,
              status,
              Number(envelope.code) || 0,
            ),
          );
        }
        if (status >= 200 && status < 300) return resolve(body as T);
        const fallback =
          status === 404
            ? '接口地址不存在（HTTP 404），请确认填写的是 nest-admin 服务地址'
            : status >= 500
              ? `服务器暂时不可用（HTTP ${status}），请稍后重试`
              : `请求未完成（HTTP ${status}）`;
        reject(new ApiError(fallback, status));
      },
      fail: () => reject(new ApiError('服务暂时无法连接，请检查服务器地址、端口与网络')),
      complete: () => {},
    });
  });
}

/** 验证码：SVG 的 data URI，H5 与 App 可直接用于 <image>。 */
export function loadCaptcha(): Promise<Captcha> {
  return request<Captcha>('/auth/captcha/img?width=110&height=44').then((result) => {
    if (!result?.id || !result?.img) throw new ApiError('验证码回执异常');
    return result;
  });
}

export async function login(username: string, password: string, captchaId: string, verifyCode: string) {
  const result = await request<{ token: string }>('/auth/login', {
    method: 'POST',
    data: { username: username.trim(), password, captchaId, verifyCode: verifyCode.trim() },
  });
  if (!result?.token || typeof result.token !== 'string') throw new ApiError('登录回执异常');
  bearer = result.token;
  return result.token;
}

export const profile = () => request<AccountProfile>('/account/profile');
export const permissions = () => request<string[]>('/account/permissions');
export const logout = () => request<void>('/account/logout');

/** 服务端项目通道：登录后以此为准，覆盖由地址派生的兜底 scope。 */
export interface ServerChannel {
  id: number;
  code: string;
  scope: string;
  name: string;
  instance: string;
  mode: string;
  integration: string;
}

/** 服务端只启用一个项目时返回通道；多项目报 1505、未配置报 1504。 */
export const channel = () => request<ServerChannel>('/mobile/channel');

export async function directory(): Promise<{ users: DirectoryUser[]; generatedAt: string }> {
  const result = await request<{ items?: AccountProfile[] }>('/system/users?page=1&pageSize=100');
  const items = Array.isArray(result?.items) ? result.items : [];
  return {
    generatedAt: new Date().toISOString(),
    users: items.map((item) => ({
      id: String(item.id),
      name: item.nickname || item.username,
      memberNumber: item.phone || item.email || '',
      role: hasAdminRole(item) ? 'admin' : 'worker',
      createdAt: item.createdAt || '',
      active: item.status === 1,
      records: 0,
      photos: 0,
      lastSubmittedAt: '',
    })),
  };
}

export function hasAdminRole(value?: AccountProfile | null) {
  return Boolean(value?.roles?.some((role) => role?.value === 'admin'));
}

/** nest-admin 账号 -> 本机业务模型；id 转成字符串，仅用于本机记录归属。 */
export function toUser(value: AccountProfile): User {
  return {
    id: String(value.id),
    username: value.username,
    name: value.nickname?.trim() || value.username,
    role: hasAdminRole(value) ? 'admin' : 'worker',
    avatar: value.avatar || '',
    deptName: value.dept?.name || '',
    roles: (value.roles || []).map((role) => role?.value || '').filter(Boolean),
  };
}

/** 后端没有「项目通道」概念，用服务地址生成稳定的通道标识，保证本机记录可归属。 */
export function connectionOf(projectName = '风电施工现场管理'): Connection {
  const host = (root || 'same-origin').replace(/^https?:\/\//, '').replace(/\/api$/, '');
  return {
    service: 'nest-admin',
    instance: `nest-admin@${host}`,
    mode: 'trial',
    projectName,
    scope: scopeOf(host),
    registrationOpen: false,
    integration: 'manual',
  };
}

function scopeOf(seed: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2654435761) >>> 0;
  }
  const part = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  // 本机 scope 要求 64 位十六进制（旧版约定），这里由地址派生 8 段。
  return [h1, h2, h1 ^ h2, h1 + h2, h1 >>> 1, h2 >>> 1, h1 ^ (h2 >>> 3), (h1 * 31 + h2) | 0]
    .map(part)
    .join('')
    .slice(0, 64);
}

/** 设置页的连通性检测：验证码接口是公开接口，能取到就说明地址与服务都正确。 */
export async function probe() {
  const captcha = await loadCaptcha();
  return captcha;
}
