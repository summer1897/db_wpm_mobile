<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { initialize, startForeground, stopForeground } from './modules/work/store';
onLaunch(() => {
  void initialize();
});
onShow(() => {
  void initialize().then(startForeground);
});
onHide(stopForeground);
</script>
<style>
@import './styles/theme.css';
</style>
