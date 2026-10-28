<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { uuid } from '../modules/work/domain';
import { chartScale } from '../modules/work/ledger';
const props = withDefaults(
  defineProps<{
    kind: 'trend' | 'review';
    points?: { date: string; records: number; photos: number }[];
    groups?: { color: string; count: number }[];
    metric?: 'records' | 'photos';
    total?: number;
    rate?: number;
  }>(),
  { points: () => [], groups: () => [], metric: 'records', total: 0, rate: 0 },
);
const instance = getCurrentInstance();
const canvasId = 'ledger-' + uuid().slice(0, 8),
  selected = ref(-1),
  drawn = ref(false);
let mounted = false,
  revision = 0,
  timer: ReturnType<typeof setTimeout> | undefined,
  rectangle = { width: 0, left: 0 };
const point = computed(
  () => props.points[selected.value < 0 ? props.points.length - 1 : selected.value],
);
function schedule() {
  if (!mounted) return;
  revision++;
  drawn.value = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void draw();
  }, 80);
}
async function draw() {
  const version = revision;
  await nextTick();
  uni
    .createSelectorQuery()
    .in(instance!.proxy)
    .select('.ledger-canvas')
    .boundingClientRect((result: any) => {
      if (!mounted || version !== revision || !result?.width) return;
      rectangle = result;
      const width = result.width,
        height = props.kind === 'review' ? 164 : 184;
      const ctx = uni.createCanvasContext(canvasId, instance!.proxy);
      ctx.clearRect(0, 0, width, height);
      if (props.kind === 'review') {
        const cx = width / 2,
          cy = 82,
          radius = 65;
        ctx.setLineWidth(12);
        ctx.setStrokeStyle('#edf1e9');
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        let angle = -Math.PI / 2;
        for (const group of props.groups) {
          if (!group.count || !props.total) continue;
          const sweep = (group.count / props.total) * Math.PI * 2,
            gap = Math.min(0.035, sweep * 0.15);
          ctx.beginPath();
          ctx.setLineCap('round');
          ctx.setStrokeStyle(group.color);
          ctx.arc(cx, cy, radius, angle + gap, angle + sweep - gap);
          ctx.stroke();
          angle += sweep;
        }
      } else {
        const left = 26,
          right = width - 14,
          top = 15,
          bottom = 152;
        const values = props.points.map((row) => row[props.metric]);
        const { tick, upper } = chartScale(values);
        const accent = props.metric === 'photos' ? '#a68b59' : '#43856a';
        ctx.setFontSize(10);
        ctx.setTextAlign('right');
        ctx.setTextBaseline('middle');
        for (let i = 0; i <= 4; i++) {
          const y = bottom - ((bottom - top) * i) / 4;
          ctx.beginPath();
          ctx.setLineWidth(0.6);
          ctx.setStrokeStyle('#e8eee4');
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.setFillStyle('#9ba994');
          ctx.fillText(String(i * tick), left - 7, y);
        }
        const points = values.map((value, index) => ({
          x: left + ((right - left) * index) / Math.max(1, values.length - 1),
          y: bottom - (value / upper) * (bottom - top),
        }));
        if (points.length) {
          const trace = () => {
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
              const previous = points[i - 1],
                current = points[i],
                middle = (previous.x + current.x) / 2;
              ctx.bezierCurveTo(middle, previous.y, middle, current.y, current.x, current.y);
            }
          };
          const fill = ctx.createLinearGradient(0, top, 0, bottom);
          fill.addColorStop(
            0,
            props.metric === 'photos' ? 'rgba(176,148,92,.23)' : 'rgba(69,137,103,.25)',
          );
          fill.addColorStop(1, 'rgba(116,163,126,.015)');
          ctx.beginPath();
          trace();
          ctx.lineTo(points[points.length - 1].x, bottom);
          ctx.lineTo(points[0].x, bottom);
          ctx.closePath();
          ctx.setFillStyle(fill);
          ctx.fill();
          ctx.beginPath();
          trace();
          ctx.setStrokeStyle(accent);
          ctx.setLineWidth(2.4);
          ctx.setLineJoin('round');
          ctx.stroke();
          if (points.length <= 31)
            for (let index = 0; index < points.length; index++) {
              if (!values[index]) continue;
              ctx.beginPath();
              ctx.setFillStyle(accent);
              ctx.arc(points[index].x, points[index].y, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          const focusIndex =
              selected.value < 0 ? points.length - 1 : Math.min(points.length - 1, selected.value),
            focus = points[focusIndex];
          ctx.beginPath();
          ctx.setStrokeStyle('#bdceba');
          ctx.setLineWidth(0.8);
          ctx.moveTo(focus.x, top);
          ctx.lineTo(focus.x, bottom);
          ctx.stroke();
          ctx.beginPath();
          ctx.setFillStyle(
            props.metric === 'photos' ? 'rgba(176,148,92,.14)' : 'rgba(69,137,103,.14)',
          );
          ctx.arc(focus.x, focus.y, 8.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.setFillStyle('#fff');
          ctx.arc(focus.x, focus.y, 4.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.setLineWidth(2);
          ctx.setStrokeStyle(accent);
          ctx.stroke();
          ctx.setFillStyle('#97a48d');
          ctx.setTextAlign('center');
          const indexes = [
            ...new Set([
              0,
              Math.round((points.length - 1) / 3),
              Math.round(((points.length - 1) * 2) / 3),
              points.length - 1,
            ]),
          ];
          for (const index of indexes) {
            ctx.setTextAlign(
              index === 0 ? 'left' : index === points.length - 1 ? 'right' : 'center',
            );
            ctx.fillText(props.points[index].date.slice(5).replace('-', '/'), points[index].x, 174);
          }
        }
      }
      ctx.draw(false, () => {
        if (mounted && version === revision) drawn.value = true;
      });
    })
    .exec();
}
function select(event: any) {
  if (props.kind !== 'trend' || !rectangle.width || !props.points.length) return;
  const touch = event.touches?.[0] || event.changedTouches?.[0],
    x =
      touch?.x ?? (touch?.clientX !== undefined ? touch.clientX - rectangle.left : event.detail?.x);
  if (!Number.isFinite(x)) return;
  selected.value = Math.max(
    0,
    Math.min(
      props.points.length - 1,
      Math.round(((x - 26) / (rectangle.width - 40)) * (props.points.length - 1)),
    ),
  );
  schedule();
}
watch(
  () => [props.points, props.groups, props.metric, props.total, props.rate],
  () => {
    selected.value = -1;
    schedule();
  },
  { deep: true },
);
onMounted(() => {
  mounted = true;
  schedule();
  uni.onWindowResize(schedule);
});
onUnmounted(() => {
  mounted = false;
  clearTimeout(timer);
  uni.offWindowResize(schedule);
});
</script>
<template>
  <view class="ledger-chart" :class="kind">
    <view
      v-if="kind === 'trend' && point"
      class="chart-reading"
      :class="{ photos: metric === 'photos' }"
      ><view class="reading-dot" /><text>{{ point.date.slice(5).replace('-', '/') }}</text
      ><text class="reading-value"
        >{{ point[metric] }} {{ metric === 'photos' ? '张' : '条' }}</text
      ></view
    >
    <canvas
      :canvas-id="canvasId"
      :id="canvasId"
      class="ledger-canvas"
      :class="{ 'ring-canvas': kind === 'review' }"
      @touchstart="select"
      @touchmove="select"
      :aria-label="kind === 'review' ? '审核情况环形图' : '施工记录趋势图'"
    />
    <view v-if="kind === 'review'" class="ring-center"
      ><text class="ring-value"
        >{{ total ? rate : '—' }}<text v-if="total" class="ring-percent">%</text></text
      ><text class="ring-label">{{ total ? '审核通过率' : '暂无审核记录' }}</text></view
    >
    <text v-if="!drawn" class="chart-loading">图表准备中</text>
  </view>
</template>
<style scoped>
.ledger-chart {
  position: relative;
  width: 100%;
}
.ledger-canvas {
  width: 100%;
  height: 184px;
  display: block;
}
.review {
  width: 164px;
  flex-shrink: 0;
}
.ring-canvas {
  height: 164px;
}
.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  pointer-events: none;
}
.ring-value {
  font-size: 31px;
  font-weight: 600;
  line-height: 1.3;
  color: #315840;
  letter-spacing: -1px;
}
.ring-percent {
  font-size: 14px;
  margin-left: 2px;
  font-weight: 400;
}
.ring-label {
  font-size: 10px;
  color: #98a58c;
  margin-top: 4px;
}
.chart-reading {
  margin: 10px 0 10px 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #9ba58f;
}
.reading-dot {
  height: 5px;
  width: 5px;
  border-radius: 50%;
  background: #43856a;
}
.reading-value {
  margin-left: 5px;
  color: #5b7b50;
  font-weight: 600;
}
.photos .reading-dot {
  background: #a68b59;
}
.photos .reading-value {
  color: #927b50;
}
.chart-loading {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  text-align: center;
  color: #a0ad96;
  font-size: 10px;
}
</style>
