import { MAX_PHOTO_BYTES, uuid, type Attachment } from '../work/domain';
// #ifdef H5
import { openBrowserDatabase } from './storage';
// #endif
declare const wx: any;
const previews = new Map<string, string>();
export async function choosePhotos(count: number): Promise<{ path: string; size: number }[]> {
  const result = await new Promise<UniApp.ChooseImageSuccessCallbackResult>((resolve, reject) =>
    uni.chooseImage({
      count,
      sizeType: ['original'],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: reject,
    }),
  );
  return (
    result.tempFiles as UniApp.ChooseImageSuccessCallbackResult['tempFiles'] as {
      path: string;
      size: number;
    }[]
  ).map((file) => ({ path: file.path, size: file.size }));
}
/** 必须先将临时照片落到持久空间，再把其引用写入台账；失败时不显示“已保存”。 */
export async function persistPhoto(file: { path: string; size: number }): Promise<Attachment> {
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('单张照片不能超过20 MB');
  const info = await new Promise<{ type?: string }>((resolve, reject) =>
    uni.getImageInfo({ src: file.path, success: resolve, fail: reject }),
  );
  let detectedType = info.type;
  // H5 的 getImageInfo 不返回格式，读取浏览器保留的原文件 MIME，而不是猜测 blob URL 后缀。
  // #ifdef H5
  const blob = await fetch(file.path).then((response) => response.blob());
  detectedType = blob.type.replace('image/', '');
  // #endif
  const ext = ({ jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp' } as Record<string, string>)[
    String(detectedType).toLowerCase()
  ];
  if (!ext) throw new Error('请选择 JPG、PNG 或 WEBP 照片，其他格式请先转换');
  const photo: Attachment = {
    id: uuid(),
    key: '',
    kind: 'photo',
    name: '施工照片.' + ext,
    size: file.size,
    mime: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext,
  };
  // #ifdef H5
  if (!blob.size || blob.size > MAX_PHOTO_BYTES) throw new Error('照片文件无法读取或超过20 MB');
  photo.key = `field-management/photos/${photo.id}`;
  const db = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, photo.key);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('照片保存失败，请检查设备空间'));
  });
  // #endif
  // #ifdef MP-WEIXIN
  const fs = wx.getFileSystemManager();
  const directory = wx.env.USER_DATA_PATH + '/field-photos';
  try {
    fs.mkdirSync(directory, true);
  } catch {
    fs.accessSync(directory);
  }
  photo.key = `${directory}/${photo.id}.${ext}`;
  await new Promise<void>((resolve, reject) =>
    fs.copyFile({
      srcPath: file.path,
      destPath: photo.key,
      success: resolve,
      fail: reject,
    }),
  );
  // #endif
  // #ifdef APP-PLUS
  photo.key = await new Promise<string>((resolve, reject) =>
    uni.saveFile({
      tempFilePath: file.path,
      success: (value) => resolve(value.savedFilePath),
      fail: reject,
    }),
  );
  // #endif
  return photo;
}
export async function localPhotoUrl(photo: Attachment) {
  if (!photo.key) throw new Error('照片尚未下载，请联网查看');
  // #ifdef H5
  if (previews.has(photo.key)) return previews.get(photo.key)!;
  const db = await openBrowserDatabase();
  const blob = await new Promise<Blob>((resolve, reject) => {
    const request = db.transaction('photos').objectStore('photos').get(photo.key);
    request.onsuccess = () =>
      request.result instanceof Blob
        ? resolve(request.result)
        : reject(new Error('本机照片不存在，请勿清理浏览器数据'));
    request.onerror = reject;
  });
  const url = URL.createObjectURL(blob);
  previews.set(photo.key, url);
  return url;
  // #endif
  // #ifndef H5
  return photo.key;
  // #endif
}
export async function removePhotoFile(photo: Attachment) {
  if (!photo.key) return;
  // #ifdef H5
  if (!photo.key.startsWith('field-management/photos/')) return;
  const db = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').delete(photo.key);
    tx.oncomplete = () => resolve();
    tx.onerror = reject;
  });
  if (previews.has(photo.key)) URL.revokeObjectURL(previews.get(photo.key)!);
  previews.delete(photo.key);
  // #endif
  // #ifdef MP-WEIXIN
  if (photo.key.startsWith(wx.env.USER_DATA_PATH + '/field-photos/'))
    await new Promise<void>((resolve, reject) =>
      wx.getFileSystemManager().unlink({ filePath: photo.key, success: resolve, fail: reject }),
    );
  // #endif
  // #ifdef APP-PLUS
  await new Promise<void>((resolve, reject) =>
    uni.removeSavedFile({
      filePath: photo.key,
      success: () => resolve(),
      fail: reject,
    }),
  );
  // #endif
}
export function clearPreviews() {
  // #ifdef H5
  for (const url of previews.values()) URL.revokeObjectURL(url);
  // #endif
  previews.clear();
}
