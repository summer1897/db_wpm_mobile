import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { checksum, freshState, uuid } from '../src/modules/work/domain';
import { createNativeDriver, createWechatDriver } from '../src/modules/platform/storage';
import { WorkRepository } from '../src/modules/work/repository';
function wxFixture(options: { missingFileMessage?: string; missingStorageThrows?: boolean } = {}) {
  const files = new Map<string, string>(),
    values = new Map<string, string>();
  let failWrite = false;
  const fs = {
    mkdirSync() {},
    accessSync() {},
    readdirSync(directory: string) {
      return [...files.keys()]
        .filter((path) => path.startsWith(directory + '/'))
        .map((path) => path.slice(directory.length + 1));
    },
    readFileSync(path: string) {
      if (!files.has(path))
        throw {
          errMsg: options.missingFileMessage || 'readFileSync:fail no such file or directory',
        };
      return files.get(path);
    },
    writeFile(args: any) {
      if (failWrite) {
        args.fail(new Error('存储不足'));
        return;
      }
      files.set(args.filePath, args.data);
      args.success({});
    },
    readFile(args: any) {
      args.success({ data: files.get(args.filePath) });
    },
  };
  (globalThis as any).wx = {
    env: { USER_DATA_PATH: '/private' },
    getFileSystemManager: () => fs,
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
    getStorageSync: (key: string) => {
      if (!values.has(key) && options.missingStorageThrows)
        throw { errMsg: 'getStorageSync:fail data not found' };
      return values.get(key);
    },
  };
  return {
    files,
    values,
    fail: () => {
      failWrite = true;
    },
  };
}
test('微信首次运行：旧缓存不存在且同步读取抛错时仍能创建本机台账', async () => {
  const mock = wxFixture({ missingStorageThrows: true });
  const repo = new WorkRepository(createWechatDriver());
  await repo.initialize();
  assert.equal((await repo.read()).records.length, 0);
  assert.equal(mock.files.size, 1);
});
test('微信首次运行：不依赖工具/真机缺失文件的英文错误格式', async () => {
  const mock = wxFixture({ missingFileMessage: 'readFileSync:fail operation failed (1300002)' });
  const repo = new WorkRepository(createWechatDriver());
  await repo.initialize();
  assert.ok((await repo.read()).settings.deviceOwner);
  assert.equal(mock.files.size, 1);
});
test('微信空文件属于异常快照，不得当作首次使用并覆盖', async () => {
  const mock = wxFixture();
  mock.files.set('/private/wind-field/state-0.json', '');
  await assert.rejects(new WorkRepository(createWechatDriver()).initialize(), /损坏/);
  assert.equal(mock.files.get('/private/wind-field/state-0.json'), '');
  assert.equal(mock.files.size, 1);
});
test('微信缓存目录读取失败时停止初始化，不能悄悄跳过历史资料', async () => {
  const mock = wxFixture();
  (globalThis as any).wx.getStorageInfoSync = () => {
    throw new Error('storage unavailable');
  };
  await assert.rejects(new WorkRepository(createWechatDriver()).initialize(), /缓存|storage/);
  assert.equal(mock.files.size, 0);
});
test('微信已有文件读取失败时不得降级为空台账，文件原样保留', async () => {
  const mock = wxFixture();
  const original = '历史台账不得覆盖';
  mock.files.set('/private/wind-field/state-0.json', original);
  (globalThis as any).wx.getFileSystemManager().readFileSync = () => {
    throw new Error('EACCES');
  };
  await assert.rejects(new WorkRepository(createWechatDriver()).initialize(), /已有本机台账/);
  assert.equal(mock.files.get('/private/wind-field/state-0.json'), original);
});
test('微信一份快照为空时恢复另一份有效记录，并保留照片引用', async () => {
  const mock = wxFixture();
  const repo = new WorkRepository(createWechatDriver());
  await repo.initialize();
  const record = await repo.create(uuid(), 'a'.repeat(64), 'foundation');
  mock.files.set('/private/wind-field/state-0.json', '');
  const restored = new WorkRepository(createWechatDriver());
  const value = await restored.read();
  assert.equal(value.records[0].id, record.id);
  assert.match(value.storageNotice || '', /恢复有效台账/);
});
test('微信真实驱动协议：持久化、重启恢复、双快照损坏保护和空间不足回滚', async () => {
  const mock = wxFixture();
  const repo = new WorkRepository(createWechatDriver());
  await repo.initialize();
  const row = await repo.create(uuid(), 'a'.repeat(64), 'lifting');
  assert.equal(mock.files.size, 2);
  const restored = new WorkRepository(createWechatDriver());
  assert.equal((await restored.read()).records[0].id, row.id);
  mock.fail();
  await assert.rejects(
    restored.update(row.id, row.owner, row.instance!, (item) => {
      item.location = '不能覆盖';
    }),
    /存储不足/,
  );
  assert.equal((await restored.read()).records[0].location, '');
  for (const path of mock.files.keys()) mock.files.set(path, '{damaged');
  await assert.rejects(new WorkRepository(createWechatDriver()).initialize(), /损坏/);
});
test('旧微信草稿兼容：保留照片路径，旧键值不删除、不持久化会话或密码', async () => {
  const mock = wxFixture();
  const id = uuid(),
    photoId = uuid();
  const old = {
    version: 1,
    endpoint: 'https://project.example',
    records: [
      {
        id,
        owner: uuid(),
        type: 'road',
        date: '2026-10-25',
        location: 'K1+200',
        content: '路基施工',
        photos: [
          {
            id: photoId,
            path: '/private/field-photos/photo.png',
            name: '施工照片.png',
            size: 100,
            mime: 'image/png',
          },
        ],
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: 1,
      },
    ],
  };
  const payload = JSON.stringify(old);
  mock.values.set(
    'wind-field-wechat-v1-a',
    JSON.stringify({ sequence: 4, payload, checksum: checksum(payload) }),
  );
  const repo = new WorkRepository(createWechatDriver());
  await repo.initialize();
  const state = await repo.read();
  assert.equal(state.records[0].id, id);
  assert.equal(state.records[0].photos[0].key, '/private/field-photos/photo.png');
  assert.equal(state.settings.endpoint, old.endpoint);
  assert.equal(mock.values.size, 1);
});
test('APP SQLite 驱动：真实 SQL 事务、中文/引号转义、提交和回滚', async () => {
  const db = new DatabaseSync(':memory:');
  const initial = freshState();
  let failInsert = false;
  db.exec('CREATE TABLE snapshots(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
  db.prepare('INSERT INTO snapshots(id,value) VALUES(1,?)').run(JSON.stringify(initial));
  (globalThis as any).plus = {
    sqlite: {
      isOpenDatabase: () => true,
      openDatabase: (args: any) => args.success({}),
      executeSql: (args: any) => {
        try {
          if (failInsert && args.sql.startsWith('INSERT')) throw new Error('disk full');
          db.exec(args.sql);
          args.success({});
        } catch (error) {
          args.fail(error);
        }
      },
      selectSql: (args: any) => {
        try {
          args.success(db.prepare(args.sql).all());
        } catch (error) {
          args.fail(error);
        }
      },
      transaction: (args: any) => {
        try {
          db.exec(args.operation.toUpperCase());
          args.success({});
        } catch (error) {
          args.fail(error);
        }
      },
    },
  };
  try {
    const repo = new WorkRepository(createNativeDriver());
    await repo.initialize();
    const row = await repo.create(uuid(), 'a'.repeat(64), 'foundation');
    await repo.update(row.id, row.owner, row.instance!, (item) => {
      item.location = "O'Brien 施工区";
    });
    const restored = new WorkRepository(createNativeDriver());
    assert.equal((await restored.read()).records[0].location, "O'Brien 施工区");
    failInsert = true;
    await assert.rejects(
      restored.update(row.id, row.owner, row.instance!, (item) => {
        item.location = '失败更改';
      }),
      /disk full/,
    );
    assert.equal(
      (await new WorkRepository(createNativeDriver()).read()).records[0].location,
      "O'Brien 施工区",
    );
  } finally {
    db.close();
  }
});
