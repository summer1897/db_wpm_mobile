/** 用随机空闲端口和临时台账验收启动器，不关闭或改写用户正在运行的服务。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
const root = fileURLToPath(new URL('../', import.meta.url));
async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test('生产预览启动、代理、离线资源、重复启动复用与优雅关闭', async () => {
  const [apiPort, gatewayPort, webPort] = await Promise.all([
    availablePort(),
    availablePort(),
    availablePort(),
  ]);
  const env = {
    ...process.env,
    WIND_MOBILE_PORT: String(apiPort),
    WIND_MOBILE_GATEWAY_PORT: String(gatewayPort),
    WIND_MOBILE_WEB_PORT: String(webPort),
    WIND_MOBILE_DATA_ROOT: await mkdtemp(join(tmpdir(), 'wind-launch-')),
    WIND_MOBILE_TRIAL: '1',
  };
  let logs = '';
  const children = [];
  function start() {
    const child = fork('scripts/dev.mjs', ['--preview'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout.on('data', (data) => {
      logs += data;
    });
    child.stderr.on('data', (data) => {
      logs += data;
    });
    children.push(child);
    return child;
  }
  async function waitFor(check) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await pause(100);
    }
    throw new Error('预览未就绪：' + logs);
  }
  async function stop(child) {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    if (child.connected) child.send({ type: 'shutdown' });
    await Promise.race([
      exited,
      pause(10000).then(() => {
        throw new Error('预览未按时停止');
      }),
    ]);
  }
  try {
    start();
    const base = `http://127.0.0.1:${webPort}`;
    await waitFor(async () => {
      try {
        const response = await fetch(base + '/api/mobile/v1/config');
        return response.ok;
      } catch {
        return false;
      }
    });
    const html = await fetch(base).then((response) => response.text());
    assert.ok(html.includes('uni-app-v1'));
    assert.ok(!html.includes('/src/main.ts'));
    assert.equal((await fetch(base + '/sw.js')).status, 200);
    const config = await fetch(base + '/api/mobile/v1/config').then((response) => response.json());
    assert.equal(config.service, 'wind-field-mobile');
    assert.equal(config.registrationOpen, true);
    const reused = start();
    await waitFor(() => logs.includes('统一移动端预览已运行'));
    await stop(reused);
    assert.equal(
      (await fetch(base + '/api/mobile/v1/config')).status,
      200,
      '关闭复用启动器不能影响原服务',
    );
  } finally {
    for (const child of children.reverse()) await stop(child);
  }
});

test(
  '已有页面但后台已停止：补启登录服务、保留账号，关闭启动器不影响已有页面',
  { timeout: 45000 },
  async () => {
    const [apiPort, gatewayPort, webPort] = await Promise.all([
      availablePort(),
      availablePort(),
      availablePort(),
    ]);
    const data = await mkdtemp(join(tmpdir(), 'wind-launch-recovery-'));
    const env = {
      ...process.env,
      WIND_MOBILE_PORT: String(apiPort),
      WIND_MOBILE_GATEWAY_PORT: String(gatewayPort),
      WIND_MOBILE_WEB_PORT: String(webPort),
      WIND_MOBILE_DATA_ROOT: data,
      WIND_MOBILE_TRIAL: '1',
    };
    const upstream = `http://127.0.0.1:${gatewayPort}`;
    const web = createHttpServer(async (req, res) => {
      if (!req.url.startsWith('/api/')) {
        res.end('<html>uni-app-v1</html>');
        return;
      }
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await fetch(upstream + req.url, {
          method: req.method,
          headers: { 'Content-Type': 'application/json' },
          body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
        });
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    web.listen(webPort, '127.0.0.1');
    await once(web, 'listening');
    const base = `http://127.0.0.1:${webPort}`;
    const children = [];
    let logs = '';
    function start() {
      const child = fork('scripts/dev.mjs', ['--preview'], {
        cwd: root,
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      child.stdout.on('data', (value) => (logs += value));
      child.stderr.on('data', (value) => (logs += value));
      children.push(child);
      return child;
    }
    async function ready() {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(base + '/api/mobile/v1/config');
          if (r.ok) return await r.json();
        } catch {}
        await pause(100);
      }
      throw new Error('后台恢复失败：' + logs);
    }
    async function stop(child) {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.send({ type: 'shutdown' });
      await exited;
    }
    try {
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await fetch(base + '/api/mobile/v1/config')).status, 500);
      const first = start();
      const initial = await ready();
      const created = await fetch(base + '/api/mobile/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'recovered-worker',
          password: 'test-password',
          role: 'worker',
        }),
      });
      assert.equal(created.status, 201);
      const account = await created.json();
      await stop(first);
      assert.equal((await fetch(base)).status, 200, '已有页面继续提供服务');
      assert.equal((await fetch(base + '/api/mobile/v1/config')).status, 500);
      start();
      const restored = await ready();
      assert.equal(restored.instance, initial.instance);
      const login = await fetch(base + '/api/mobile/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'recovered-worker',
          password: 'test-password',
        }),
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).user.id, account.user.id);
    } finally {
      for (const child of children.reverse()) await stop(child);
      web.closeAllConnections();
      await new Promise((done) => web.close(done));
    }
  },
);
