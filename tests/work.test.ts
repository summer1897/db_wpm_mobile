import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clone,
  draftEntry,
  freshState,
  belongs,
  migrateState,
  validateEntry,
  isPending,
  canEdit,
  uuid,
  checksum,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  type Connection,
  type Entry,
  type Unit,
} from '../src/modules/work/domain';
import { WorkRepository } from '../src/modules/work/repository';
import { UploadRunner, emptyBatch, type BatchState, type SyncApi } from '../src/modules/work/sync';
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

/** 事项（风机）样本：V2 里记录必须挂在事项下 */
function unit(patch: Partial<Unit> = {}): Unit {
  return {
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
    ...patch,
  };
}

const netError = (message: string, status?: number) =>
  Object.assign(new Error(message), status ? { status } : {});

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
  const calls = { upload: 0, submit: 0 };
  const failOn = new Set<string>();
  const broken = new Set<string>();
  const batches: BatchState[] = [];
  const progressLog: Array<{ id: string; value: number }> = [];
  let authenticated = true,
    onUpload: ((entry: Entry) => void) | undefined;

  const api: SyncApi = {
    active: () => authenticated,
    connection: async () => connection,
    async upload(entry, attachment, progress) {
      calls.upload++;
      progress(40);
      progress(100);
      onUpload?.(entry);
      if (broken.has(entry.id)) throw new Error('回执中断');
      if (failOn.has(entry.id)) throw netError('附件上传失败', 502);
      return { id: uuid(), reused: false };
    },
    async submit(entry) {
      calls.submit++;
      if (failOn.has(entry.id)) throw netError('提交失败', 500);
      return {
        id: entry.id,
        serverId: uuid(),
        code: 'T20-20261029-001',
        createdAt: new Date().toISOString(),
        reviewStatus: '待审核',
        reviewStatusCode: 'pending',
      };
    },
  };

  const runner = new UploadRunner(repo, api, {
    changed: () => {},
    progress: (id, value) => progressLog.push({ id, value }),
    batch: (value) => batches.push(value),
  });

  return {
    repo,
    runner,
    calls,
    batches,
    progressLog,
    failOn,
    breakOn: (id: string) => broken.add(id),
    onUpload: (fn: (entry: Entry) => void) => {
      onUpload = fn;
    },
    disk: () => disk,
    failWrite: () => {
      failWrite = true;
    },
    logout: () => {
      authenticated = false;
    },
    /** 最后一次推送的批次状态 */
    batch: () => runner.batch,
  };
}

/** 造一条信息完整、可以直接上传的记录 */
async function complete(repo: WorkRepository, user = owner, board = unit()) {
  const row = await repo.createEntry(user, instance, board, 'hoist', 'hoist');
  return repo.update(row.id, user, instance, (item) => {
    item.title = '塔筒吊装';
    item.content = '完成第三节塔筒就位与螺栓紧固';
    item.attachments.push({
      id: uuid(),
      kind: 'photo',
      key: 'photos/test',
      name: '施工照片.png',
      size: 1024,
      mime: 'image/png',
    });
  });
}

test('表单校验：事项、类型、名称、日期与附件上限', async () => {
  const app = fixture();
  const board = unit();
  const row = draftEntry(owner, instance, board, 'hoist', 'hoist');
  assert.equal(row.unitId, board.id);
  assert.equal(row.unitCode, 'T20');
  assert.equal(row.status, 'draft');
  assert.match(validateEntry(row), /事项名称/);

  row.title = '塔筒吊装';
  assert.equal(validateEntry(row), '');

  row.typeCode = '';
  assert.match(validateEntry(row), /施工内容类型/);
  row.typeCode = 'hoist';

  row.workDate = '2026-02-30';
  assert.match(validateEntry(row), /施工日期/);
  row.workDate = '2026-10-29';

  row.content = 'x'.repeat(2001);
  assert.match(validateEntry(row), /2000/);
  row.content = '';

  row.attachments = Array.from({ length: MAX_PHOTOS + 1 }, () => ({
    id: uuid(),
    kind: 'photo' as const,
    name: 'a.png',
    mime: 'image/png',
    size: 1,
    key: 'k',
  }));
  assert.match(validateEntry(row), new RegExp(`最多上传${MAX_PHOTOS}`));

  row.attachments = [
    { id: uuid(), kind: 'photo', name: 'a.png', mime: 'image/png', size: MAX_PHOTO_BYTES + 1, key: 'k' },
  ];
  assert.match(validateEntry(row), /20 MB/);
  assert.equal(app.calls.upload, 0);
});

test('离线入队不上传，恢复网络后整批上传并逐条推进进度', async () => {
  const app = fixture();
  const first = await complete(app.repo);
  const second = await complete(app.repo);
  await app.runner.enqueueMany([first.id, second.id], owner, instance);

  // 断网：只入队，不发请求
  await app.runner.run(owner, instance, false);
  assert.equal(app.calls.upload, 0);
  assert.equal(app.calls.submit, 0);
  assert.ok(app.disk().entries.every((row) => row.status === 'queued'));

  await app.runner.run(owner, instance, true, { force: true });
  assert.equal(app.calls.submit, 2);
  assert.ok(app.disk().entries.every((row) => row.status === 'submitted'));
  assert.equal(app.disk().entries[0].code, 'T20-20261029-001');
  assert.equal(app.disk().entries[0].reviewStatusCode, 'pending');

  // 批次进度：从 0 出发、逐条递增、结束时 100%
  const percents = app.batches.map((item) => item.percent);
  assert.equal(percents[0], 0);
  assert.equal(percents.at(-1), 100);
  assert.ok(percents.includes(50));
  const final = app.batch();
  assert.equal(final.total, 2);
  assert.equal(final.done, 2);
  assert.equal(final.failed, 0);
  assert.equal(final.running, false);
  assert.match(final.message, /全部 2 条已上传完成/);
  // 每条记录都有独立的百分比回调
  assert.ok(app.progressLog.some((item) => item.id === first.id && item.value === 100));
  assert.ok(app.progressLog.some((item) => item.id === second.id && item.value < 100));
});

test('单条失败只影响自己：失败原因落库、其余继续上传', async () => {
  const app = fixture();
  const bad = await complete(app.repo);
  const good = await complete(app.repo);
  app.failOn.add(bad.id);
  await app.runner.enqueueMany([bad.id, good.id], owner, instance);
  await app.runner.run(owner, instance, true, { force: true });

  const failedRow = app.disk().entries.find((row) => row.id === bad.id)!;
  const okRow = app.disk().entries.find((row) => row.id === good.id)!;
  assert.equal(failedRow.status, 'failed');
  assert.match(failedRow.error!, /失败/);
  assert.equal(failedRow.attempts, 1);
  assert.ok(failedRow.nextRetryAt! > Date.now(), '失败后应进入退避窗口');
  assert.equal(okRow.status, 'submitted');

  const final = app.batch();
  assert.equal(final.total, 2);
  assert.equal(final.done, 1);
  assert.equal(final.failed, 1);
  assert.equal(final.percent, 100);
  assert.match(final.message, /1 条失败待重试/);

  // 退避期内自动同步不重跑，用户手动重试（force）才继续
  await app.runner.run(owner, instance, true);
  assert.equal(app.calls.submit, 1);
  app.failOn.delete(bad.id);
  await app.runner.run(owner, instance, true, { force: true });
  assert.equal(app.disk().entries.find((row) => row.id === bad.id)!.status, 'submitted');
  assert.equal(app.disk().entries.find((row) => row.id === bad.id)!.attempts, 0);
});

test('暂停后当前这条退回队列，已传附件不重传', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.runner.enqueueMany([row.id], owner, instance);
  // 附件传完就点暂停：不能算失败，也不能丢掉已到手的回执
  app.onUpload(() => app.runner.pause());
  await app.runner.run(owner, instance, true, { force: true });

  const paused = app.disk().entries.find((item) => item.id === row.id)!;
  assert.equal(paused.status, 'queued');
  assert.match(paused.error!, /暂停/);
  assert.equal(paused.attempts, undefined, '暂停不是失败，不累计重试次数');
  assert.ok(paused.attachments[0].remoteId, '已完成的附件要保留回执');
  assert.equal(app.calls.submit, 0);

  app.onUpload(() => {});
  await app.runner.run(owner, instance, true, { force: true });
  assert.equal(app.calls.upload, 1, '已传附件不再重传');
  assert.equal(app.disk().entries.find((item) => item.id === row.id)!.status, 'submitted');
});

test('重复点击不会并行上传；账号与实例相互隔离', async () => {
  const app = fixture();
  const mine = await complete(app.repo);
  const other = await complete(app.repo, uuid());
  await app.runner.enqueueMany([mine.id, other.id], owner, instance);
  await Promise.all([
    app.runner.run(owner, instance, true, { force: true }),
    app.runner.run(owner, instance, true, { force: true }),
  ]);
  assert.equal(app.calls.submit, 1);
  // 别人的记录既不入队也不上传，保持草稿
  assert.equal(app.disk().entries.find((row) => row.id === other.id)!.status, 'draft');
  assert.equal(belongs(mine, owner, 'c'.repeat(64)), false);
  assert.equal(belongs(other, owner, instance), false);
});

test('批量入队跳过不合格记录并写回原因', async () => {
  const app = fixture();
  const ok = await complete(app.repo);
  const blank = await app.repo.createEntry(owner, instance, unit(), 'hoist', 'hoist');
  const skipped = await app.runner.enqueueMany([ok.id, blank.id, uuid()], owner, instance);
  assert.deepEqual(skipped, [blank.id]);
  assert.equal(app.disk().entries.find((row) => row.id === ok.id)!.status, 'queued');
  const blankRow = app.disk().entries.find((row) => row.id === blank.id)!;
  assert.equal(blankRow.status, 'draft');
  assert.match(blankRow.error!, /事项名称/);
});

test('草稿编辑取消排队意图；上传中/已提交锁定', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.runner.enqueueMany([row.id], owner, instance);
  await app.repo.saveForm({ ...row, title: '尚未确认的新内容' });
  assert.equal(app.disk().entries[0].status, 'draft');
  await app.runner.run(owner, instance, true, { force: true });
  assert.equal(app.calls.submit, 0);

  await app.repo.update(row.id, owner, instance, (item) => {
    item.status = 'uploading';
  });
  assert.equal(canEdit(app.disk().entries[0]), false);
  await assert.rejects(app.repo.saveForm(row), /开始上传/);
  assert.equal(isPending(app.disk().entries[0]), true);
});

test('未认证不上传；重启后中断的任务回到待上传', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  await app.runner.enqueueMany([row.id], owner, instance);
  app.logout();
  await app.runner.run(owner, instance, true, { force: true });
  assert.equal(app.calls.upload, 0);

  const disk = clone(app.disk());
  disk.entries[0].status = 'uploading';
  const next = fixture(disk);
  await next.repo.initialize();
  assert.equal(next.disk().entries[0].status, 'queued');
});

test('空间不足时事务不覆盖已有数据，不伪报保存成功', async () => {
  const app = fixture();
  const row = await complete(app.repo);
  app.failWrite();
  await assert.rejects(
    app.repo.update(row.id, owner, instance, (item) => {
      item.title = '错误覆盖';
    }),
    /空间不足/,
  );
  assert.equal((await app.repo.read()).entries[0].title, '塔筒吊装');
});

test('V1 扁平数据不静默丢弃：保留地址与登录态并给出提示', () => {
  const legacy = {
    version: 1,
    records: [{ id: uuid() }, { id: uuid() }],
    settings: { endpoint: 'https://example.com/api', deviceOwner: 'dev-1' },
  };
  const state = migrateState(legacy);
  assert.equal(state.version, 2);
  assert.equal(state.entries.length, 0);
  assert.equal(state.settings.endpoint, 'https://example.com/api');
  assert.equal(state.settings.deviceOwner, 'dev-1');
  assert.match(state.storageNotice!, /2 条/);
  // 已是 V2 的数据原样返回，不做二次转换
  assert.equal(migrateState(freshState()).version, 2);
  assert.equal(migrateState(freshState()).storageNotice, undefined);
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

test('空队列批次回到空闲态，不残留上一条的进度', async () => {
  const app = fixture();
  await app.runner.run(owner, instance, true, { force: true });
  const batch = app.batch();
  assert.deepEqual(
    { running: batch.running, total: batch.total, percent: batch.percent },
    { running: false, total: 0, percent: 100 },
  );
  assert.match(batch.message, /没有待上传/);
  assert.deepEqual(emptyBatch().total, 0);
});
