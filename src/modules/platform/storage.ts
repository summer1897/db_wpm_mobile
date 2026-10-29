import { checksum, clone, validateState, type LocalState } from '../work/domain';
import type { StateDriver } from '../work/repository';
declare const wx: any;
declare const plus: any;
let browserDatabase: Promise<IDBDatabase>;
// #ifdef H5
export function openBrowserDatabase() {
  return (browserDatabase ||= new Promise((resolve, reject) => {
    // 复用旧 APP 浏览器库名，不清除以前的草稿及照片。
    const request = indexedDB.open('wind-field-management-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('state');
      request.result.createObjectStore('photos');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('本机存储不可用，请检查浏览器存储权限'));
    request.onblocked = () => reject(new Error('请关闭其他版本的现场管理页面后重试'));
  }));
}
// #endif
const fsCall = (fs: any, method: string, args: object) =>
  new Promise<any>((resolve, reject) => fs[method]({ ...args, success: resolve, fail: reject }));
type Snapshot = { sequence: number; payload: string; checksum: string };
/** 同包名升级时尝试读取旧 Capacitor 私有目录；只读迁移，绝不删除旧台账和照片。需在真机验收。 */
async function readLegacyNative(): Promise<LocalState | undefined> {
  let directory: string;
  try {
    if (plus.os.name === 'Android') {
      // 5+ Runtime 对链式 Java 调用返回值的包装在不同基座上不一致，
      // 直接 .getFilesDir().getAbsolutePath() 在部分真机上报 is not a function，
      // 必须用 plus.android.invoke 显式调用每一层。
      const activity = plus.android.runtimeMainActivity();
      const filesDir = plus.android.invoke(activity, 'getFilesDir');
      directory = String(plus.android.invoke(filesDir, 'getAbsolutePath'));
    } else {
      const manager = plus.ios.invoke('NSFileManager', 'defaultManager');
      const urls = plus.ios.invoke(manager, 'URLsForDirectory:inDomains:', 9, 1);
      const url = plus.ios.invoke(urls, 'objectAtIndex:', 0);
      directory = String(plus.ios.invoke(url, 'path'));
    }
  } catch {
    // 无法定位旧目录时按「无旧资料」继续，不让迁移逻辑卡死新安装的初始化。
    return undefined;
  }
  const read = (name: string) =>
    new Promise<string | undefined>((resolve) =>
      plus.io.resolveLocalFileSystemURL(
        'file://' + directory + '/field-management/' + name,
        (entry: any) =>
          entry.file((file: any) => {
            const reader = new plus.io.FileReader();
            reader.onloadend = (event: any) => resolve(String(event.target.result));
            reader.onerror = () => resolve(undefined);
            reader.readAsText(file, 'utf-8');
          }, () => resolve(undefined)),
        // 旧资料目录不存在/无法访问一律按「无旧资料」处理：
        // 部分基座对不存在的路径返回的 code 不是 1（如中文「路径不存在」），
        // 不能因此卡死全新安装的本机存储初始化。
        () => resolve(undefined),
      ),
    );
  const snapshots = await Promise.all(['state-a.json', 'state-b.json'].map(read));
  const valid: { generation: number; state: LocalState }[] = [];
  for (const text of snapshots)
    if (text) {
      try {
        const item = JSON.parse(text);
        if (Number.isSafeInteger(item.generation) && item.generation > 0)
          valid.push({
            generation: item.generation,
            state: validateState(item.data),
          });
      } catch {
        /* 单个旧快照损坏时读取另一个。 */
      }
    }
  if (snapshots.some(Boolean) && !valid.length)
    throw new Error('旧版 APP 本机资料无法读取，请保留应用数据联系管理员恢复');
  valid.sort((a, b) => b.generation - a.generation);
  const earlier =
    valid[0]?.state ||
    (await read('state.json').then((text) => (text ? validateState(JSON.parse(text)) : undefined)));
  if (earlier) {
    for (const row of earlier.entries)
      for (const photo of row.attachments)
        if (photo.key.startsWith('field-management/photos/'))
          photo.key = 'file://' + directory + '/' + photo.key;
    earlier.storageNotice = '已读取旧版 APP 本机资料，请核对后继续上传；原文件保持不变';
  }
  return earlier;
}
export function selectSnapshot(raw: (string | undefined)[]) {
  const valid: { sequence: number; state: LocalState; slot: number }[] = [];
  raw.forEach((text, slot) => {
    if (text === undefined) return;
    try {
      const value: Snapshot = JSON.parse(text);
      if (
        Number.isSafeInteger(value.sequence) &&
        value.sequence > 0 &&
        value.checksum === checksum(value.payload)
      )
        valid.push({
          sequence: value.sequence,
          state: validateState(JSON.parse(value.payload)),
          slot,
        });
    } catch {
      /* 一份损坏时使用另一份，不覆盖两份均损坏的资料。 */
    }
  });
  valid.sort((a, b) => b.sequence - a.sequence);
  if (raw.some((text) => text !== undefined) && !valid.length)
    throw new Error('本机台账损坏，请勿卸载或清除数据，请联系管理员恢复');
  if (valid.length && raw.filter((text) => text !== undefined).length > valid.length)
    valid[0].state.storageNotice =
      '检测到一次保存中断，已恢复有效台账；请核对最近一次更改，原照片仍保留';
  return valid[0];
}
/** Android/iOS 元数据采用 SQLite 事务；微信采用私有文件 A/B 快照，照片不写入小容量键值缓存。 */
export function createStateDriver(): StateDriver {
  // #ifdef H5
  return {
    async read() {
      const db = await openBrowserDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('state');
        const request = tx.objectStore('state').get('main');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('读取本机台账失败'));
      });
    },
    async write(value) {
      const db = await openBrowserDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put(clone(value), 'main');
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(new Error('本机保存失败，请检查可用空间；原记录未覆盖'));
      });
    },
  };
  // #endif
  // #ifdef MP-WEIXIN
  return createWechatDriver();
  // #endif
  // #ifdef APP-PLUS
  return createNativeDriver();
  // #endif
}
export function createWechatDriver(): StateDriver {
  const fs = wx.getFileSystemManager();
  const directory = wx.env.USER_DATA_PATH + '/wind-field';
  let slot = 1,
    sequence = 0;
  return {
    async read() {
      try {
        fs.mkdirSync(directory, true);
      } catch {
        fs.accessSync(directory);
      }
      // 先列目录再读取，不能靠开发者工具/真机的英文异常文本判断“首次使用”。
      // 只有目录明确不存在的快照才可视为未创建；已有文件读取失败必须停止写入。
      let names: string[];
      try {
        names = fs.readdirSync(directory);
        if (!Array.isArray(names)) throw new Error('Invalid directory listing');
      } catch {
        throw new Error('无法读取本机资料目录，请保留应用数据并重新打开小程序');
      }
      const raw = [0, 1].map((index) => {
        const name = `state-${index}.json`;
        if (!names.includes(name)) return undefined;
        try {
          const value = fs.readFileSync(`${directory}/${name}`, 'utf8');
          if (typeof value !== 'string') throw new Error('Invalid snapshot encoding');
          return value;
        } catch {
          throw new Error('无法读取已有本机台账，请保留应用数据，勿清理缓存');
        }
      });
      const latest = selectSnapshot(raw);
      if (latest) {
        slot = latest.slot;
        sequence = latest.sequence;
        return latest.state;
      }
      // 原微信小程序的有效快照原样迁入私有文件；旧键和照片均保留以便回退。
      // 新安装没有旧缓存，先读键目录，避免对不存在的键调用同步读取导致初始化中断。
      let keys: string[];
      try {
        keys = wx.getStorageInfoSync().keys;
        if (!Array.isArray(keys)) throw new Error('Invalid storage listing');
      } catch {
        throw new Error('无法读取本机缓存目录，请保留应用数据并重新打开小程序');
      }
      const previous = selectSnapshot(
        ['a', 'b']
          .map((suffix) => {
            const key = 'wind-field-wechat-v1-' + suffix;
            if (!keys.includes(key)) return undefined;
            try {
              const value = wx.getStorageSync(key);
              if (typeof value !== 'string') throw new Error('Invalid legacy snapshot');
              return value;
            } catch {
              throw new Error('无法读取已有缓存台账，请保留应用数据，勿清理缓存');
            }
          })
          .map((text) => {
            if (text === undefined) return undefined;
            try {
              const item = JSON.parse(text);
              const old = JSON.parse(item.payload);
              if (item.checksum !== checksum(item.payload)) return text;
              // 保持 V1 扁平结构的原样交给 migrateState：它只保留地址与登录态，
              // 记录条数写入提示。若在这里套上 V2 外壳，旧记录会被静默丢弃且不再提示。
              const payload = JSON.stringify({
                version: 1,
                records: Array.isArray(old.records) ? old.records : [],
                settings: {
                  ...(old.settings || {}),
                  endpoint: old.endpoint || old.settings?.endpoint || '',
                },
              });
              return JSON.stringify({
                sequence: item.sequence,
                payload,
                checksum: checksum(payload),
              });
            } catch {
              return text;
            }
          }),
      );
      // 提示语由 migrateState 按实际条数生成，不在驱动层覆盖，避免说成「已保留」而实际未迁移
      if (previous) return previous.state;
      return undefined;
    },
    async write(value) {
      const payload = JSON.stringify(value);
      const nextSlot = 1 - slot;
      const filePath = `${directory}/state-${nextSlot}.json`;
      const data = JSON.stringify({
        sequence: sequence + 1,
        payload,
        checksum: checksum(payload),
      });
      await fsCall(fs, 'writeFile', { filePath, data, encoding: 'utf8' });
      const check = await fsCall(fs, 'readFile', {
        filePath,
        encoding: 'utf8',
      });
      if (check.data !== data) throw new Error('本机保存校验失败，上一份有效台账仍保留');
      slot = nextSlot;
      sequence++;
    },
  };
}
export function createNativeDriver(): StateDriver {
  let opened: Promise<void>;
  const sql = (method: string, extra: object) =>
    new Promise<any>((resolve, reject) =>
      plus.sqlite[method]({
        name: 'wind-field',
        ...extra,
        success: resolve,
        fail: reject,
      }),
    );
  const execute = (value: string) => sql('executeSql', { sql: value });
  const open = () =>
    (opened ||= (async () => {
      if (
        !plus.sqlite.isOpenDatabase({
          name: 'wind-field',
          path: '_doc/wind-field.db',
        })
      )
        await sql('openDatabase', { path: '_doc/wind-field.db' });
      await execute(
        'CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, value TEXT NOT NULL)',
      );
    })());
  return {
    async read() {
      await open();
      const rows = await sql('selectSql', {
        sql: 'SELECT value FROM snapshots WHERE id=1',
      });
      return rows.length ? validateState(JSON.parse(rows[0].value)) : await readLegacyNative();
    },
    async write(value) {
      await open();
      await sql('transaction', { operation: 'begin' });
      try {
        const text = JSON.stringify(value).replace(/'/g, "''");
        await execute(`INSERT OR REPLACE INTO snapshots(id,value) VALUES(1,'${text}')`);
        await sql('transaction', { operation: 'commit' });
      } catch (error) {
        await sql('transaction', { operation: 'rollback' });
        throw error;
      }
    },
  };
}
