import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConstructionServer } from '../../server/api.mjs';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';

test('显式连接另一个隔离大屏：上传进入同一台账并同步审核和删除', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wind-mobile-linked-'));
  const dashboard = await createConstructionServer({
    root: join(root, 'dashboard'),
    authentication: false,
  });
  dashboard.server.listen(0, '127.0.0.1');
  await once(dashboard.server, 'listening');
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const response = await fetch(origin + '/api/construction/intake-links', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'workDynamics',
      workId: 'intake-workDynamics',
      title: '联动测试',
      module: 'other',
    }),
  });
  const link = await response.json();
  const app = await createMobileService({ root: join(root, 'mobile') });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}/api/mobile/v1`;
  let bearer;
  async function call(path, body) {
    if (['/auth/register', '/users'].includes(path)) body = app.registrationFields(body);
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    bearer = (
      await call('/auth/register', {
        username: 'link-admin',
        password: '123456',
        role: 'admin',
      })
    ).data.token;
    const connected = await call('/admin/connect', {
      link: origin + '/upload#' + link.token,
    });
    assert.equal(connected.status, 200, JSON.stringify(connected));
    assert.equal(connected.data.mode, 'linked');
    const id = randomUUID();
    const meta = {
      id: randomUUID(),
      recordId: id,
      module: 'foundation',
      date: '2026-10-23',
      location: 'T8机位',
      name: '基础施工.png',
    };
    const file = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eoAAAAASUVORK5CYII=',
      'base64',
    );
    const uploaded = await fetch(base + '/photos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Meta': encodeURIComponent(JSON.stringify(meta)),
      },
      body: file,
    });
    const photo = await uploaded.json();
    assert.equal(uploaded.status, 201, JSON.stringify(photo));
    const saved = await call('/reports', {
      id,
      type: 'foundation',
      date: meta.date,
      location: meta.location,
      content: '基础施工过程记录',
      photoIds: [photo.id],
    });
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.equal(app.domain.store.data.logs.length, 0, '默认试用台账不能混入正式连接记录');
    assert.equal(dashboard.store.data.logs.length, 1);
    await dashboard.store.transaction((data) => {
      data.logs[0].reviewStatus = '退回修改';
      data.logs[0].content = '管理员核实后的施工说明';
    });
    const latest = (await call('/reports')).data;
    assert.equal(latest.reports[0].reviewStatus, '退回修改');
    assert.equal(latest.reports[0].content, '管理员核实后的施工说明');
    await dashboard.store.transaction((data) => {
      data.logs[0].archived = true;
    });
    assert.deepEqual((await call('/reports')).data.deletedIds, [id]);
    const deletedPhoto = await fetch(base + '/photos/' + photo.id, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    assert.equal(deletedPhoto.status, 404, '删除后的照片不能通过旧引用继续读取');
  } finally {
    await app.close();
    dashboard.server.closeAllConnections();
    await new Promise((done) => dashboard.server.close(done));
  }
});
