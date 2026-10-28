import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestMobileService as createMobileService } from './account-fixture.mjs';
import { createMobileGateway } from '../server/gateway.mjs';
test('统一 multipart 通道：鉴权、照片、真实归档、重复提交、跨账号隔离及来源限制', async () => {
  const mobile = await createMobileService({
    root: await mkdtemp(join(tmpdir(), 'wind-uni-gateway-')),
  });
  mobile.server.listen(0, '127.0.0.1');
  await once(mobile.server, 'listening');
  const gateway = createMobileGateway({
    upstreamOrigin: `http://127.0.0.1:${mobile.server.address().port}`,
    allowedOrigins: ['http://127.0.0.1:5188'],
  });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const call = async (path, data, token = '', extra = {}) => {
    if (['/auth/register', '/users'].includes(path)) data = mobile.registrationFields(data);
    const response = await fetch(origin + '/api/mobile/v1' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        'Content-Type': 'application/json',
        ...extra,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await call('/reports')).status, 401);
    assert.equal(
      (await call('/config', undefined, '', { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal((await call('/anywhere')).status, 404);
    const registration = await call('/auth/register', {
      username: '测试管理员',
      role: 'admin',
      password: '123456',
    });
    const { token } = registration.data;
    assert.equal(registration.status, 201);
    assert.ok(registration.data.offlineUntil > Date.now());
    const recordId = randomUUID(),
      photoId = randomUUID();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1eoAAAAASUVORK5CYII=',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), '现场.png');
    const metadata = encodeURIComponent(
      JSON.stringify({
        id: photoId,
        recordId,
        module: 'transport',
        date: '2026-10-25',
        location: 'T08',
        name: '施工照片.png',
      }),
    );
    const sendPhoto = () =>
      fetch(origin + '/api/mobile/v1/photos', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'X-File-Meta': metadata },
        body: form,
      });
    const response = await sendPhoto();
    assert.equal(response.status, 201);
    const photo = await response.json();
    const repeat = await sendPhoto();
    assert.equal((await repeat.json()).id, photo.id);
    const report = {
      id: recordId,
      type: 'transport',
      date: '2026-10-25',
      location: 'T08',
      content: '叶片运输完成进场检查',
      photoIds: [photo.id],
    };
    assert.equal((await call('/reports', report, token)).status, 201);
    assert.equal((await call('/reports', report, token)).status, 200);
    assert.equal(mobile.domain.store.data.logs.length, 1);
    assert.equal(mobile.domain.store.data.materials.length, 1);
    assert.match(mobile.domain.store.data.materials[0].storagePath, /近期工作动态图片\/风机运输/);
    const read = await fetch(origin + '/api/mobile/v1/photos/' + photo.id, {
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
    await call('/users', { username: '另一人员', password: '123456' }, token);
    const worker = (await call('/auth/login', { username: '另一人员', password: '123456' })).data;
    assert.equal((await call('/reports', undefined, worker.token)).data.reports.length, 0);
    assert.equal(
      (
        await fetch(origin + '/api/mobile/v1/photos/' + photo.id, {
          headers: { Authorization: 'Bearer ' + worker.token },
        })
      ).status,
      404,
    );
    const preflight = await fetch(origin + '/api/mobile/v1/reports', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5188',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5188');
  } finally {
    await gateway.close();
    await mobile.close();
  }
});
