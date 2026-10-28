import {
  belongs,
  canEdit,
  clone,
  draft,
  freshState,
  validateState,
  type LocalState,
  type Photo,
  type WorkRecord,
} from './domain';
export interface StateDriver {
  read(): Promise<LocalState | undefined>;
  write(value: LocalState): Promise<void>;
}
/** 所有写入串行提交：表单保存、照片回执及后台重试不能相互覆盖。 */
export class WorkRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private value?: LocalState;
  constructor(private driver: StateDriver) {}
  async read() {
    await this.queue;
    if (!this.value) this.value = validateState((await this.driver.read()) || freshState());
    return clone(this.value);
  }
  mutate<T>(change: (state: LocalState) => T | Promise<T>): Promise<T> {
    const action = this.queue.then(async () => {
      const current = this.value || validateState((await this.driver.read()) || freshState());
      const next = clone(current);
      const result = await change(next);
      validateState(next);
      await this.driver.write(next);
      this.value = next;
      return clone(result === undefined ? null : result) as T;
    });
    this.queue = action.catch(() => {});
    return action;
  }
  async initialize() {
    await this.mutate((state) => {
      for (const row of state.records)
        if (row.status === 'uploading') {
          row.status = 'queued';
          row.error = '上次上传中断，联网登录后将继续';
        }
    });
    return this.read();
  }
  async create(owner: string, instance: string, type: WorkRecord['type'] = '') {
    const row = draft(owner, instance, type);
    await this.mutate((state) => {
      state.records.unshift(row);
    });
    return row;
  }
  update(id: string, owner: string, instance: string, change: (row: WorkRecord) => void) {
    return this.mutate((state) => {
      const row = state.records.find((item) => item.id === id && belongs(item, owner, instance));
      if (!row) throw new Error('记录不存在或不属于当前账号');
      change(row);
      row.updatedAt = new Date().toISOString();
      row.revision++;
      return row;
    });
  }
  saveForm(form: WorkRecord) {
    return this.update(form.id, form.owner, form.instance!, (row) => {
      if (!canEdit(row))
        throw new Error('记录已开始归档，请继续原上传任务；内容修改请在数据管理中处理');
      Object.assign(row, {
        type: form.type,
        date: form.date,
        location: form.location,
        content: form.content,
      });
      // 草稿编辑后必须再次点击提交，不能因恢复网络而误发布未确认内容。
      row.status = 'draft';
      row.error = '';
      row.nextRetryAt = 0;
    });
  }
  addPhoto(id: string, owner: string, instance: string, photo: Photo) {
    return this.update(id, owner, instance, (row) => {
      if (!canEdit(row) || row.photos.length >= 10) throw new Error('当前记录不能再添加照片');
      row.photos.push(photo);
    });
  }
  remove(id: string, owner: string, instance: string) {
    return this.mutate((state) => {
      const row = state.records.find((item) => item.id === id && belongs(item, owner, instance));
      if (!row || !canEdit(row)) throw new Error('已提交或部分上传记录请在数据管理平台处理');
      state.records = state.records.filter((item) => item !== row);
      return row.photos;
    });
  }
  merge(
    reports: WorkRecord[],
    deletedIds: string[],
    owner: string,
    instance: string,
    scope: string,
  ) {
    return this.mutate((state) => {
      state.records = state.records.filter(
        (row) =>
          !(
            belongs(row, owner, instance) &&
            row.status === 'submitted' &&
            row.scope === scope &&
            deletedIds.includes(row.id)
          ),
      );
      for (const remote of reports) {
        const local = state.records.find(
          (row) => row.id === remote.id && belongs(row, owner, instance),
        );
        if (local && local.status !== 'submitted') continue;
        const row = {
          ...clone(remote),
          owner,
          instance,
          status: 'submitted' as const,
          revision: remote.revision || 1,
          photos: remote.photos.map((photo) => ({
            ...photo,
            key: local?.photos.find((item) => item.id === photo.id)?.key || '',
          })),
        };
        if (local) Object.assign(local, row);
        else state.records.push(row);
      }
    });
  }
}
