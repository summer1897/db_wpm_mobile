import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshState, draftEntry, uuid, type Unit } from '../src/modules/work/domain';

function unit(): Unit {
  return {
    id: uuid(),
    projectId: 1,
    typeCode: 'turbine',
    typeName: '风机',
    code: 'T20',
    name: '',
    location: '',
    status: 'planning',
    statusName: '待施工',
    progress: 0,
    doneSteps: 0,
    totalSteps: 10,
    entryCount: 0,
    attachmentCount: 0,
  };
}
test('初始化错误保留具体原因；重试不清空原记录，成功后不重复初始化', async () => {
  const { initialize, retryLocalStorage, repository, state } = await import(
    '../src/modules/work/store'
  );
  const savedInitialize = repository.initialize.bind(repository);
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldUni = Object.getOwnPropertyDescriptor(globalThis, 'uni');
  const snapshot = freshState();
  const record = draftEntry(uuid(), 'a'.repeat(64), unit());
  record.location = '未上传资料必须保留';
  snapshot.entries.push(record);
  let calls = 0;
  repository.initialize = async () => {
    calls++;
    if (calls === 1) throw new Error('无法读取本机缓存目录，请保留应用数据并重新打开小程序');
    return snapshot;
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener() {} },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'uni', {
    configurable: true,
    value: {
      getNetworkType(input: any) {
        input.success({ networkType: 'wifi' });
        input.complete();
      },
      onNetworkStatusChange() {},
    },
  });
  try {
    await initialize();
    assert.equal(state.local, null);
    assert.equal(state.ready, true);
    assert.match(state.storageError, /缓存目录/);
    await initialize();
    assert.equal(calls, 1, '错误状态不自动反复写盘');
    await retryLocalStorage();
    assert.equal(calls, 2);
    assert.equal(state.local!.entries[0].id, record.id);
    assert.equal(state.local!.entries[0].location, record.location);
    assert.equal(state.storageError, '');
    await retryLocalStorage();
    assert.equal(calls, 2);
  } finally {
    repository.initialize = savedInitialize;
    for (const [key, descriptor] of [
      ['window', oldWindow],
      ['navigator', oldNavigator],
      ['uni', oldUni],
    ] as const)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});
