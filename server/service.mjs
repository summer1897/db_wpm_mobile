/**
 * 统一手机账号、离线补传回执及项目台账。正式入口连接原施工服务；测试可使用隔离台账。
 * 施工原件和日志由原系统统一归档，账号及权限始终由服务端验证。
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as deriveKey,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createConstructionServer } from '../../server/api.mjs';
import { fieldConstructionTypes } from '../../shared/workReports.mjs';
import { desktopTarget, connectDesktop } from './desktop.mjs';

const scrypt = promisify(deriveKey);
const MAX_PHOTO = 20 * 1024 * 1024;
const uuidPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeUser = ({ id, username, role, name }) => ({
  id,
  username,
  name: name || (role === 'admin' ? '管理人员' : '工作人员'),
  role,
});
const required = (value, label, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw fail(`${label}未填写或过长`);
  return value.trim();
};
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const day = new Date(value + 'T12:00:00Z');
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}
function validateFields(input) {
  const type = input.type || input.module;
  if (!fieldConstructionTypes.some((row) => row.id === type)) throw fail('施工类型无效');
  if (!validDay(input.date)) throw fail('施工日期无效');
  return {
    type,
    date: input.date,
    location: required(input.location, '施工地点', 120),
  };
}
async function body(req, max = 32768) {
  const chunks = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > max) throw fail('上传内容超过限制', 413);
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
async function json(req) {
  try {
    return JSON.parse((await body(req)).toString('utf8'));
  } catch (error) {
    if (error.status) throw error;
    throw fail('请求内容格式错误');
  }
}

export async function createMobileService({
  root,
  projectName = '风电施工现场管理',
  allowedOrigins = [],
  desktopRoot,
  desktopOrigin = 'http://127.0.0.1:8787',
} = {}) {
  if (!root) throw new Error('必须指定手机服务数据目录');
  root = resolve(root);
  const privateFile = resolve(root, 'private', 'mobile-state.json');
  await mkdir(dirname(privateFile), { recursive: true });
  let state;
  try {
    state = JSON.parse(await readFile(privateFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('手机服务台账无法读取，停止启动以保护已有数据');
    state = {
      version: 1,
      users: [],
      uploads: [],
      reports: [],
      connection: null,
    };
  }
  if (
    state.version !== 1 ||
    !['users', 'uploads', 'reports'].every((key) => Array.isArray(state[key]))
  )
    throw new Error('手机服务台账格式错误');
  let queue = Promise.resolve();
  const transact = (callback) => {
    const action = queue.then(async () => {
      const next = structuredClone(state);
      const result = await callback(next);
      const temp = privateFile + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(temp, privateFile);
      state = next;
      return result;
    });
    queue = action.catch(() => {});
    return action;
  };
  // 完整复用原有分类命名、归档、审核默认值和日志分析逻辑，但试用资料单独存放。
  const domain = await createConstructionServer({
    root: resolve(root, 'private', 'trial-construction'),
    authentication: false,
  });
  domain.server.listen(0, '127.0.0.1');
  await once(domain.server, 'listening');
  const trialOrigin = `http://127.0.0.1:${domain.server.address().port}`;
  const trialApi = trialOrigin + '/api/construction';
  async function upstream(path, init = {}, connection = state.connection) {
    const response = await fetch(connection.api + path, {
      ...init,
      redirect: 'error',
      headers: {
        Origin: new URL(connection.api).origin,
        'X-Wind-Upload-Token': connection.token,
        ...(init.body && !Buffer.isBuffer(init.body) ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(120000),
    });
    const result = await response.json().catch(() => {
      throw fail('施工服务未返回有效回执', 502);
    });
    if (!response.ok)
      throw fail(
        result.error || '施工服务未完成请求',
        response.status === 401 || response.status === 403 ? 409 : response.status,
      );
    return result;
  }
  async function ensureTrialConnection() {
    if (state.connection?.mode === 'linked') return;
    let token = state.connection?.token;
    const existing =
      token &&
      domain.store.data.intakeLinks.find((row) => row.hash === hash(token) && !row.revoked);
    if (existing) {
      // 试用通道不对外公布，访问仍需独立账号。仅延长本服务自己的通道，保持重启后的幂等作用域。
      const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
      await domain.store.transaction((data) => {
        data.intakeLinks.find((row) => row.id === existing.id).expiresAt = expiresAt;
      });
      await transact((next) => {
        next.connection.api = trialApi;
        next.connection.expiresAt = expiresAt;
      });
      return;
    }
    if (!token || Date.parse(state.connection.expiresAt) <= Date.now()) {
      // 旧任务仍使用旧作用域，不自动迁移，避免链接轮换后重复发布。
      const response = await fetch(trialApi + '/intake-links', {
        method: 'POST',
        headers: { Origin: trialOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'workDynamics',
          workId: 'intake-workDynamics',
          title: projectName + '试用台账',
          module: 'other',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error('试用填报入口创建失败');
      token = result.token;
      const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
      await domain.store.transaction((data) => {
        data.intakeLinks.find((row) => row.hash === hash(token)).expiresAt = expiresAt;
      });
      await transact((next) => {
        next.connection = {
          mode: 'trial',
          token,
          api: trialApi,
          expiresAt,
          scope: hash('trial:' + token),
          name: projectName,
          ledgerRoot: domain.store.root,
        };
      });
    } else
      await transact((next) => {
        next.connection.api = trialApi;
      });
  }
  let syncStatus = 'unavailable';
  const desktop = desktopRoot ? desktopTarget(desktopRoot, desktopOrigin, projectName) : null;
  if (desktop)
    await transact((next) => {
      next.connection = desktop;
    });
  else {
    await ensureTrialConnection();
    syncStatus = state.connection.mode === 'trial' ? 'trial' : 'ready';
  }
  let connecting;
  async function refreshDesktop() {
    if (!desktop) return;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const value = await connectDesktop(desktop);
        if (state.connection.token !== value.token)
          await transact((next) => {
            next.connection = value;
          });
        syncStatus = 'ready';
      } catch {
        syncStatus = 'unavailable';
      }
    })().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }
  async function requireDesktop() {
    await refreshDesktop();
    if (desktop && syncStatus !== 'ready')
      throw fail('电脑端资料服务未连接，请启动或重启数字化管理平台后重试；本机记录已保留', 503);
  }
  const sessions = new Map();
  const attempts = new Map();
  const busyUsers = new Set();
  const inFlightPhotos = new Map();
  const inFlightReports = new Map();
  let activePhotoRequests = 0;
  const allowed = new Set([
    'http://localhost',
    'https://localhost',
    'capacitor://localhost',
    'http://localhost:5188',
    'http://127.0.0.1:5188',
    ...allowedOrigins,
  ]);
  const config = () => ({
    service: 'wind-field-mobile',
    instance: hash(root),
    mode: state.connection.mode,
    projectName: state.connection.name,
    scope: state.connection.scope,
    expiresAt: state.connection.expiresAt,
    registrationOpen: true,
    registrationRoles: ['worker', 'admin'],
    integration: desktop ? 'desktop' : state.connection.mode === 'trial' ? 'trial' : 'manual',
    syncStatus,
    maxFiles: 10,
    maxPhotoBytes: MAX_PHOTO,
  });
  function userFor(req) {
    const token = /^Bearer ([a-f\d]{64})$/.exec(req.headers.authorization || '')?.[1];
    const session = token && sessions.get(hash(token));
    if (!session || session.until <= Date.now()) {
      if (token) sessions.delete(hash(token));
      throw fail('登录已失效，请重新登录；本机草稿不会丢失', 401);
    }
    const user = state.users.find((row) => row.id === session.id && !row.disabled);
    if (!user) throw fail('账号不可用', 401);
    return user;
  }
  function adminFor(req) {
    const user = userFor(req);
    if (user.role !== 'admin') throw fail('只有管理员可以执行此操作', 403);
    return user;
  }
  function issueSession(user) {
    const token = randomBytes(32).toString('hex');
    for (const [key, entry] of sessions) if (entry.until <= Date.now()) sessions.delete(key);
    sessions.set(hash(token), { id: user.id, until: Date.now() + 8 * 3600000 });
    // 离线身份仅允许本机采集，不是 API 凭证；服务端操作始终验证短期会话。
    return {
      user: safeUser(user),
      token,
      offlineUntil: Date.now() + 7 * 86400000,
    };
  }
  async function makeUser(input, role) {
    const name = role === 'admin' ? required(input.name, '管理人员姓名', 30) : '';
    const username = required(input.username, '用户名', 50).normalize('NFKC');
    if (/[\x00-\x1f]/.test(username)) throw fail('用户名包含无效字符');
    if (
      typeof input.password !== 'string' ||
      input.password.length < 6 ||
      input.password.length > 128
    )
      throw fail('密码请输入6—128个字符，不要求复杂组合');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = Buffer.from(await scrypt(input.password, salt, 64)).toString('hex');
    return {
      id: randomUUID(),
      username,
      role,
      name,
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
  }
  async function registerUser(input, role) {
    const user = await makeUser(input, role);
    await transact((next) => {
      if (next.users.some((row) => row.username.toLowerCase() === user.username.toLowerCase()))
        throw fail('该用户名已注册，请返回登录', 409);
      if (next.users.length >= 200) throw fail('项目账号数量已达上限', 409);
      next.users.push(user);
    });
    return user;
  }
  async function latestReports(user, project = false) {
    let ledger;
    if (state.connection.ledgerRoot) {
      try {
        ledger = JSON.parse(
          await readFile(resolve(state.connection.ledgerRoot, 'records.json'), 'utf8'),
        );
      } catch {
        /* 返回最后一次有效回执，不伪装已同步。 */
      }
    }
    const deletedIds = [];
    const reports = [];
    // 项目级读取只供通过 adminFor 校验的管理接口调用；个人记录接口仍严格按账号隔离。
    for (const receipt of state.reports.filter((row) =>
      project ? row.scope === state.connection.scope : row.userId === user.id,
    )) {
      const actual =
        receipt.scope === state.connection.scope &&
        ledger?.logs?.find((row) => row.id === receipt.serverId);
      if (receipt.scope === state.connection.scope && ledger && (!actual || actual.archived)) {
        deletedIds.push(receipt.id);
        continue;
      }
      const attachments = receipt.photoIds
        .map((id) =>
          state.uploads.find((photo) => photo.id === id && photo.userId === receipt.userId),
        )
        .filter(Boolean);
      reports.push({
        id: receipt.id,
        owner: receipt.userId,
        ...(project
          ? {
              reporter: {
                id: receipt.userId,
              },
            }
          : {}),
        serverId: receipt.serverId,
        scope: receipt.scope,
        type: actual?.module || receipt.type,
        date: actual?.date || receipt.date,
        location: actual?.location || receipt.location,
        content: actual?.content || receipt.content,
        createdAt: receipt.createdAt,
        updatedAt: receipt.createdAt,
        submittedAt: receipt.createdAt,
        status: 'submitted',
        reviewStatus: actual?.reviewStatus || receipt.reviewStatus,
        revision: actual?.version || 1,
        photos: attachments.map((photo) => ({
          id: photo.clientId,
          key: `field-management/photos/remote-${photo.id}`,
          name: photo.name,
          size: photo.size,
          mime: photo.mime,
          remoteId: photo.id,
          remoteScope: photo.scope,
        })),
      });
    }
    return {
      reports,
      deletedIds,
      ...(project
        ? {
            scope: state.connection.scope,
            projectName: state.connection.name,
            generatedAt: new Date().toISOString(),
            ledgerStatus: ledger ? 'live' : 'receipts',
          }
        : {}),
    };
  }
  const server = createServer(async (req, res) => {
    let photoSlot = false;
    const origin = req.headers.origin;
    const send = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (origin && !allowed.has(origin)) throw fail('该客户端来源未获授权', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-File-Meta',
          'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/^\/api\/mobile\/v1/, '');
      if (!url.pathname.startsWith('/api/mobile/v1/') || url.search) throw fail('接口不存在', 404);
      if (path === '/config' && req.method === 'GET') {
        await refreshDesktop();
        return send(200, config());
      }
      if (path === '/auth/register' && req.method === 'POST') {
        const input = await json(req);
        if (!['admin', 'worker'].includes(input.role)) throw fail('请选择注册身份');
        // 按当前项目需求开放两类身份自助注册；登录时不能通过切换入口改变已注册角色。
        const key = 'registration';
        const attempt = attempts.get(key);
        if (attempt && attempt.until > Date.now() && attempt.count >= 60)
          throw fail('注册尝试较多，请10分钟后重试', 429);
        attempts.set(key, {
          count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
          until: attempt && attempt.until > Date.now() ? attempt.until : Date.now() + 600000,
        });
        const user = await registerUser(input, input.role);
        return send(201, issueSession(user));
      }
      if (path === '/auth/login' && req.method === 'POST') {
        const input = await json(req);
        if (input.role !== undefined && !['admin', 'worker'].includes(input.role))
          throw fail('请选择有效的登录身份');
        const username = String(input.username || '')
          .trim()
          .normalize('NFKC');
        const key = username.toLowerCase();
        const now = Date.now();
        for (const [id, row] of attempts) if (row.until < now) attempts.delete(id);
        if (attempts.size > 1000 || (attempts.get(key)?.count || 0) >= 10)
          throw fail('登录尝试过多，请10分钟后再试', 429);
        const user = state.users.find((row) => row.username.toLowerCase() === key && !row.disabled);
        const computed = Buffer.from(
          await scrypt(
            String(input.password || '').slice(0, 129),
            user?.salt || 'invalid-account-salt',
            64,
          ),
        );
        if (!user || !timingSafeEqual(computed, Buffer.from(user.passwordHash, 'hex'))) {
          const attempt = attempts.get(key) || {
            count: 0,
            until: now + 600000,
          };
          attempt.count++;
          attempts.set(key, attempt);
          throw fail(user ? '用户名或密码不正确' : '账号尚未注册，请先注册', user ? 401 : 404);
        }
        attempts.delete(key);
        // 身份由已验证的账号决定，选择管理入口不会提升权限；错误入口不签发会话。
        if (input.role !== undefined && input.role !== user.role)
          throw fail(
            user.role === 'admin'
              ? '此账号为管理人员，请选择管理人员入口'
              : '此账号为工作人员，请选择工作人员入口',
            403,
          );
        return send(200, issueSession(user));
      }
      const user = userFor(req);
      if (path === '/auth/logout' && req.method === 'POST') {
        sessions.delete(hash(req.headers.authorization.slice(7)));
        return send(200, { ok: true });
      }
      if (path === '/users' && req.method === 'POST') {
        adminFor(req);
        const input = await json(req);
        if (input.role !== undefined && !['worker', 'admin'].includes(input.role))
          throw fail('请选择有效的人员身份');
        const nextUser = await registerUser(input, input.role || 'worker');
        return send(201, safeUser(nextUser));
      }
      if (path === '/admin/users' && req.method === 'GET') {
        adminFor(req);
        const ledger = await latestReports(user, true);
        // 严格字段白名单：管理人员查看的是人员资料，响应中不包含登录账号、密码及摘要。
        return send(200, {
          generatedAt: new Date().toISOString(),
          users: state.users.map((row, index) => {
            const reports = ledger.reports.filter((report) => report.owner === row.id);
            return {
              id: row.id,
              name: row.name || (row.role === 'admin' ? '管理人员' : '工作人员'),
              memberNumber: String(index + 1).padStart(3, '0'),
              role: row.role,
              createdAt: row.createdAt,
              active: !row.disabled,
              records: reports.length,
              photos: reports.reduce((sum, report) => sum + report.photos.length, 0),
              lastSubmittedAt:
                reports
                  .map((report) => report.submittedAt)
                  .sort()
                  .at(-1) || '',
            };
          }),
        });
      }
      if (path === '/admin/connect' && req.method === 'POST') {
        adminFor(req);
        if (desktop) throw fail('当前已使用固定的电脑端同步通道，无需粘贴临时上传链接', 409);
        const input = await json(req);
        let target;
        if (
          inFlightPhotos.size ||
          inFlightReports.size ||
          state.uploads.some(
            (photo) =>
              photo.scope === state.connection.scope &&
              !state.reports.some((report) => report.photoIds.includes(photo.id)),
          )
        )
          throw fail('存在未完成的上传，请先完成原任务，再切换大屏通道', 409);
        try {
          target = new URL(input.link);
        } catch {
          throw fail('请输入管理员生成的完整施工填报链接');
        }
        const privateHost =
          /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
            target.hostname,
          );
        if (
          !['https:', 'http:'].includes(target.protocol) ||
          (target.protocol === 'http:' && !privateHost) ||
          target.username ||
          target.password ||
          target.search ||
          !/^#[a-f\d]{48}$/.test(target.hash)
        )
          throw fail('填报链接格式无效，外部地址必须使用 HTTPS');
        const connection = {
          mode: 'linked',
          token: target.hash.slice(1),
          api: target.origin + '/api/construction',
          scope: hash(target.origin + target.hash),
          name: projectName,
        };
        const context = await upstream('/intake', {}, connection);
        if (context.workSource !== 'workDynamics')
          throw fail('请使用近期工作动态的上传链接，不是当前重点工作入口');
        connection.expiresAt = context.expiresAt;
        if (/^(localhost|127\.0\.0\.1)$/.test(target.hostname)) {
          try {
            const healthOrigin = target.port === '8788' ? 'http://127.0.0.1:8787' : target.origin;
            const health = await fetch(healthOrigin + '/api/construction/health', {
              signal: AbortSignal.timeout(2000),
            }).then((r) => r.json());
            if (health.service === 'wind-local' && typeof health.root === 'string')
              connection.ledgerRoot = health.root;
          } catch {
            /* 非默认端口仍可上传；回执不冒充实时管理快照。 */
          }
        }
        await transact((next) => {
          next.connection = connection;
        });
        return send(200, config());
      }
      if (path === '/reports' && req.method === 'GET') return send(200, await latestReports(user));
      if (path === '/admin/ledger' && req.method === 'GET') {
        adminFor(req);
        return send(200, await latestReports(user, true));
      }
      const photoMatch = path.match(/^\/(admin\/)?photos\/([a-f\d-]+)$/);
      if (photoMatch && req.method === 'GET') {
        const projectPhoto = Boolean(photoMatch[1]);
        if (projectPhoto) adminFor(req);
        const photo = state.uploads.find(
          (row) =>
            row.id === photoMatch[2] &&
            (projectPhoto ? row.scope === state.connection.scope : row.userId === user.id),
        );
        const visible = await latestReports(user, projectPhoto);
        if (
          !photo ||
          !visible.reports.some((row) => row.photos.some((item) => item.remoteId === photo.id)) ||
          !photo.cacheFile
        )
          throw fail('照片不存在或没有访问权限', 404);
        const content = await readFile(resolve(root, 'private', 'photos', photo.cacheFile));
        res.writeHead(200, {
          'Content-Type': photo.mime,
          'Content-Length': content.length,
          'Content-Disposition': 'inline',
        });
        res.end(content);
        return;
      }
      if (path === '/photos' && req.method === 'POST') {
        await requireDesktop();
        if (activePhotoRequests >= 4) throw fail('上传任务较多，请稍后重试，资料仍保存在本机', 429);
        activePhotoRequests++;
        photoSlot = true;
        let meta;
        try {
          meta = JSON.parse(decodeURIComponent(req.headers['x-file-meta'] || ''));
        } catch {
          throw fail('照片元信息无效');
        }
        if (!uuidPattern.test(meta.id) || !uuidPattern.test(meta.recordId))
          throw fail('照片或记录编号无效');
        const fields = validateFields(meta);
        const name = required(meta.name, '照片名称', 180);
        if (!/\.(jpe?g|png|webp)$/i.test(name)) throw fail('请选择 JPG、PNG 或 WEBP 照片');
        const content = await body(req, MAX_PHOTO);
        if (!content.length) throw fail('照片为空');
        const signature = hash(content);
        const fingerprint = hash(JSON.stringify([fields, signature, meta.recordId]));
        const key = `${user.id}:${meta.id}:${state.connection.scope}`;
        if (inFlightPhotos.has(key)) return send(201, await inFlightPhotos.get(key));
        const action = (async () => {
          const previous = state.uploads.find((row) => row.key === key);
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              throw fail('同一照片编号对应的内容发生变化', 409);
            return { id: previous.id, scope: previous.scope };
          }
          if (busyUsers.has(user.id)) throw fail('请等待当前照片上传完成', 429);
          busyUsers.add(user.id);
          try {
            const connection = structuredClone(state.connection);
            const saved = await upstream(
              '/materials',
              {
                method: 'POST',
                body: content,
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'X-File-Meta': encodeURIComponent(
                    JSON.stringify({
                      formVersion: 'simple-v1',
                      module: fields.type,
                      stage: '现场记录',
                      capturedAt: fields.date,
                      location: fields.location,
                      description: String(meta.description || '').slice(0, 500),
                      name,
                      uploader: '移动端填报',
                    }),
                  ),
                },
              },
              connection,
            );
            const cacheFile = `${user.id}_${meta.id}`;
            const mime = /\.png$/i.test(name)
              ? 'image/png'
              : /\.webp$/i.test(name)
                ? 'image/webp'
                : 'image/jpeg';
            await mkdir(resolve(root, 'private', 'photos'), {
              recursive: true,
            });
            await writeFile(resolve(root, 'private', 'photos', cacheFile), content, {
              mode: 0o600,
            });
            await transact((next) =>
              next.uploads.push({
                key,
                id: saved.id,
                clientId: meta.id,
                name,
                size: content.length,
                mime,
                cacheFile,
                userId: user.id,
                recordId: meta.recordId,
                scope: connection.scope,
                fingerprint,
                fields,
                createdAt: new Date().toISOString(),
              }),
            );
            return { id: saved.id, scope: connection.scope };
          } finally {
            busyUsers.delete(user.id);
          }
        })();
        inFlightPhotos.set(key, action);
        try {
          return send(201, await action);
        } finally {
          inFlightPhotos.delete(key);
        }
      }
      if (path === '/reports' && req.method === 'POST') {
        await requireDesktop();
        const input = await json(req);
        if (!uuidPattern.test(input.id)) throw fail('提交编号无效');
        const fields = validateFields(input);
        const content = required(input.content, '施工说明', 2000);
        const key = `${user.id}:${input.id}`;
        const previous = state.reports.find((row) => row.id === input.id && row.userId === user.id);
        if (previous) {
          if (
            previous.type !== fields.type ||
            previous.date !== fields.date ||
            previous.location !== fields.location ||
            previous.content !== content
          )
            throw fail('记录已提交，不能用同一编号覆盖内容；请通过数据管理修改', 409);
          return send(200, {
            id: previous.id,
            serverId: previous.serverId,
            createdAt: previous.createdAt,
            reviewStatus: previous.reviewStatus,
          });
        }
        if (inFlightReports.has(key)) return send(200, await inFlightReports.get(key));
        const action = (async () => {
          const ids = [...new Set(Array.isArray(input.photoIds) ? input.photoIds : [])];
          if (!ids.length || ids.length > 10) throw fail('请提交1—10张施工照片');
          const connection = structuredClone(state.connection);
          const photos = ids.map((id) =>
            state.uploads.find(
              (row) =>
                row.id === id &&
                row.userId === user.id &&
                row.recordId === input.id &&
                row.scope === connection.scope,
            ),
          );
          if (photos.some((row) => !row || JSON.stringify(row.fields) !== JSON.stringify(fields)))
            throw fail('照片尚未完成上传，或与施工记录不一致');
          const result = await upstream(
            '/intake/submit',
            {
              method: 'POST',
              body: JSON.stringify({
                formVersion: 'simple-v1',
                module: fields.type,
                stage: '现场记录',
                date: fields.date,
                location: fields.location,
                content,
                reporter: '移动端填报',
                submissionId: `mobile-${user.id}-${input.id}`,
                materialIds: ids,
              }),
            },
            connection,
          );
          const row = {
            id: input.id,
            userId: user.id,
            serverId: result.id,
            createdAt: result.createdAt,
            scope: connection.scope,
            ...fields,
            content,
            photoIds: ids,
            reviewStatus: '已审核',
          };
          await transact((next) => {
            if (!next.reports.some((record) => record.id === input.id && record.userId === user.id))
              next.reports.push(row);
          });
          return {
            id: input.id,
            serverId: result.id,
            createdAt: result.createdAt,
            reviewStatus: '已审核',
          };
        })();
        inFlightReports.set(key, action);
        try {
          return send(201, await action);
        } finally {
          inFlightReports.delete(key);
        }
      }
      throw fail('接口不存在', 404);
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        send(error.status || 500, {
          error: error.status ? error.message : '手机服务暂时不可用，请重试；记录不会自动删除',
        });
    } finally {
      if (photoSlot) activePhotoRequests--;
      if (!req.complete) req.resume();
    }
  });
  server.requestTimeout = 130000;
  server.headersTimeout = 15000;
  return {
    server,
    domain,
    config,
    addOrigin: (value) => allowed.add(value),
    async close() {
      server.closeAllConnections();
      if (server.listening) await new Promise((done) => server.close(done));
      domain.fieldGateway.server.closeAllConnections();
      domain.server.closeAllConnections();
      await new Promise((done) => domain.server.close(done));
      await queue;
      await domain.store.queue;
    },
  };
}
