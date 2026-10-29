import {
  belongs,
  isPending,
  validateEntry,
  type Attachment,
  type Connection,
  type Entry,
} from './domain';
import type { WorkRepository } from './repository';

export interface SyncApi {
  connection(): Promise<Connection>;
  upload(
    entry: Entry,
    attachment: Attachment,
    progress: (value: number) => void,
  ): Promise<{ id: string; reused: boolean }>;
  submit(entry: Entry): Promise<{
    id: string;
    serverId: string;
    code: string;
    createdAt: string;
    reviewStatus: string;
    reviewStatusCode: string;
  }>;
  active(): boolean;
}

/** 批量上传进度：界面上「已上传 N / 共 M 条、还剩哪几条」都读这里 */
export interface BatchState {
  running: boolean;
  paused: boolean;
  total: number;
  done: number;
  failed: number;
  currentId: string;
  currentLabel: string;
  /** 当前这一条的百分比 */
  currentPercent: number;
  /** 整批的百分比 */
  percent: number;
  startedAt: number;
  finishedAt: number;
  message: string;
}

export const emptyBatch = (): BatchState => ({
  running: false,
  paused: false,
  total: 0,
  done: 0,
  failed: 0,
  currentId: '',
  currentLabel: '',
  currentPercent: 0,
  percent: 0,
  startedAt: 0,
  finishedAt: 0,
  message: '',
});

export interface RunnerHooks {
  changed: () => void;
  progress: (id: string, value: number) => void;
  batch: (state: BatchState) => void;
}

/**
 * 上传队列：只消费用户明确提交的任务（queued / failed）。
 * 每条记录的附件先传、回执落库、再提交记录；任一环节失败只影响当前这条，
 * 其余任务继续，形成「批量上传 + 逐条进度」。
 */
export class UploadRunner {
  private running?: Promise<void>;
  private stopRequested = false;
  batch = emptyBatch();

  constructor(
    private repo: WorkRepository,
    private api: SyncApi,
    private hooks: RunnerHooks,
  ) {}

  private publish(patch: Partial<BatchState> = {}) {
    this.batch = { ...this.batch, ...patch };
    this.hooks.batch({ ...this.batch });
  }

  /** 暂停：当前这条传完后停下，已完成的附件不会重传 */
  pause() {
    this.stopRequested = true;
    this.publish({ paused: true, running: Boolean(this.running) });
  }

  /** 入队单条 */
  async enqueue(id: string, owner: string, instance: string) {
    await this.repo.update(id, owner, instance, (row) => {
      const message = validateEntry(row);
      if (message) throw new Error(message);
      if (row.status === 'submitted' || row.status === 'uploading')
        throw new Error('该记录已提交或正在上传');
      row.status = 'queued';
      row.error = '';
      row.nextRetryAt = 0;
    });
    this.hooks.changed();
  }

  /** 入队多条（批量上传入口）：校验通过的才入队，返回被跳过的记录及原因 */
  async enqueueMany(ids: string[], owner: string, instance: string) {
    const skipped: string[] = [];
    await this.repo.mutate((state) => {
      for (const id of ids) {
        const row = state.entries.find((item) => item.id === id && belongs(item, owner, instance));
        if (!row) continue;
        const message = validateEntry(row);
        if (message) {
          row.error = message;
          skipped.push(id);
          continue;
        }
        if (row.status === 'submitted' || row.status === 'uploading') continue;
        row.status = 'queued';
        row.error = '';
        row.nextRetryAt = 0;
      }
    });
    this.hooks.changed();
    return skipped;
  }

  /**
   * 执行上传。ids 为空时处理当前账号下全部待上传记录（批量）。
   * force=true 表示忽略退避时间（用户手动点「立即上传」）。
   */
  run(owner: string, instance: string, online: boolean, options: { ids?: string[]; force?: boolean } = {}) {
    if (this.running) return this.running;
    if (!online || !this.api.active()) return Promise.resolve();
    this.stopRequested = false;
    this.running = this.execute(owner, instance, options)
      .catch(() => {
        /* 单条失败已记录在记录上，批量流程不中断 */
      })
      .finally(() => {
        this.running = undefined;
        this.publish({
          running: false,
          currentId: '',
          currentLabel: '',
          currentPercent: 0,
          percent: this.batch.total
            ? Math.round(((this.batch.done + this.batch.failed) / this.batch.total) * 100)
            : 100,
          finishedAt: Date.now(),
          message: this.stopRequested ? '已暂停，剩余任务保留在本机' : this.summary(),
        });
        this.hooks.changed();
      });
    return this.running;
  }

  private summary() {
    const { total, done, failed } = this.batch;
    if (!total) return '没有待上传的记录';
    if (failed) return `已上传 ${done} 条，${failed} 条失败待重试`;
    return `全部 ${done} 条已上传完成`;
  }

  private async execute(owner: string, instance: string, options: { ids?: string[]; force?: boolean }) {
    const connection = await this.api.connection();
    if (connection.instance !== instance)
      throw new Error('服务实例已变化，请核实项目后重新登录；原任务未转发');

    const state = await this.repo.read();
    const queue = state.entries
      .filter(
        (row) =>
          belongs(row, owner, instance) &&
          isPending(row) &&
          (!options.ids || options.ids.includes(row.id)) &&
          (options.force || !row.nextRetryAt || row.nextRetryAt <= Date.now()),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (!queue.length) {
      this.publish({ running: false, total: 0, done: 0, failed: 0, percent: 100, message: '没有待上传的记录' });
      return;
    }

    this.publish({
      running: true,
      paused: false,
      total: queue.length,
      done: 0,
      failed: 0,
      percent: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      message: '正在上传',
    });

    for (let index = 0; index < queue.length; index++) {
      if (this.stopRequested || !this.api.active()) break;
      const item = queue[index];
      this.publish({
        currentId: item.id,
        currentLabel: item.title || item.unitCode || item.id.slice(0, 8),
        currentPercent: 0,
      });
      try {
        await this.pushOne(item.id, owner, instance);
        this.publish({
          done: this.batch.done + 1,
          percent: Math.round(((this.batch.done + 1 + this.batch.failed) / this.batch.total) * 100),
        });
      } catch (error: any) {
        await this.markFailed(item.id, owner, instance, error);
        const failed = this.batch.failed + 1;
        this.publish({
          failed,
          percent: Math.round(((this.batch.done + failed) / this.batch.total) * 100),
        });
        // 网络/登录类错误：后面的任务大概率同样失败，直接停下等恢复
        if (!error?.status || error.status === 401) break;
      }
      this.hooks.changed();
    }
  }

  /**
   * 失败落库：必须写回记录本身，否则界面会一直显示「上传中」，
   * 用户既看不到原因，也无法判断哪一条需要重试。
   * 主动暂停不算失败，保持 queued 等下次继续。
   */
  private async markFailed(id: string, owner: string, instance: string, error: any) {
    const paused = this.stopRequested || !this.api.active();
    try {
      await this.repo.update(id, owner, instance, (record) => {
        if (paused) {
          record.status = 'queued';
          record.error = '上传已暂停，剩余任务保留在本机';
          return;
        }
        record.status = 'failed';
        record.error = error?.message || '上传未完成，稍后重试';
        record.attempts = (record.attempts || 0) + 1;
        // 指数退避，最多 30 分钟；用户手动点「重新上传」时用 force 跳过
        const minutes = Math.min(30, 2 ** Math.min(record.attempts, 5));
        record.nextRetryAt = Date.now() + minutes * 60000;
      });
    } catch {
      /* 记录已被删除或换了账号：不影响批次继续 */
    }
    this.hooks.changed();
  }

  private async pushOne(id: string, owner: string, instance: string) {
    let row = await this.repo.update(id, owner, instance, (record) => {
      record.status = 'uploading';
      record.error = '';
    });
    this.hooks.changed();

    const total = row.attachments.length + 1;
    for (let i = 0; i < row.attachments.length; i++) {
      if (this.stopRequested || !this.api.active()) throw new Error('上传已暂停，本机任务保留');
      const attachment = row.attachments[i];
      if (attachment.remoteId) continue;
      const receipt = await this.api.upload(row, attachment, (percent) => {
        const value = Math.round(((i + percent / 100) / total) * 100);
        this.hooks.progress(row.id, value);
        this.publish({ currentPercent: value });
      });
      row = await this.repo.update(row.id, owner, instance, (record) => {
        const target = record.attachments.find((item) => item.id === attachment.id);
        if (target) target.remoteId = receipt.id;
      });
    }

    if (this.stopRequested || !this.api.active()) throw new Error('上传已暂停，本机任务保留');
    const receipt = await this.api.submit(row);
    await this.repo.update(row.id, owner, instance, (record) => {
      record.status = 'submitted';
      record.serverId = receipt.serverId;
      record.code = receipt.code || record.code;
      record.submittedAt = receipt.createdAt;
      record.reviewStatus = receipt.reviewStatus;
      record.reviewStatusCode = (receipt.reviewStatusCode as Entry['reviewStatusCode']) || 'pending';
      record.error = '';
      record.attempts = 0;
      record.nextRetryAt = 0;
    });
    this.hooks.progress(row.id, 100);
    this.publish({ currentPercent: 100 });
  }
}
