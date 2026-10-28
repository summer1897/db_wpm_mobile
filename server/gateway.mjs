/** uni-app 各端统一使用 multipart；本层只适配传输，不改变原施工归档、账号及审核规则。 */
import { createServer } from 'node:http';
import Busboy from 'busboy';
const MAX_PHOTO = 20 * 1024 * 1024;
const PREFIX = '/api/mobile/v1';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const route = (path, method) =>
  (method === 'GET' &&
    /^\/(config|reports|photos\/[a-f\d-]{36}|admin\/(ledger|users)|admin\/photos\/[a-f\d-]{36})$/.test(
      path,
    )) ||
  (method === 'POST' &&
    /^\/(auth\/(login|register|logout)|users|admin\/connect|photos|reports)$/.test(path));
async function readBody(req, max) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) throw fail('请求内容超过限制', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function readMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fields: 0,
          parts: 2,
          fileSize: MAX_PHOTO,
          headerPairs: 100,
        },
      });
    } catch (_) {
      reject(fail('照片请求格式无效'));
      return;
    }
    let photo = null,
      issue = null,
      bytes = 0,
      settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      req.off('aborted', aborted);
      req.off('data', checkSize);
      if (error) {
        req.unpipe(parser);
        req.resume();
        reject(error);
      } else resolve(photo);
    };
    const aborted = () => {
      parser.destroy();
      finish(fail('上传已中断'));
    };
    const checkSize = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_PHOTO + 65536) parser.destroy(fail('照片超过20 MB', 413));
    };
    req.on('aborted', aborted);
    req.on('data', checkSize);
    parser.on('file', (name, file) => {
      if (name !== 'file' || photo) {
        issue = fail('一次仅允许上传一张施工照片');
        file.resume();
        return;
      }
      const chunks = [];
      photo = Buffer.alloc(0);
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('limit', () => {
        issue = fail('单张照片不能超过20 MB', 413);
      });
      file.on('error', (error) => {
        issue = error;
      });
      file.on('end', () => {
        if (!issue) photo = Buffer.concat(chunks);
      });
    });
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'])
      parser.on(event, () => {
        issue = fail('照片请求包含多余字段或文件');
      });
    parser.on('error', (error) => finish(error.status ? error : fail('照片请求不完整')));
    parser.on('close', () => finish(issue || (!photo?.length ? fail('没有收到施工照片') : null)));
    req.pipe(parser);
  });
}
export function createMobileGateway({ upstreamOrigin, allowedOrigins = [] }) {
  const target = new URL(upstreamOrigin);
  if (
    !/^https?:$/.test(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/'
  )
    throw new Error('请配置可信后台根地址');
  let photoRequests = 0;
  const allowed = new Set(allowedOrigins);
  const server = createServer(async (req, res) => {
    let photoSlot = false;
    const send = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Wind-Mobile-Gateway', 'uniapp-1');
    try {
      const origin = req.headers.origin;
      if (origin && !allowed.has(origin)) throw fail('客户端来源未获授权', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      const parsed = new URL(req.url, 'http://localhost');
      const path = parsed.pathname.startsWith(PREFIX + '/')
        ? parsed.pathname.slice(PREFIX.length)
        : '';
      const method =
        req.method === 'OPTIONS' ? req.headers['access-control-request-method'] : req.method;
      if (parsed.search || !route(path, method)) throw fail('接口不存在', 404);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-File-Meta',
          'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
      }
      const headers = {};
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;
      let payload;
      if (path === '/photos' && req.method === 'POST') {
        if (!/^Bearer [a-f\d]{64}$/.test(req.headers.authorization || ''))
          throw fail('请先登录项目账号', 401);
        if (photoRequests >= 4) throw fail('当前上传任务较多，请稍后重试', 429);
        photoRequests++;
        photoSlot = true;
        const metadata = req.headers['x-file-meta'];
        if (typeof metadata !== 'string' || metadata.length > 12000) throw fail('照片元信息无效');
        if (!/^multipart\/form-data;/i.test(req.headers['content-type'] || ''))
          throw fail('请使用移动端照片上传接口', 415);
        // 在收取大文件前核验账号；权限仍由原服务统一裁决，不因适配层而放宽。
        const auth = await fetch(target.origin + PREFIX + '/reports', {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
        });
        await auth.arrayBuffer();
        if (!auth.ok) throw fail('登录已失效，请重新登录', auth.status);
        payload = await readMultipart(req);
        headers['Content-Type'] = 'application/octet-stream';
        headers['X-File-Meta'] = metadata;
      } else if (req.method === 'POST') {
        payload = await readBody(req, 32768);
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(target.origin + PREFIX + path, {
        method: req.method,
        headers,
        body: payload,
        redirect: 'error',
        signal: AbortSignal.timeout(path === '/photos' ? 120000 : 20000),
      });
      const content = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Content-Length': content.length,
      });
      res.end(content);
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        send(error.status || 502, {
          error: error.status ? error.message : '项目服务暂时不可用，请稍后重试；本机记录仍保留',
        });
    } finally {
      if (photoSlot) photoRequests--;
      if (!req.complete) req.resume();
    }
  });
  server.requestTimeout = 130000;
  server.headersTimeout = 15000;
  return {
    server,
    async close() {
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
  };
}
