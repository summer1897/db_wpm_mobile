<script setup lang="ts">
withDefaults(defineProps<{ name: string; active?: boolean; size?: number }>(), {
  active: false,
  size: 22,
});
</script>
<template>
  <image
    class="field-icon"
    :src="'/static/icons/' + name + (active ? '-active' : '') + '.png'"
    :style="{ width: size + 'px', height: size + 'px' }"
    mode="aspectFit"
  />
</template>
<style scoped>
.field-icon {
  flex-shrink: 0;
  display: inline-block;
  vertical-align: middle;
}
</style>
