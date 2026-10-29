<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onUnload } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import PhotoTile from '../../components/PhotoTile.vue';
import {
  canEdit,
  clone,
  localDate,
  validateEntry,
  type Entry,
  type UnitStep,
} from '../../modules/work/domain';
import { choosePhotos } from '../../modules/platform/media';
import {
  addEntryPhotos,
  findEntry,
  handleError,
  removeEntryPhoto,
  requireUser,
  saveEntry,
  state,
  stepName,
  submitEntry,
  toast,
  unitById,
} from '../../modules/work/store';

const form = ref<Entry>();
const busy = ref(false);
const saved = ref('');
const message = ref('');
let autosave: ReturnType<typeof setTimeout> | undefined;
let finished = false;

const unit = computed(() => (form.value ? unitById(form.value.unitId) : undefined));
const steps = computed<UnitStep[]>(() => unit.value?.steps || []);
const stepIndex = computed(() => {
  const code = form.value?.stepCode;
  return Math.max(0, steps.value.findIndex((step) => step.stepCode === code) + 1);
});
const stepOptions = computed(() => ['不关联工序', ...steps.value.map((step) => step.stepName)]);
const typeOptions = computed(() => (state.dict?.entryTypes || []).map((item) => item.name));
const typeIndex = computed(() =>
  Math.max(0, (state.dict?.entryTypes || []).findIndex((item) => item.code === form.value?.typeCode)),
);

onLoad((options) => {
  if (!requireUser()) return;
  const row = findEntry(options?.id || '');
  if (!row || !canEdit(row)) {
    message.value = '记录不存在或已开始上传，请到上传中心查看';
    return;
  }
  form.value = clone(row);
});

async function save(show = false) {
  if (!form.value || finished || !canEdit(form.value)) return;
  clearTimeout(autosave);
  await saveEntry(form.value);
  saved.value = '已保存到本机';
  if (show) toast(saved.value);
}

function schedule() {
  saved.value = '保存中';
  clearTimeout(autosave);
  autosave = setTimeout(() => {
    void save().catch((error) => {
      message.value = error.message;
      saved.value = '保存未完成';
    });
  }, 700);
}

onHide(() => {
  if (!finished) void save().catch(handleError);
});
onUnload(() => {
  clearTimeout(autosave);
  if (!finished) void save().catch(handleError);
});

function changeStep(event: { detail: { value: string | number } }) {
  if (!form.value) return;
  const index = Number(event.detail.value);
  const step = index > 0 ? steps.value[index - 1] : undefined;
  form.value.stepCode = step?.stepCode || null;
  if (step && !form.value.title) form.value.title = `${unit.value?.code || ''} ${step.stepName}`.trim();
  schedule();
}

function changeType(event: { detail: { value: string | number } }) {
  if (!form.value) return;
  form.value.typeCode = state.dict?.entryTypes[Number(event.detail.value)]?.code || 'other';
  schedule();
}

function changeDate(event: { detail: { value: string } }) {
  if (!form.value) return;
  form.value.workDate = event.detail.value;
  schedule();
}

async function photos() {
  if (!form.value || busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await save();
    const files = await choosePhotos(20 - form.value.attachments.length);
    await addEntryPhotos(form.value, files);
    saved.value = '附件已保存到本机';
  } catch (error: any) {
    if (!/cancel/i.test(error.errMsg || error.message || ''))
      message.value = error.message || '附件保存失败，请检查权限及可用空间';
  } finally {
    if (form.value) form.value.attachments = clone(findEntry(form.value.id)!.attachments);
    busy.value = false;
  }
}

async function remove(attachmentId: string) {
  if (!form.value || busy.value) return;
  try {
    await removeEntryPhoto(form.value, attachmentId);
    form.value.attachments = clone(findEntry(form.value.id)!.attachments);
  } catch (error: any) {
    message.value = error.message;
  }
}

async function send() {
  if (!form.value || busy.value) return;
  message.value = validateEntry(form.value);
  if (message.value) return;
  busy.value = true;
  clearTimeout(autosave);
  try {
    await submitEntry(clone(form.value));
    finished = true;
    uni.redirectTo({ url: '/pages/entry/index?id=' + form.value.id });
  } catch (error: any) {
    message.value = error.message || '提交未完成，本机资料保留';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="填写施工记录" :subtitle="unit?.code || '现场填报'" back>
      <text class="saved-note">{{ saved || '自动保存草稿' }}</text>
    </PageHead>
    <view v-if="message" class="banner error">{{ message }}</view>

    <template v-if="form">
      <view class="card unit-chip">
        <view class="between">
          <view>
            <text class="chip-code">{{ form.unitCode }}</text>
            <text class="chip-name">{{ form.unitName || unit?.location || '风机' }}</text>
          </view>
          <text class="caption">{{ unit ? `${unit.doneSteps}/${unit.totalSteps} 道工序已完成` : '' }}</text>
        </view>
      </view>

      <view class="form-section-label"><text class="form-number">01</text><text>施工内容</text></view>
      <view class="card">
        <view class="field">
          <text class="field-label">关联工序</text>
          <picker mode="selector" :range="stepOptions" :value="stepIndex" @change="changeStep">
            <view class="picker-value">
              <text :class="{ muted: !form.stepCode }">{{ stepName(form) || '不关联工序' }}</text>
              <FieldIcon name="chevron" :size="16" />
            </view>
          </picker>
          <text class="field-hint">选择工序后，提交记录时可同步推进该工序进度</text>
        </view>
        <view class="field">
          <text class="field-label">施工内容类型</text>
          <picker mode="selector" :range="typeOptions" :value="typeIndex" @change="changeType">
            <view class="picker-value">
              <text>{{ state.dict?.entryTypes.find((item) => item.code === form?.typeCode)?.name || '请选择' }}</text>
              <FieldIcon name="chevron" :size="16" />
            </view>
          </picker>
        </view>
        <view class="field">
          <text class="field-label">事项名称</text>
          <input
            v-model="form.title"
            class="field-input"
            placeholder="如 T20 塔筒吊装"
            :maxlength="120"
            @input="schedule"
          />
        </view>
        <view class="field">
          <text class="field-label">施工日期</text>
          <picker mode="date" :value="form.workDate" :end="localDate()" @change="changeDate">
            <view class="picker-value">
              <text>{{ form.workDate }}</text>
              <FieldIcon name="calendar" :size="20" />
            </view>
          </picker>
        </view>
        <view class="field">
          <text class="field-label">施工说明</text>
          <textarea
            v-model="form.content"
            class="field-textarea"
            placeholder="简要记录完成情况、人员机械与需关注事项"
            :maxlength="2000"
            :auto-height="false"
            @input="schedule"
          />
          <view class="between">
            <text class="field-hint">现场文字留痕，后期可溯源</text>
            <text class="field-hint">{{ form.content.length }} / 2000</text>
          </view>
        </view>
      </view>

      <view class="form-section-label between">
        <view class="row"><text class="form-number">02</text><text>现场照片</text></view>
        <text class="caption">{{ form.attachments.length }} / 20</text>
      </view>
      <view class="card">
        <view class="photo-grid">
          <PhotoTile
            v-for="photo in form.attachments"
            :key="photo.id"
            :photo="photo"
            removable
            @remove="remove(photo.id)"
          />
          <button
            v-if="form.attachments.length < 20"
            class="photo-add"
            :disabled="busy"
            @click="photos"
          >
            <FieldIcon name="camera" active :size="27" />
            <text>{{ busy ? '保存照片中' : '拍照 / 相册' }}</text>
          </button>
        </view>
        <text class="photo-note">保留所选原图 · 单张不超过 20 MB</text>
      </view>

      <view class="sticky-actions">
        <view class="button-row">
          <button class="secondary" :disabled="busy" @click="save(true)">保存草稿</button>
          <button class="primary" :disabled="busy" :loading="busy" @click="send">
            {{ state.online && state.authenticated ? '提交并上传' : '保存待上传' }}
          </button>
        </view>
        <view class="submit-note">
          {{ state.online && state.authenticated ? '联网优先上传，异常时保留本机任务' : '文字与照片保存在本机，联网后到上传中心批量上传' }}
        </view>
      </view>
    </template>
  </view>
</template>
<style scoped>
.saved-note {
  font-size: 10px;
  color: #9aa58e;
  max-width: 78px;
  text-align: right;
}
.unit-chip {
  background: #eaf0e2;
  border-color: #dce6d3;
  padding: 15px 18px;
  margin-bottom: 4px;
}
.chip-code {
  font-size: 18px;
  font-weight: 700;
  color: #2f5540;
}
.chip-name {
  font-size: 13px;
  color: #6b8163;
  margin-left: 9px;
}
.form-section-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: #58714d;
  margin: 24px 0 13px;
}
.form-number {
  font-size: 11px;
  font-weight: 500;
  color: #9aab8c;
  padding-right: 8px;
  border-right: 1px solid #d3ddca;
}
.photo-note {
  display: block;
  margin-top: 15px;
  font-size: 11px;
  color: #a0aa96;
}
.submit-note {
  text-align: center;
  margin-top: 12px;
  color: #94a18a;
  font-size: 10px;
}
.button-row .secondary {
  flex: 0.8;
}
</style>
