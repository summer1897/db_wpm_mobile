<script setup lang="ts">
import { ref, watch } from 'vue';
import { localPhotoUrl } from '../modules/platform/media';
import { remoteAttachmentUrl } from '../modules/work/api';
import type { Attachment } from '../modules/work/domain';
import FieldIcon from './FieldIcon.vue';

const props = defineProps<{ photo: Attachment; removable?: boolean }>();
const emit = defineEmits<{ remove: [] }>();
const source = ref('');
const error = ref('');

watch(
  () => props.photo,
  async (photo) => {
    source.value = '';
    error.value = '';
    try {
      source.value = photo.key ? await localPhotoUrl(photo) : await remoteAttachmentUrl(photo);
    } catch {
      error.value = '联网查看';
    }
  },
  { immediate: true },
);

function preview() {
  if (source.value) uni.previewImage({ urls: [source.value], current: source.value });
  else uni.showToast({ title: '请联网登录后重试查看附件', icon: 'none' });
}
</script>
<template>
  <view class="photo-tile"
    ><image
      v-if="source"
      :src="source"
      mode="aspectFill"
      class="photo-image"
      @click="preview"
    /><view v-else class="photo-placeholder" @click="preview"
      ><FieldIcon name="image" /><text>{{ error || '加载中' }}</text></view
    ><button
      v-if="removable"
      class="photo-remove"
      aria-label="删除附件"
      @click.stop="emit('remove')"
    >
      ×</button
    ><view v-if="photo.remoteId" class="photo-receipt">已上传</view></view
  >
</template>
