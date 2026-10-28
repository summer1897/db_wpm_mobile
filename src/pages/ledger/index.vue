<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import PageHead from '../../components/PageHead.vue';
import FieldIcon from '../../components/FieldIcon.vue';
import PhotoTile from '../../components/PhotoTile.vue';
import { constructionTypes, formatTime, typeName } from '../../modules/work/domain';
import { inLedgerRange, type LedgerRange } from '../../modules/work/ledger';
import { refreshLedger, requireManager, state } from '../../modules/work/store';
const query = ref(''),
  type = ref(''),
  range = ref<LedgerRange>(30),
  limit = ref(20);
const typeOptions = [{ id: '', name: '全部施工类型' }, ...constructionTypes];
const dateOptions = [
  { id: 7 as const, name: '近7天' },
  { id: 30 as const, name: '近30天' },
  { id: 90 as const, name: '近90天' },
  { id: 0 as const, name: '全部施工日期' },
];
const records = computed(() =>
  (state.user?.role === 'admin' ? state.ledger?.reports || [] : [])
    .filter(
      (row) =>
        inLedgerRange(row, range.value) &&
        (!type.value || row.type === type.value) &&
        (!query.value.trim() ||
          [row.location, row.content, row.date, typeName(row.type)]
            .join(' ')
            .includes(query.value.trim())),
    )
    .sort((a, b) => (b.submittedAt || b.createdAt).localeCompare(a.submittedAt || a.createdAt)),
);
onLoad(() => {
  requireManager();
});
onShow(() => {
  if (requireManager()) void refreshLedger();
});
onPullDownRefresh(async () => {
  try {
    await refreshLedger();
  } finally {
    uni.stopPullDownRefresh();
  }
});
const detail = (id: string, owner: string) =>
  uni.navigateTo({ url: `/pages/detail/index?id=${id}&owner=${owner}&ledger=1` });
function changeType(event: any) {
  type.value = typeOptions[Number(event.detail.value)].id;
  limit.value = 20;
}
function changeRange(event: any) {
  range.value = dateOptions[Number(event.detail.value)].id;
  limit.value = 20;
}
</script>
<template>
  <view class="screen fade-in"
    ><PageHead title="项目工作台账" subtitle="管理人员 · 项目资料" back />
    <view class="ledger-summary"
      ><view
        ><text class="ledger-count">{{ records.length }}</text
        ><text>条已提交记录</text></view
      ><FieldIcon name="folder" active :size="35"
    /></view>
    <view class="search-box"
      ><FieldIcon name="search" :size="19" /><input
        v-model="query"
        placeholder="搜索地点、施工内容或日期"
        @input="limit = 20"
    /></view>
    <view class="ledger-selects"
      ><picker
        mode="selector"
        :range="typeOptions.map((row) => row.name)"
        :value="typeOptions.findIndex((row) => row.id === type)"
        @change="changeType"
        ><view
          >{{ typeOptions.find((row) => row.id === type)?.name
          }}<FieldIcon name="chevron" :size="13" /></view></picker
      ><picker
        mode="selector"
        :range="dateOptions.map((row) => row.name)"
        :value="dateOptions.findIndex((row) => row.id === range)"
        @change="changeRange"
        ><view
          >{{ dateOptions.find((row) => row.id === range)?.name
          }}<FieldIcon name="chevron" :size="13" /></view></picker
    ></view>
    <view v-if="state.ledgerError" class="banner error">{{ state.ledgerError }}</view>
    <view class="between ledger-list-head"
      ><text class="caption">按提交时间 · 最新在前</text
      ><button class="plain-button" :disabled="state.ledgerBusy" @click="refreshLedger">
        {{ state.ledgerBusy ? '更新中' : '刷新台账' }}
      </button></view
    >
    <view v-if="!records.length" class="card empty"
      ><FieldIcon name="folder" :size="35" /><text class="empty-title">{{
        state.ledger ? '暂无符合条件的记录' : '请联网获取工作台账'
      }}</text
      ><text class="empty-copy">{{
        state.ledger ? '可切换日期、类型或搜索条件' : '工作人员提交后，项目台账同步更新'
      }}</text></view
    >
    <view
      v-for="row in records.slice(0, limit)"
      :key="row.owner + ':' + row.id"
      class="card record-card"
      @click="detail(row.id, row.owner)"
      ><view class="between"
        ><text class="record-type">{{ typeName(row.type) }}</text
        ><text
          class="status"
          :class="
            row.reviewStatus === '已审核'
              ? 'submitted'
              : row.reviewStatus === '退回修改'
                ? 'failed'
                : 'queued'
          "
          >{{
            row.reviewStatus === '已审核'
              ? '审核通过'
              : row.reviewStatus === '退回修改'
                ? '审核不通过'
                : '待审核'
          }}</text
        ></view
      ><view class="record-main"
        ><view class="record-copy"
          ><text class="record-location">{{ row.location }}</text
          ><text class="record-content">{{ row.content }}</text></view
        ><view v-if="row.photos.length" class="record-thumb"
          ><PhotoTile :photo="row.photos[0]" management /></view></view
      ><view class="ledger-person"
        ><FieldIcon name="calendar" :size="13" /> ><text>施工日期 {{ row.date }}</text></view
      ><view class="record-footer"
        ><text>提交 {{ formatTime(row.submittedAt) }}</text
        ><text>{{ row.photos.length }} 张照片</text></view
      ></view
    >
    <button v-if="records.length > limit" class="secondary more-records" @click="limit += 20">
      再显示 {{ Math.min(20, records.length - limit) }} 条</button
    ><view class="bottom-note">仅展示本移动端已提交资料，未上传的个人草稿不进入项目台账</view>
  </view>
</template>
<style scoped>
.ledger-summary {
  background: #e2eadb;
  border: 1px solid #dce5d4;
  border-radius: 19px;
  padding: 17px 22px;
  margin-bottom: 19px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ledger-summary > view {
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: #8a9e7c;
  font-size: 11px;
}
.ledger-count {
  font-size: 36px;
  color: #456d4e;
  font-weight: 550;
  letter-spacing: -1px;
}
.ledger-selects {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}
.ledger-selects picker {
  flex: 1;
  min-width: 0;
}
.ledger-selects picker view {
  background: #fbfdf8;
  border: 1px solid #e0e7d8;
  border-radius: 12px;
  padding: 12px 13px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  color: #829774;
}
.ledger-list-head {
  margin-bottom: 12px;
}
.ledger-list-head .plain-button {
  font-size: 12px;
}
.ledger-person {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #91a182;
  margin-top: 12px;
}
.ledger-person > text:last-child {
  margin-left: auto;
  font-size: 9px;
}
.more-records {
  width: 100%;
  margin: 20px 0;
}
</style>
