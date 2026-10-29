import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { createMobileService } from '../server/service.mjs';
async function fixture(root) {
  root ||= await mkdtemp(join(tmpdir(), 'wind-account-'));
  const app = await createMobileService({ root });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}/api/mobile/v1`;
  const call = async (path, data, token) => {
    const response = await fetch(base + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json() };
  };
  return { ...app, root, call };
}
test('工作人员直接使用用户名和密码注册，管理人员仍须填写姓名', async () => {
  const app = await fixture();
  try {
    const worker = await app.call('/auth/register', {
      username: 'worker',
      password: '123456',
      role: 'worker',
    });
    assert.equal(worker.status, 201);
    assert.equal(worker.data.user.role, 'worker');
    assert.deepEqual(Object.keys(worker.data.user).sort(), ['id', 'name', 'role', 'username']);
    const missing = await app.call('/auth/register', {
      username: 'manager',
      password: '123456',
      role: 'admin',
    });
    assert.equal(missing.status, 400);
    assert.match(missing.data.error, /姓名/);
    const admin = await app.call('/auth/register', {
      username: 'manager',
      password: '123456',
      role: 'admin',
      name: '项目负责人',
    });
    assert.equal(admin.status, 201);
    assert.equal(admin.data.user.name, '项目负责人');
    const state = JSON.parse(await readFile(join(app.root, 'private/mobile-state.json'), 'utf8'));
    assert.equal(state.users.length, 2);
    assert.ok(
      state.users.every(
        (user) =>
          Object.keys(user).sort().join(',') ===
          'createdAt,id,name,passwordHash,role,salt,username',
      ),
    );
  } finally {
    await app.close();
  }
});
test('用户名规范化及并发唯一校验继续有效', async () => {
  const app = await fixture();
  try {
    const results = await Promise.all(
      ['ＮｅｗUser', 'newuser'].map((username) =>
        app.call('/auth/register', { username, password: '123456', role: 'worker' }),
      ),
    );
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  } finally {
    await app.close();
  }
});
test('注册后服务重启仍可登录，账号和姓名完整保留', async () => {
  let app = await fixture();
  const root = app.root;
  const registration = await app.call('/auth/register', {
    username: 'manager',
    password: '123456',
    role: 'admin',
    name: '项目负责人',
  });
  assert.equal(registration.status, 201);
  await app.close();
  app = await fixture(root);
  try {
    const login = await app.call('/auth/login', { username: 'manager', password: '123456' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, registration.data.user.id);
    assert.equal(login.data.user.name, '项目负责人');
  } finally {
    await app.close();
  }
});
test('兼容历史账号，人员资料只返回业务字段，工作人员无法读取其他用户', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wind-account-legacy-'));
  await mkdir(join(root, 'private'));
  const salt = randomBytes(16).toString('hex');
  await writeFile(
    join(root, 'private/mobile-state.json'),
    JSON.stringify({
      version: 1,
      users: [
        {
          id: randomUUID(),
          username: 'legacy-private-account',
          role: 'admin',
          phone: '13900001001',
          phoneVerifiedAt: new Date().toISOString(),
          salt,
          passwordHash: scryptSync('legacy-password', salt, 64).toString('hex'),
          createdAt: new Date().toISOString(),
        },
      ],
      uploads: [],
      reports: [],
      connection: null,
      phoneVerifications: [],
    }),
  );
  const app = await fixture(root);
  try {
    const old = await app.call('/auth/login', {
      username: 'legacy-private-account',
      password: 'legacy-password',
    });
    assert.equal(old.status, 200);
    assert.equal(old.data.user.phone, undefined);
    const worker = await app.call('/auth/register', {
      username: 'worker-private-account',
      password: '123456',
      role: 'worker',
    });
    assert.equal(worker.status, 201);
    assert.equal((await app.call('/admin/users')).status, 401);
    assert.equal((await app.call('/admin/users', undefined, worker.data.token)).status, 403);
    const directory = await app.call('/admin/users', undefined, old.data.token);
    assert.equal(directory.status, 200);
    assert.equal(directory.data.users.length, 2);
    assert.deepEqual(
      directory.data.users.map((user) => user.memberNumber),
      ['001', '002'],
    );
    const text = JSON.stringify(directory.data);
    for (const secret of [
      'legacy-private-account',
      'worker-private-account',
      '13900001001',
      'password',
      'salt',
      'username',
      'phone',
    ])
      assert.ok(!text.includes(secret));
    assert.equal(
      (await app.call('/auth/sms-code', { phone: '13900001002' }, old.data.token)).status,
      404,
    );
  } finally {
    await app.close();
  }
});
