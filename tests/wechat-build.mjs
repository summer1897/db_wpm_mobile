/** 用实际编译出的微信存储/业务模块和真实临时文件验证，不依赖 TypeScript 测试替换平台分支。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  accessSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
test('实际微信编译产物：首次建账、重启恢复、空缓存抛错兼容和损坏保护', async () => {
  const build = fileURLToPath(new URL('../../miniprogram/client/', import.meta.url));
  const root = mkdtempSync(join(tmpdir(), 'wind-wx-build-'));
  let missingReads = 0;
  const fs = {
    mkdirSync: (path, recursive) => mkdirSync(path, { recursive }),
    accessSync,
    readdirSync,
    readFileSync,
    writeFile: ({ filePath, data, encoding, success, fail }) => {
      try {
        writeFileSync(filePath, data, encoding);
        success({});
      } catch (error) {
        fail(error);
      }
    },
    readFile: ({ filePath, encoding, success, fail }) => {
      try {
        success({ data: readFileSync(filePath, encoding) });
      } catch (error) {
        fail(error);
      }
    },
  };
  const wx = {
    env: { USER_DATA_PATH: root },
    getFileSystemManager: () => fs,
    getStorageInfoSync: () => ({ keys: [] }),
    getStorageSync: () => {
      missingReads++;
      throw { errMsg: 'getStorageSync:fail data not found' };
    },
  };
  function load(file, cache = new Map()) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    runInNewContext(
      readFileSync(file, 'utf8'),
      {
        module,
        exports: module.exports,
        require: (name) =>
          name.endsWith('common/vendor.js')
            ? { wx$1: wx }
            : load(resolve(dirname(file), name), cache),
      },
      { filename: file },
    );
    return module.exports;
  }
  const { createStateDriver } = load(join(build, 'modules/platform/storage.js'));
  const { WorkRepository } = load(join(build, 'modules/work/repository.js'));
  const { uuid } = load(join(build, 'modules/work/domain.js'));
  const repo = new WorkRepository(createStateDriver());
  await repo.initialize();
  const record = await repo.create(uuid(), 'a'.repeat(64), 'foundation');
  assert.equal(missingReads, 0, '不得读取根本不存在的旧键');
  const restored = new WorkRepository(createStateDriver());
  assert.equal((await restored.read()).records[0].id, record.id);
  const directory = join(root, 'wind-field');
  writeFileSync(join(directory, 'state-0.json'), '');
  assert.equal((await new WorkRepository(createStateDriver()).read()).records[0].id, record.id);
  writeFileSync(join(directory, 'state-1.json'), '');
  await assert.rejects(new WorkRepository(createStateDriver()).initialize(), /损坏/);
  assert.equal(readFileSync(join(directory, 'state-0.json'), 'utf8'), '');
  assert.equal(readFileSync(join(directory, 'state-1.json'), 'utf8'), '');
});
