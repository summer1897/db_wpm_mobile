<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import PhotoTile from '../../components/PhotoTile.vue';
import {
  canEdit,
  clone,
  constructionTypes,
  localDate,
  validateRecord,
  type WorkRecord,
} from '../../modules/work/domain';
import { choosePhotos } from '../../modules/platform/media';
import {
  addPhotos,
  findWork,
  handleError,
  removePhoto,
  requireUser,
  saveForm,
  state,
  submit,
  toast,
} from '../../modules/work/store';
const form = ref<WorkRecord>(),
  busy = ref(false),
  saved = ref(''),
  message = ref('');
let autosave: ReturnType<typeof setTimeout> | undefined,
  finished = false;
const typeIndex = computed(() =>
  Math.max(0, constructionTypes.findIndex((row) => row.id === form.value?.type) + 1),
);
const typeOptions = ['请选择施工类型', ...constructionTypes.map(row => row.name)];
onLoad((options) => {
  if (!requireUser()) return;
  const row = findWork(options?.id || '');
  if (!row || !canEdit(row)) {
    message.value = '记录不存在或已开始上传，请返回施工记录查看';
    return;
  }
  form.value = clone(row);
});
async function save(show = false) {
  if (!form.value || finished || !canEdit(form.value)) return;
  clearTimeout(autosave);
  await saveForm(form.value);
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
function changeType(event: { detail: { value: string | number } }) {
  if (!form.value) return;
  form.value.type = constructionTypes[Number(event.detail.value) - 1]?.id || '';
  schedule();
}
function changeDate(event: { detail: { value: string } }) {
  if (form.value) form.value.date = event.detail.value;
  schedule();
}
async function photos() {
  if (!form.value || busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await save();
    const files = await choosePhotos(10 - form.value.photos.length);
    await addPhotos(form.value, files);
    saved.value = '照片已保存到本机';
  } catch (error: any) {
    if (!/cancel/i.test(error.errMsg || error.message || ''))
      message.value = error.message || '照片保存失败，请检查权限及可用空间';
  } finally {
    form.value.photos = clone(findWork(form.value.id)!.photos);
    busy.value = false;
  }
}
async function remove(photoId: string) {
  if (!form.value || busy.value) return;
  try {
    await removePhoto(form.value, form.value.photos.find((photo) => photo.id === photoId)!);
    form.value.photos = clone(findWork(form.value.id)!.photos);
  } catch (error: any) {
    message.value = error.message;
  }
}
async function send() {
  if (!form.value || busy.value) return;
  message.value = validateRecord(form.value);
  if (message.value) return;
  busy.value = true;
  clearTimeout(autosave);
  try {
    await submit(form.value);
    finished = true;
    uni.redirectTo({ url: '/pages/detail/index?id=' + form.value.id });
  } catch (error: any) {
    message.value = error.message || '提交未完成，本机资料保留';
  } finally {
    busy.value = false;
  }
}
async function manualSave() {
  try {
    await save(true);
  } catch (error: any) {
    message.value = error.message;
  }
}
</script>
<template>
  <view class="screen fade-in">
    <PageHead title="填写施工记录" subtitle="现场填报" back
      ><text class="saved-note">{{ saved || '自动保存草稿' }}</text></PageHead
    >
    <view v-if="message" class="banner error">{{ message }}</view>
    <template v-if="form">
      <view class="form-section-label"
        ><text class="form-number">01</text><text>施工信息</text></view
      >
      <view class="card">
        <view class="field"
          ><text class="field-label">施工类型</text
          ><picker
            mode="selector"
          :range="typeOptions"
            :value="typeIndex"
            @change="changeType"
            ><view class="picker-value"
              ><text :class="{ muted: !form.type }">{{
                constructionTypes.find((row) => row.id === form?.type)?.name || '请选择施工类型'
              }}</text
              ><FieldIcon name="chevron" :size="16" /></view></picker
        ></view>
        <view class="field"
          ><text class="field-label">施工日期</text
          ><picker mode="date" :value="form.date" :end="localDate()" @change="changeDate"
            ><view class="picker-value"
              ><text>{{ form.date }}</text
              ><FieldIcon name="calendar" :size="20" /></view></picker
          ><text class="field-hint">点击可选择日期</text></view
        >
        <view class="field"
          ><text class="field-label">施工地点 / 机位 / 区段</text
          ><input
            v-model="form.location"
            class="field-input"
            placeholder="如 T08 机位、进场道路 K2+300"
            :maxlength="120"
            @input="schedule"
        /></view>
        <view class="field"
          ><text class="field-label">施工说明</text
          ><textarea
            v-model="form.content"
            class="field-textarea"
            placeholder="简要记录施工内容、完成情况及需关注事项"
            :maxlength="2000"
            :auto-height="false"
            @input="schedule"
          /><view class="between"
            ><text class="field-hint">按实际工程内容选择类型</text
            ><text class="field-hint">{{ form.content.length }} / 2000</text></view
          ></view
        >
      </view>
      <view class="form-section-label between"
        ><view class="row"><text class="form-number">02</text><text>现场照片</text></view
        ><text class="caption">{{ form.photos.length }} / 10</text></view
      >
      <view class="card"
        ><view class="photo-grid"
          ><PhotoTile
            v-for="photo in form.photos"
            :key="photo.id"
            :photo="photo"
            removable
            @remove="remove(photo.id)"
          /><button
            v-if="form.photos.length < 10"
            class="photo-add"
            :disabled="busy"
            @click="photos"
          >
            <FieldIcon name="camera" active :size="27" /><text>{{
              busy ? '保存照片中' : '拍照 / 相册'
            }}</text>
          </button></view
        ><text class="photo-note">保留所选原图 · 单张不超过 20 MB</text></view
      >
      <view class="sticky-actions"
        ><view class="button-row"
          ><button class="secondary" :disabled="busy" @click="manualSave">保存草稿</button
          ><button class="primary" :disabled="busy" :loading="busy" @click="send">
            {{ state.online && state.authenticated ? '提交记录' : '保存待上传' }}
          </button></view
        ><view class="submit-note">{{
          state.online && state.authenticated
            ? '联网优先上传，异常时保留本机任务'
            : '文字与照片保存在本机，联网登录后继续上传'
        }}</view></view
      >
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
.form-section-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: #58714d;
  margin: 0 0 13px;
}
.form-section-label.between {
  margin-top: 25px;
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
