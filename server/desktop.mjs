/** 移动端后台到同机桌面服务的私有连接；客户端永远拿不到内部填报密钥或磁盘路径。 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function desktopTarget(root, origin, projectName) {
  root = resolve(root);
  const target = new URL(origin);
  if (
    target.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/'
  )
    throw new Error('桌面同步服务必须是本机 HTTP 根地址');
  return {
    mode: 'linked',
    integration: 'desktop',
    api: target.origin + '/api/construction',
    ledgerRoot: root,
    name: projectName,
    scope: createHash('sha256')
      .update('desktop:' + (process.platform === 'win32' ? root.toLowerCase() : root))
      .digest('hex'),
  };
}
export async function connectDesktop(target) {
  const value = JSON.parse(
    await readFile(resolve(target.ledgerRoot, 'private', 'mobile-sync.json'), 'utf8'),
  );
  if (value.version !== 1 || !/^[a-f0-9]{48}$/.test(value.token || ''))
    throw new Error('桌面同步密钥无效');
  const health = await fetch(target.api + '/health', { signal: AbortSignal.timeout(2500) }).then(
    (r) => r.json(),
  );
  const same = (a, b) =>
    process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (
    health.service !== 'wind-local' ||
    health.mobileIntegrationVersion !== 1 ||
    typeof health.root !== 'string' ||
    !same(resolve(health.root), target.ledgerRoot)
  )
    throw new Error('桌面服务版本或资料目录不匹配');
  const response = await fetch(target.api + '/intake', {
    headers: { 'X-Wind-Upload-Token': value.token },
    signal: AbortSignal.timeout(2500),
  });
  const intake = await response.json();
  if (!response.ok || intake.workSource !== 'workDynamics') throw new Error('桌面填报通道不可用');
  return { ...target, token: value.token };
}
