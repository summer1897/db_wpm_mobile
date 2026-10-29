import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/modules/work/api';
import * as backend from '../src/modules/work/backend';
import { draftEntry, uuid, type Attachment, type Entry, type Unit } from '../src/modules/work/domain';

const unit = (): Unit => ({
  id: uuid(),
  projectId: 1,
  typeCode: 'turbine',
  typeName: '风机',
  code: 'T20',
  name: 'T20 风机',
  location: '3# 机位',
  status: 'building',
  statusName: '施工中',
  progress: 0,
  doneSteps: 0,
  totalSteps: 10,
  entryCount: 0,
  attachmentCount: 0,
});

const photo = (key = `field-management/photos/${uuid()}`): Attachment => ({
  id: uuid(),
  kind: 'photo',
  key,
  name: '施工照片.png',
  size: 2048,
  mime: 'image/png',
});

function fixture() {
  api.clearSession();
  const requests: any[] = [];
  const uploads: any[] = [];
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
    uploadFile(args: any) {
      const task = {
        onProgressUpdate(callback: (event: { progress: number }) => void) {
          args.__progress = callback;
        },
        abort() {
          args.fail({ errMsg: 'aborted' });
        },
      };
      uploads.push({ args, task });
      return task;
    },
  };
  api.configureApi('https://project.example');
  // nest-admin 统一回执 { code, message, data }，登录数据在 data.token
  const reply = (index: number, data: object, statusCode = 200) => {
    const args = requests[index].args;
    args.success({ statusCode, data });
    args.complete();
  };
  async function login(token: string) {
    const index = requests.length;
    const result = backend.login('worker', 'not-stored', uuid(), '1234');
    reply(index, { code: 200, data: { token } });
    await result;
  }
  return { requests, uploads, reply, login };
}

/** H5 端照片存在 IndexedDB：假库只装一次（openBrowserDatabase 有缓存），用例间复用同一份 */
let browserRead: any;
let browserInstalled = false;
function installBrowserDatabase() {
  if (!browserInstalled) {
    browserInstalled = true;
    const db = {
      transaction() {
        return {
          objectStore() {
            return {
              get() {
                browserRead = {};
                return browserRead;
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
  }
  return {
    /** 模拟「大文件终于读完」 */
    finish(blob: Blob) {
      browserRead.result = blob;
      browserRead.onsuccess();
    },
    get pending() {
      return Boolean(browserRead);
    },
  };
}

test('迟到的旧会话401不能使新登录失效', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  const old = backend.request('/mobile/entries/mine?limit=500');
  const rejected = assert.rejects(old, /失效/);
  await app.login('b'.repeat(64));
  app.reply(1, { code: 401, message: '旧会话失效' }, 401);
  await rejected;
  assert.equal(backend.hasSession(), true);
  const next = backend.request('/mobile/entries/mine?limit=500');
  assert.equal(app.requests[3].args.header.Authorization, 'Bearer ' + 'b'.repeat(64));
  app.reply(3, { code: 200, data: { entries: [], serverTime: '' } });
  await next;
});

test('退出登录后新请求不携带令牌，迟到响应不恢复会话', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  const pending = backend.request('/mobile/entries/mine');
  api.clearSession();
  app.reply(1, { code: 200, data: { entries: [], serverTime: '' } });
  await pending;
  assert.equal(backend.hasSession(), false);
  const next = backend.request('/mobile/entries/mine');
  assert.equal('Authorization' in app.requests[2].args.header, false);
  app.reply(2, { code: 401, message: '未登录' }, 401);
  await assert.rejects(next, /失效/);
  assert.equal(backend.hasSession(), false);
});

test('读取大照片期间切换账号，迟到上传不能借用新账号令牌', async () => {
  const app = fixture();
  const db = installBrowserDatabase();
  await app.login('a'.repeat(64));
  const entry = draftEntry(uuid(), 'a'.repeat(64), unit(), 'hoist', 'hoist');
  const pending = api.uploadAttachment(entry, photo(), () => {});
  const rejected = assert.rejects(pending, /登录状态已变化/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(db.pending, '应先开始读本机照片');
  api.clearSession();
  await app.login('b'.repeat(64));
  db.finish(new Blob(['test'], { type: 'image/png' }));
  await rejected;
  assert.equal(app.uploads.length, 0, '不得用新账号令牌上传原账号照片');
  assert.equal(backend.hasSession(), true);
});

test('附件上传带元数据头，逐张进度回调并校验回执', async () => {
  const app = fixture();
  const db = installBrowserDatabase();
  await app.login('a'.repeat(64));
  const entry: Entry = draftEntry(uuid(), 'a'.repeat(64), unit(), 'hoist', 'hoist');
  const attachment = photo();
  const seen: number[] = [];
  const pending = api.uploadAttachment(entry, attachment, (value) => seen.push(value));
  await new Promise((resolve) => setImmediate(resolve));
  db.finish(new Blob(['test'], { type: 'image/png' }));
  await new Promise((resolve) => setImmediate(resolve));

  const call = app.uploads[0];
  assert.equal(call.args.url, 'https://project.example/api/mobile/attachments');
  assert.equal(call.args.name, 'file');
  assert.equal(call.args.header.Authorization, 'Bearer ' + 'a'.repeat(64));
  const meta = JSON.parse(decodeURIComponent(call.args.header['X-File-Meta']));
  assert.equal(meta.id, attachment.id);
  assert.equal(meta.unitId, entry.unitId);
  assert.equal(meta.kind, 'photo');

  call.args.__progress({ progress: 0 });
  call.args.__progress({ progress: 55 });
  call.args.__progress({ progress: 100 });
  assert.deepEqual(seen, [1, 55, 99], '进度收敛到 1~99，100% 只由提交结果决定');

  const attachmentId = uuid();
  call.args.success({
    statusCode: 200,
    data: JSON.stringify({ code: 200, data: { id: attachmentId, reused: false } }),
  });
  const receipt = await pending;
  assert.equal(receipt.id, attachmentId);
  assert.equal(receipt.reused, false);
});

test('附件上传失败按状态码报错，不伪报成功', async () => {
  const app = fixture();
  const db = installBrowserDatabase();
  await app.login('a'.repeat(64));
  const entry = draftEntry(uuid(), 'a'.repeat(64), unit(), 'hoist', 'hoist');
  const pending = api.uploadAttachment(entry, photo(), () => {});
  await new Promise((resolve) => setImmediate(resolve));
  db.finish(new Blob(['test'], { type: 'image/png' }));
  await new Promise((resolve) => setImmediate(resolve));
  app.uploads[0].args.success({
    statusCode: 413,
    data: JSON.stringify({ code: 1513, message: '文件超出限制' }),
  });
  await assert.rejects(pending, /文件超出限制/);
});

test('提交记录携带附件回执，回执不完整时拒绝认为成功', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  const entry = draftEntry(uuid(), 'a'.repeat(64), unit(), 'hoist', 'hoist');
  entry.title = '塔筒吊装';
  entry.content = '完成第三节就位';
  entry.attachments.push({ ...photo(), remoteId: uuid() });

  const ok = api.submitEntry(entry);
  const payload = app.requests[1].args.data;
  assert.equal(payload.id, entry.id);
  assert.equal(payload.title, '塔筒吊装');
  assert.equal(payload.stepCode, 'hoist');
  assert.equal(payload.attachmentIds.length, 1);
  app.reply(1, {
    code: 200,
    data: {
      id: entry.id,
      serverId: uuid(),
      code: 'T20-20261029-001',
      createdAt: new Date().toISOString(),
      reviewStatus: '待审核',
      reviewStatusCode: 'pending',
    },
  });
  const receipt = await ok;
  assert.equal(receipt.code, 'T20-20261029-001');

  // 回执 id 与本地 UUID 不一致：宁可报错也不能当成已提交
  const wrong = api.submitEntry(entry);
  app.reply(2, { code: 200, data: { id: uuid(), serverId: uuid(), code: 'X' } });
  await assert.rejects(wrong, /回执不完整/);
});

test('字典与事项列表回执异常时抛错，正常回执按 V2 结构解析', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));

  const dict = api.getDict();
  app.reply(1, { code: 200, data: { unitTypes: 'oops' } });
  await assert.rejects(dict, /字典回执异常/);

  const badUnits = api.getUnits(1);
  app.reply(2, { code: 200, data: { total: 0 } });
  await assert.rejects(badUnits, /事项列表回执异常/);

  const units = api.getUnits(1);
  assert.match(app.requests[3].args.url, /\/mobile\/units\?projectId=1&page=1&pageSize=100$/);
  app.reply(3, { code: 200, data: { items: [unit()], total: 1 } });
  const list = await units;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].code, 'T20');

  const good = api.getDict();
  app.reply(4, {
    code: 200,
    data: { unitTypes: [{ code: 'turbine', name: '风机', codeLabel: '编号' }], entryTypes: [], steps: [] },
  });
  const value = await good;
  assert.equal(value.unitTypes.length, 1);
  assert.ok(value.at, '字典要记录本地缓存时间');
});

test('上传中心与台账接口：异常回执不覆盖本机数据', async () => {
  const app = fixture();
  await app.login('a'.repeat(64));
  const ledger = api.getLedger();
  app.reply(1, { code: 200, data: { summary: null } });
  await assert.rejects(ledger, /台账回执异常/);

  const mine = api.getMine();
  app.reply(2, { code: 200, data: {} });
  await assert.rejects(mine, /同步回执异常/);
});
