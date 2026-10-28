import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/modules/work/api';
import { draft, uuid } from '../src/modules/work/domain';
function fixture() {
  api.clearSession();
  const requests: any[] = [];
  let uploads = 0;
  (globalThis as any).uni = {
    request(args: any) {
      const item = {
        args,
        abort() {
          args.fail({ errMsg: 'aborted' });
          args.complete();
        },
      };
      requests.push(item);
      return item;
    },
    uploadFile() {
      uploads++;
      throw new Error('不应开始上传');
    },
  };
  api.configureApi('https://project.example');
  const reply = (index: number, data: object, statusCode = 200) => {
    const args = requests[index].args;
    args.success({ statusCode, data });
    args.complete();
  };
  async function login(token: string) {
    const index = requests.length;
    const result = api.login('worker', 'not-stored');
    reply(index, {
      token,
      user: { id: uuid(), username: 'worker', name: '张工', role: 'worker' },
    });
    await result;
  }
  return { requests, reply, login, uploads: () => uploads };
}
test('迟到的旧会话401不能使新登录失效', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  const old = api.request('/reports');
  const rejected = assert.rejects(old, /失效/);
  await app.login('b'.repeat(64));
  app.reply(1, { error: '旧会话失效' }, 401);
  await rejected;
  assert.equal(api.hasSession(), true);
  const next = api.request('/reports');
  assert.equal(app.requests[3].args.header.Authorization, 'Bearer ' + 'b'.repeat(64));
  app.reply(3, { reports: [], deletedIds: [] });
  await next;
});
test('退出登录取消所有进行中的请求，不落盘密码/会话', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  const pending = api.request('/reports');
  const rejected = assert.rejects(pending, /保留/);
  api.clearSession();
  await rejected;
  assert.equal(api.hasSession(), false);
});
test('读取大照片期间切换账号，迟到上传不能借用新账号令牌', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  let fileRead: any;
  const db = {
    transaction() {
      return {
        objectStore() {
          return {
            get() {
              fileRead = {};
              return fileRead;
            },
          };
        },
      };
    },
  };
  (globalThis as any).indexedDB = {
    open() {
      const request: any = { result: db };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  const row = draft(uuid(), 'a'.repeat(64), 'foundation');
  const photo = {
    id: uuid(),
    key: 'field-management/photos/async-test',
    name: '施工照片.png',
    size: 100,
    mime: 'image/png',
  };
  const pending = api.uploadPhoto(row, photo, () => {});
  const rejected = assert.rejects(pending, /登录状态已变化/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(fileRead);
  api.clearSession();
  await app.login('b'.repeat(64));
  fileRead.result = new Blob(['test'], { type: 'image/png' });
  fileRead.onsuccess();
  await rejected;
  assert.equal(app.uploads(), 0);
  assert.equal(api.hasSession(), true);
});
