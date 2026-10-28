import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clone,
  constructionTypes,
  freshState,
  belongs,
  draft,
  normalizeEndpoint,
  validateRecord,
  uuid,
  checksum,
  type Connection,
} from '../src/modules/work/domain';
import { WorkRepository } from '../src/modules/work/repository';
import { UploadQueue, type SyncApi } from '../src/modules/work/sync';
import { selectSnapshot } from '../src/modules/platform/storage';
const owner = uuid(),
  instance = 'a'.repeat(64),
  scope = 'b'.repeat(64);
const connection: Connection = {
  service: 'wind-field-mobile',
  instance,
  scope,
  mode: 'trial',
  projectName: '测试项目',
  registrationOpen: false,
};
function fixture(initial = freshState()) {
  let disk = clone(initial),
    failWrite = false;
  const repo = new WorkRepository({
    async read() {
      return clone(disk);
    },
    async write(value) {
      if (failWrite) throw new Error('空间不足');
      disk = clone(value);
    },
  });
  const calls = { photo: 0, submit: 0 },
    receipts = new Map<string, { id: string; scope: string }>();
  let brokenPhoto = false,
    brokenSubmit = false,
    authenticated = true;
  const api: SyncApi = {
    active: () => authenticated,
    connection: async () => connection,
    async photo(_row, photo) {
      calls.photo++;
      const result = receipts.get(photo.id) || { id: uuid(), scope };
      receipts.set(photo.id, result);
      if (brokenPhoto) {
        brokenPhoto = false;
        throw new Error('回执中断');
      }
      return result;
    },
    async submit(row) {
      calls.submit++;
      if (brokenSubmit) {
        brokenSubmit = false;
        throw new Error('回执中断');
      }
      return {
        id: row.id,
        serverId: uuid(),
        createdAt: new Date().toISOString(),
        reviewStatus: '已审核',
      };
    },
  };
  const queue = new UploadQueue(
    repo,
    api,
    () => {},
    () => {},
  );
  return {
    repo,
    queue,
    calls,
    receipts,
    disk: () => disk,
    fail: () => {
      failWrite = true;
    },
    breakPhoto: () => {
      brokenPhoto = true;
    },
    breakSubmit: () => {
      brokenSubmit = true;
    },
    logout: () => {
      authenticated = false;
    },
  };
}
async function complete(repo: WorkRepository, user = owner) {
  const row = await repo.create(user, instance, 'transport');
  return repo.update(row.id, user, instance, (item) => {
    item.location = 'T08 进场道路';
    item.content = '叶片进场，完成外观检查';
    item.photos.push({
      id: uuid(),
      key: 'photos/test',
      name: '施工照片.png',
      size: 100,
      mime: 'image/png',
    });
  });
}
test('七种施工类型完整，验收不单独造类别，表单与服务地址校验', () => {
  assert.equal(constructionTypes.length, 7);
  assert.ok(constructionTypes.some((item) => item.id === 'transport'));
  assert.ok(!constructionTypes.some((item) => /验收/.test(item.name)));
  assert.match(validateRecord(draft(owner, instance)), /施工类型/);
  assert.equal(normalizeEndpoint('', true), '/api/mobile/v1');
  assert.throws(() => normalizeEndpoint(''), /配置/);
  for (const value of [
    'http://public.example',
    'https://user:pass@example.com',
    'https://example.com/upload#secret',
    'javascript:alert(1)',
  ])
    assert.throws(() => normalizeEndpoint(value));
  assert.equal(
    normalizeEndpoint('http://192.168.1.8:8791'),
    'http://192.168.1.8:8791/api/mobile/v1',
  );
});
test('断网提交持久化待办，草稿绝不自动发布', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  const untouched = await app.repo.create(owner, instance, 'road');
  await app.queue.enqueue(row.id, owner, instance);
  await app.queue.run(owner, instance, false);
  assert.equal(app.disk().records.find((item) => item.id === row.id)?.status, 'queued');
  assert.equal(app.calls.submit, 0);
  await app.queue.run(owner, instance, true);
  assert.equal(app.calls.submit, 1);
  assert.equal(app.disk().records.find((item) => item.id === untouched.id)?.status, 'draft');
});
test('照片已到达但回执丢失：重试沿用同一编号，只有最终回执才显示提交成功', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  app.breakPhoto();
  await app.queue.enqueue(row.id, owner, instance);
  await app.queue.run(owner, instance, true);
  assert.equal(app.disk().records[0].status, 'failed');
  assert.equal(app.calls.submit, 0);
  assert.equal(app.receipts.size, 1);
  await app.queue.run(owner, instance, true, true);
  assert.equal(app.disk().records[0].status, 'submitted');
  assert.equal(app.receipts.size, 1);
  assert.equal(app.calls.photo, 2);
});
test('最终回执丢失不重复传图，任务恢复时保留照片回执和同一记录编号', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  app.breakSubmit();
  await app.queue.enqueue(row.id, owner, instance);
  await app.queue.run(owner, instance, true);
  assert.equal(app.disk().records[0].status, 'failed');
  assert.ok(app.disk().records[0].photos[0].remoteId);
  await app.queue.run(owner, instance, true, true);
  assert.equal(app.calls.photo, 1);
  assert.equal(app.calls.submit, 2);
  assert.equal(app.disk().records[0].id, row.id);
});
test('队列互斥，重复点击不会并行发布；账号与服务器实例隔离', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  const other = await complete(app.repo, uuid());
  await app.queue.enqueue(row.id, owner, instance);
  await app.queue.enqueue(other.id, other.owner, instance);
  await Promise.all([app.queue.run(owner, instance, true), app.queue.run(owner, instance, true)]);
  assert.equal(app.calls.submit, 1);
  assert.equal(app.disk().records.find((item) => item.id === other.id)?.status, 'queued');
  assert.equal(belongs(row, owner, 'c'.repeat(64)), false);
  assert.equal(belongs(other, owner, instance), false);
});
test('未认证不上传，重启中断恢复队列，原草稿不变', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.queue.enqueue(row.id, owner, instance);
  app.logout();
  await app.queue.run(owner, instance, true);
  assert.equal(app.calls.photo, 0);
  const disk = clone(app.disk());
  disk.records[0].status = 'uploading';
  const next = fixture(disk);
  await next.repo.initialize();
  assert.equal(next.disk().records[0].status, 'queued');
});
test('空间不足时事务不覆盖已有台账，不伪报保存成功', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  app.fail();
  await assert.rejects(
    app.repo.update(row.id, owner, instance, (item) => {
      item.location = '错误覆盖';
    }),
    /空间不足/,
  );
  assert.equal((await app.repo.read()).records[0].location, 'T08 进场道路');
});
test('项目通道切换必须停止原任务，不将旧照片自动转发', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.repo.update(row.id, owner, instance, (item) => {
    item.scope = 'd'.repeat(64);
  });
  await app.queue.enqueue(row.id, owner, instance);
  await app.queue.run(owner, instance, true);
  assert.equal(app.calls.photo, 0);
  assert.equal(app.calls.submit, 0);
  assert.match(app.disk().records[0].error!, /通道已更换/);
});
test('草稿编辑后取消已排队发布意图；部分上传内容锁定', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.queue.enqueue(row.id, owner, instance);
  await app.repo.saveForm({ ...row, content: '尚未确认的新内容' });
  await app.queue.run(owner, instance, true);
  assert.equal(app.calls.submit, 0);
  await app.repo.update(row.id, owner, instance, (item) => {
    item.photos[0].remoteId = uuid();
  });
  await assert.rejects(app.repo.saveForm(row), /开始归档/);
});
test('远端审核/删除联动仅更新当前账号通道，不覆盖未确认的上传任务', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.queue.enqueue(row.id, owner, instance);
  await app.queue.run(owner, instance, true);
  const remote = clone(app.disk().records[0]);
  remote.reviewStatus = '退回修改';
  await app.repo.merge([remote], [], owner, instance, scope);
  assert.equal(app.disk().records[0].reviewStatus, '退回修改');
  await app.repo.merge([], [row.id], owner, instance, scope);
  assert.equal(app.disk().records.length, 0);
});
test('A/B 快照选择最新有效版本，两份损坏时拒绝覆盖', () => {
  const payload = JSON.stringify(freshState());
  const snapshot = JSON.stringify({
    sequence: 3,
    payload,
    checksum: checksum(payload),
  });
  assert.equal(selectSnapshot([snapshot, '{broken'])?.sequence, 3);
  assert.throws(() => selectSnapshot(['{broken', 'bad']), /损坏/);
  assert.equal(selectSnapshot([undefined, undefined]), undefined);
});
