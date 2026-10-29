<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import FieldIcon from '../../components/FieldIcon.vue';
import PageHead from '../../components/PageHead.vue';
import { relativeTime, unitStatusNames } from '../../modules/work/domain';
import {
  createUnit,
  handleError,
  refreshUnits,
  reload,
  requireUser,
  state,
  toast,
} from '../../modules/work/store';

const query = ref('');
const status = ref('all');
const creating = ref(false);
const busy = ref(false);
const form = ref({ typeCode: '', code: '', name: '', location: '' });
const message = ref('');

const filters = [
  { id: 'all', text: '全部' },
  { id: 'planning', text: '待施工' },
  { id: 'building', text: '施工中' },
  { id: 'done', text: '已完成' },
];

const units = computed(() => {
  const keyword = query.value.trim();
  return (state.local?.units || []).filter(
    (unit) =>
      (status.value === 'all' || unit.status === status.value) &&
      (!keyword || [unit.code, unit.name, unit.location].join(' ').includes(keyword)),
  );
});

const counts = computed(() => {
  const all = state.local?.units || [];
  return {
    total: all.length,
    building: all.filter((unit) => unit.status === 'building').length,
    done: all.filter((unit) => unit.status === 'done').length,
  };
});

onShow(() => {
  if (!requireUser()) return;
  void reload()
    .then(() => {
      if (!state.local?.units.length && state.online && state.authenticated) return syncUnits();
    })
    .catch(handleError);
});

async function syncUnits() {
  try {
    await refreshUnits();
  } catch (error) {
    handleError(error);
  }
}

function changeType(event: { detail: { value: string | number } }) {
  const types = state.dict?.unitTypes || [];
  form.value.typeCode = types[Number(event.detail.value)]?.code || form.value.typeCode;
}

async function refresh() {
  try {
    await syncUnits();
  } finally {
    uni.stopPullDownRefresh();
  }
}
onPullDownRefresh(refresh);

function open(id: string) {
  uni.navigateTo({ url: '/pages/unit/index?id=' + id });
}

function startCreate() {
  message.value = '';
  if (!state.project) {
    toast('你还没有被分配项目，请联系管理员在后台把你加入项目');
    return;
  }
  if (state.project.role === 'viewer') {
    toast('你在本项目是只读权限，需要管理员调整角色后才能新增风机');
    return;
  }
  if (!state.online || !state.authenticated) {
    toast('新建事项需要联网登录，离线时仍可查看与填报已同步的风机');
    return;
  }
  const types = state.dict?.unitTypes || [];
  form.value = {
    typeCode: types[0]?.code || 'turbine',
    code: '',
    name: '',
    location: '',
  };
  creating.value = true;
}

async function confirmCreate() {
  if (busy.value) return;
  message.value = '';
  if (!form.value.code.trim()) {
    message.value = '请填写编号，如 T20';
    return;
  }
  busy.value = true;
  try {
    await createUnit({
      typeCode: form.value.typeCode,
      code: form.value.code.trim(),
      name: form.value.name.trim(),
      location: form.value.location.trim(),
    });
    creating.value = false;
    toast('事项已创建，标准工序已自动生成');
  } catch (error: any) {
    message.value = error.message || '新建未完成';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="事项 / 风机" subtitle="按机位组织施工">
      <button class="icon-button" aria-label="新建事项" @click="startCreate">
        <FieldIcon name="plus" active />
      </button>
    </PageHead>

    <view v-if="!state.project" class="banner">
      {{ state.notice || '你还没有被分配项目，请联系管理员在后台「风电施工 → 项目管理」中把你加为成员。' }}
    </view>

    <view class="summary-row">
      <view><text class="summary-number">{{ counts.total }}</text><text class="summary-label">事项总数</text></view>
      <view><text class="summary-number">{{ counts.building }}</text><text class="summary-label">施工中</text></view>
      <view><text class="summary-number">{{ counts.done }}</text><text class="summary-label">已完成</text></view>
    </view>

    <view class="search-box">
      <FieldIcon name="search" :size="19" />
      <input v-model="query" placeholder="搜索编号、名称或位置" confirm-type="search" />
    </view>

    <view class="filter-row">
      <button
        v-for="item in filters"
        :key="item.id"
        class="filter"
        :class="{ active: item.id === status }"
        @click="status = item.id"
      >
        {{ item.text }}
      </button>
    </view>

    <view v-if="state.error" class="banner error">{{ state.error }}</view>

    <view v-if="!units.length" class="card empty">
      <FieldIcon name="turbine" :size="36" />
      <text class="empty-title">{{ query ? '未找到匹配的事项' : '还没有风机 / 事项' }}</text>
      <text class="empty-copy">{{
        query ? '换个编号或位置关键字试试' : '新建 T20 这样的机位后，系统会自动生成 10 道标准工序'
      }}</text>
      <button v-if="!query" class="secondary" @click="startCreate">新建事项</button>
    </view>

    <view v-for="unit in units" :key="unit.id" class="card unit-card" @click="open(unit.id)">
      <view class="between">
        <view class="row">
          <text class="unit-code">{{ unit.code }}</text>
          <text class="unit-type">{{ unit.typeName || unit.typeCode }}</text>
        </view>
        <text class="status" :class="unit.status === 'done' ? 'submitted' : unit.status === 'building' ? 'uploading' : ''">
          {{ unitStatusNames[unit.status] || unit.status }}
        </text>
      </view>
      <text class="unit-name">{{ unit.name || unit.location || '未填写名称' }}</text>
      <view class="between unit-meta">
        <text class="caption">工序 {{ unit.doneSteps }}/{{ unit.totalSteps }}</text>
        <text class="caption">{{ unit.entryCount }} 条记录 · {{ unit.attachmentCount }} 个附件</text>
      </view>
      <view class="progress-track">
        <view class="progress-fill" :style="{ width: unit.progress + '%' }" />
      </view>
      <view class="between unit-foot">
        <text class="caption">{{ unit.progress }}%</text>
        <text class="caption">{{ unit.lastEntryAt ? '最近 ' + relativeTime(unit.lastEntryAt) : '暂无施工记录' }}</text>
      </view>
    </view>

    <view v-if="units.length" class="bottom-note">下拉可刷新事项与进度</view>

    <view v-if="creating" class="sheet-mask" @click="creating = false">
      <view class="sheet" @click.stop>
        <view class="between">
          <text class="sheet-title">新建事项</text>
          <text class="caption">创建后自动生成标准工序</text>
        </view>
        <view v-if="message" class="banner error sheet-message">{{ message }}</view>
        <view class="field">
          <text class="field-label">事项类型</text>
          <picker
            mode="selector"
            :range="(state.dict?.unitTypes || []).map((item) => item.name)"
            :value="Math.max(0, (state.dict?.unitTypes || []).findIndex((item) => item.code === form.typeCode))"
            @change="changeType"
          >
            <view class="picker-value">
              <text>{{ (state.dict?.unitTypes || []).find((item) => item.code === form.typeCode)?.name || '风机' }}</text>
              <FieldIcon name="chevron" :size="16" />
            </view>
          </picker>
        </view>
        <view class="field">
          <text class="field-label">{{
            (state.dict?.unitTypes || []).find((item) => item.code === form.typeCode)?.codeLabel || '编号'
          }}</text>
          <input v-model="form.code" class="field-input" placeholder="如 T20" :maxlength="32" />
        </view>
        <view class="field">
          <text class="field-label">名称 / 说明</text>
          <input v-model="form.name" class="field-input" placeholder="如 3 号机位" :maxlength="120" />
        </view>
        <view class="field">
          <text class="field-label">位置</text>
          <input v-model="form.location" class="field-input" placeholder="如 贵州省威宁县 XX 村" :maxlength="160" />
        </view>
        <view class="button-row sheet-actions">
          <button class="secondary" @click="creating = false">取消</button>
          <button class="primary" :loading="busy" :disabled="busy" @click="confirmCreate">创建</button>
        </view>
      </view>
    </view>
  </view>
</template>
<style scoped>
.summary-row {
  display: flex;
  background: #e9efe2;
  border-radius: 18px;
  padding: 15px 0;
  margin-bottom: 16px;
}
.summary-row > view {
  flex: 1;
  text-align: center;
  border-right: 1px solid #d9e2d1;
}
.summary-row > view:last-child {
  border: 0;
}
.summary-number {
  display: block;
  font-size: 22px;
  font-weight: 650;
  color: #37593f;
  font-variant-numeric: tabular-nums;
}
.summary-label {
  font-size: 11px;
  color: #8b9a83;
}
.unit-card {
  margin-bottom: 12px;
  padding: 17px;
}
.unit-code {
  font-size: 19px;
  font-weight: 700;
  color: #2f5540;
  letter-spacing: 0.4px;
}
.unit-type {
  font-size: 11px;
  color: #8d9c85;
  background: #eff3ea;
  padding: 2px 7px;
  border-radius: 6px;
}
.unit-name {
  display: block;
  font-size: 14px;
  color: #62765e;
  margin: 9px 0 12px;
  overflow-wrap: anywhere;
}
.unit-meta {
  margin-bottom: 8px;
}
.unit-foot {
  margin-top: 7px;
}
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(24, 40, 30, 0.42);
  display: flex;
  align-items: flex-end;
  z-index: 20;
}
.sheet {
  width: 100%;
  background: #fff;
  border-radius: 24px 24px 0 0;
  padding: 22px 22px calc(22px + env(safe-area-inset-bottom));
  max-height: 86vh;
  overflow-y: auto;
}
.sheet-title {
  font-size: 19px;
  font-weight: 650;
  color: #2f5540;
}
.sheet-message {
  margin-top: 14px;
}
.sheet-actions {
  margin-top: 22px;
}
</style>
