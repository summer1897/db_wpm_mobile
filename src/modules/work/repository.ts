import {
  belongs,
  canEdit,
  clone,
  draftEntry,
  freshState,
  validateState,
  type Attachment,
  type Dict,
  type Entry,
  type LocalState,
  type Project,
  type Unit,
} from './domain';

export interface StateDriver {
  read(): Promise<LocalState | undefined>;
  write(value: LocalState): Promise<void>;
}

/** 所有写入串行提交：表单保存、附件回执与后台上传不能相互覆盖。 */
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

  /** 上次退出时正在上传的记录退回队列，恢复网络后继续，不丢任务 */
  async initialize() {
    await this.mutate((state) => {
      for (const row of state.entries)
        if (row.status === 'uploading') {
          row.status = 'queued';
          row.error = '上次上传中断，联网后将继续';
        }
    });
    return this.read();
  }

  async createEntry(
    owner: string,
    instance: string,
    unit: Unit,
    stepCode = '',
    typeCode = 'other',
  ) {
    const row = draftEntry(owner, instance, unit, stepCode, typeCode);
    await this.mutate((state) => {
      state.entries.unshift(row);
    });
    return row;
  }

  update(id: string, owner: string, instance: string, change: (row: Entry) => void) {
    return this.mutate((state) => {
      const row = state.entries.find((item) => item.id === id && belongs(item, owner, instance));
      if (!row) throw new Error('记录不存在或不属于当前账号');
      change(row);
      row.updatedAt = new Date().toISOString();
      return row;
    });
  }

  saveForm(form: Entry) {
    return this.update(form.id, form.owner, form.instance, (row) => {
      if (!canEdit(row)) throw new Error('记录已开始上传，不能再修改');
      Object.assign(row, {
        unitId: form.unitId,
        unitCode: form.unitCode,
        unitName: form.unitName,
        stepCode: form.stepCode || null,
        typeCode: form.typeCode,
        title: form.title,
        content: form.content,
        workDate: form.workDate,
        occurredAt: form.occurredAt,
        location: form.location,
        weather: form.weather,
        temperature: form.temperature,
      });
      // 草稿编辑后必须重新提交，不能因恢复网络而误发布未确认内容。
      row.status = 'draft';
      row.error = '';
      row.nextRetryAt = 0;
      row.revision++;
    });
  }

  addAttachment(id: string, owner: string, instance: string, attachment: Attachment) {
    return this.update(id, owner, instance, (row) => {
      if (!canEdit(row)) throw new Error('当前记录不能再添加附件');
      row.attachments.push(attachment);
      row.revision++;
    });
  }

  remove(id: string, owner: string, instance: string) {
    return this.mutate((state) => {
      const row = state.entries.find((item) => item.id === id && belongs(item, owner, instance));
      if (!row || !canEdit(row)) throw new Error('已提交或上传中的记录请在台账中处理');
      state.entries = state.entries.filter((item) => item !== row);
      return row.attachments;
    });
  }

  /** 服务端事项列表覆盖本机缓存，保留详情里已缓存的工序清单 */
  mergeUnits(units: Unit[]) {
    return this.mutate((state) => {
      const cache = new Map(state.units.map((item) => [item.id, item.steps]));
      state.units = units.map((item) => ({
        ...item,
        steps: item.steps || cache.get(item.id),
      }));
    });
  }

  mergeUnitDetail(unit: Unit, steps: Unit['steps']) {
    return this.mutate((state) => {
      const row = state.units.find((item) => item.id === unit.id);
      if (row) Object.assign(row, unit, { steps });
      else state.units.push({ ...unit, steps });
    });
  }

  mergeDict(dict: Dict) {
    return this.mutate((state) => {
      state.dict = dict;
    });
  }

  /** 记住当前项目；传 null 表示该账号已不在任何项目中，需要清掉本机残留项目 */
  mergeProject(project: Project | null) {
    return this.mutate((state) => {
      state.settings.project = project || undefined;
      // 项目变了以后旧事项缓存不再属于当前项目，避免首页显示别的项目的风机
      if (!project) state.units = [];
    });
  }

  /** 服务端已提交记录回填：只覆盖同 ID 且本地已提交的记录，避免冲掉未上传草稿 */
  mergeServerEntries(entries: Entry[], owner: string, instance: string) {
    return this.mutate((state) => {
      for (const remote of entries) {
        const local = state.entries.find(
          (row) => row.id === remote.id && belongs(row, owner, instance),
        );
        const row: Entry = {
          ...clone(remote),
          owner,
          instance,
          status: 'submitted',
          attachments: remote.attachments.map((item) => ({
            ...item,
            key: local?.attachments.find((photo) => photo.id === item.id)?.key || '',
          })),
        };
        if (local) Object.assign(local, row);
        else state.entries.push(row);
      }
    });
  }
}
