import { belongs, validateRecord, type Connection, type Photo, type WorkRecord } from './domain';
import type { WorkRepository } from './repository';
export interface SyncApi {
  connection(): Promise<Connection>;
  photo(
    row: WorkRecord,
    photo: Photo,
    progress: (value: number) => void,
  ): Promise<{ id: string; scope: string }>;
  submit(row: WorkRecord): Promise<{
    id: string;
    serverId: string;
    createdAt: string;
    reviewStatus: string;
  }>;
  active(): boolean;
}
/** 只消费用户明确提交的队列。每张照片和最终回执分别持久化，超时重试仍复用原编号。 */
export class UploadQueue {
  private running?: Promise<void>;
  private stopped = false;
  constructor(
    private repo: WorkRepository,
    private api: SyncApi,
    private changed: () => void,
    private progress: (id: string, value: number) => void,
  ) {}
  stop() {
    this.stopped = true;
  }
  async enqueue(id: string, owner: string, instance: string) {
    await this.repo.update(id, owner, instance, (row) => {
      const message = validateRecord(row);
      if (message) throw new Error(message);
      if (row.status === 'submitted' || row.status === 'uploading')
        throw new Error('该记录已提交或正在上传');
      row.status = 'queued';
      row.error = '';
      row.nextRetryAt = 0;
    });
    this.changed();
  }
  run(owner: string, instance: string, online: boolean, force = false) {
    if (this.running) return this.running;
    if (!online || !this.api.active()) return Promise.resolve();
    this.stopped = false;
    this.running = this.execute(owner, instance, force).finally(() => {
      this.running = undefined;
      this.changed();
    });
    return this.running;
  }
  private async execute(owner: string, instance: string, force: boolean) {
    const connection = await this.api.connection();
    if (connection.instance !== instance)
      throw new Error('服务实例已变化，请核实项目后重新登录；原任务未转发');
    const records = (await this.repo.read()).records
      .filter(
        (row) =>
          belongs(row, owner, instance) &&
          ['queued', 'failed'].includes(row.status) &&
          (force || !row.nextRetryAt || row.nextRetryAt <= Date.now()),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of records) {
      if (this.stopped || !this.api.active()) break;
      try {
        let row = await this.repo.update(item.id, owner, instance, (record) => {
          if (record.scope && record.scope !== connection.scope)
            throw Object.assign(new Error('项目通道已更换，请先核对原上传任务，不能自动转发'), {
              status: 409,
            });
          record.scope = connection.scope;
          record.status = 'uploading';
          record.error = '';
        });
        this.changed();
        for (let i = 0; i < row.photos.length; i++) {
          if (this.stopped || !this.api.active()) throw new Error('上传已暂停，本机任务保留');
          const photo = row.photos[i];
          if (!photo.remoteId) {
            const receipt = await this.api.photo(row, photo, (percent) =>
              this.progress(
                row.id,
                Math.round(((i + percent / 100) / (row.photos.length + 1)) * 100),
              ),
            );
            if (receipt.scope !== connection.scope)
              throw new Error('照片返回的项目通道不一致，请管理员核实');
            row = await this.repo.update(row.id, owner, instance, (record) => {
              Object.assign(record.photos.find((p) => p.id === photo.id)!, {
                remoteId: receipt.id,
                remoteScope: receipt.scope,
              });
            });
          } else if (photo.remoteScope !== connection.scope)
            throw Object.assign(new Error('照片所属项目不一致，已停止自动提交'), { status: 409 });
        }
        if (this.stopped || !this.api.active()) throw new Error('上传已暂停，本机任务保留');
        const receipt = await this.api.submit(row);
        await this.repo.update(row.id, owner, instance, (record) => {
          record.status = 'submitted';
          record.serverId = receipt.serverId;
          record.submittedAt = receipt.createdAt;
          record.reviewStatus = receipt.reviewStatus;
          record.error = '';
          record.attempts = 0;
          record.nextRetryAt = 0;
        });
        this.progress(row.id, 100);
        this.changed();
      } catch (error: any) {
        await this.repo.update(item.id, owner, instance, (row) => {
          if (row.status === 'submitted') return;
          row.status = this.stopped ? 'queued' : 'failed';
          row.error = error.message || '上传未完成，请稍后重试';
          row.attempts = (row.attempts || 0) + 1;
          const permanent = error.status >= 400 && error.status < 500 && error.status !== 429;
          row.nextRetryAt = permanent
            ? Date.now() + 365 * 86400000
            : Date.now() + Math.min(300000, 10000 * 2 ** Math.min(row.attempts, 5));
        });
        this.changed();
        if (this.stopped || !this.api.active() || !error.status) break;
      }
    }
  }
}
