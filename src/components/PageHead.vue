<script setup lang="ts">
import FieldIcon from './FieldIcon.vue';
withDefaults(defineProps<{ title: string; subtitle?: string; back?: boolean }>(), { back: false });
const goBack = () => {
  uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/home/index' }) });
};
</script>
<template>
  <view class="page-head"
    ><view class="head-title"
      ><button v-if="back" class="icon-button" aria-label="返回" @click="goBack">
        <FieldIcon name="back" /></button
      ><view
        ><text v-if="subtitle" class="eyebrow">{{ subtitle }}</text
        ><text class="page-title">{{ title }}</text></view
      ></view
    ><slot
  /></view>
</template>
