<script setup lang="ts">
import FieldIcon from './FieldIcon.vue';
defineProps<{ modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
function input(event: any) {
  emit('update:modelValue', String(event.detail?.value || ''));
}
</script>
<template>
  <view class="registration-input">
    <FieldIcon name="user" :size="20" />
    <input
      :value="modelValue"
      placeholder="管理人员姓名"
      :maxlength="30"
      :disabled="disabled"
      @input="input"
    />
  </view>
</template>
<style scoped>
.registration-input {
  height: 55px;
  background: #eef2e8;
  border: 1px solid #e3e9da;
  border-radius: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  margin-bottom: 13px;
}
.registration-input input {
  flex: 1;
  min-width: 0;
  width: 100%;
  font-size: 15px;
}
</style>
