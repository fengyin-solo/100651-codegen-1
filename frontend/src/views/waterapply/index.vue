<template>
  <section class="page" data-module="waterapply">
    <header class="page-head">
      <div>
        <h2>用水报装与接入工程台账</h2>
        <p class="page-desc">
          一份报装挂用户、拟接入管径与勘察结论；现场看完在同一张单上登记接入工程的开工与完工。
          勘察结论与现场复测管径打架时，以现场复测为准；接水完工自动回写供水调度接网待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记报装</button>
        <button class="btn" type="button" @click="exportRows">按时间段导出</button>
        <button class="btn" type="button" @click="triggerImport">导入历史报装册</button>
        <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden-file" @change="onImportFile" />
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item conflict">管径以现场复测为准：{{ conflictCount }} 单已按复测口径登记</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>报装编号 / 用户 / 地址 / 勘察结论</span>
        <input v-model="filters.keyword" placeholder="按关键字检索" />
      </label>
      <label class="filter-item">
        <span>申请日期 起</span>
        <input v-model="filters.from" type="date" />
      </label>
      <label class="filter-item">
        <span>申请日期 止</span>
        <input v-model="filters.to" type="date" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="notice" class="notice" :class="noticeKind">{{ notice }}</p>
    <ul v-if="importReport && importReport.ok" class="notice ok notice-list">
      <li>{{ importReport.message }}</li>
    </ul>
    <ul v-if="importReport && !importReport.ok && importReport.errors.length" class="notice error notice-list">
      <li v-for="(err, i) in importReport.errors.slice(0, 20)" :key="i">{{ err }}</li>
      <li v-if="importReport.errors.length > 20">…另有 {{ importReport.errors.length - 20 }} 处，修正后重新导入即可</li>
    </ul>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>现场处置</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-conflict': row['管径冲突'] }">
          <td>{{ row['报装编号'] ?? '—' }}</td>
          <td>{{ row['用户名称'] ?? '—' }}</td>
          <td>{{ row['小区/地址'] ?? '—' }}</td>
          <td>{{ row['申请日期'] ?? '—' }}</td>
          <td>{{ row['拟接入管径'] ?? '—' }}</td>
          <td>{{ row['现场复测管径'] || '—' }}</td>
          <td>
            <strong>{{ row['接入管径'] || '—' }}</strong>
            <span v-if="row['管径冲突']" class="badge warn" title="现场复测与勘察拟接入不一致，已以现场复测为准">复测为准</span>
          </td>
          <td>{{ row['勘察结论'] || '—' }}</td>
          <td>{{ row['接入工程开工日期'] || '—' }}</td>
          <td>{{ row['接入工程完工日期'] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="['待勘察', '已勘察'].includes(String(row.status))"
              class="link"
              type="button"
              @click="openSurvey(row)"
            >
              {{ row.status === '待勘察' ? '登记勘察' : '补录勘察' }}
            </button>
            <button
              v-if="['已勘察', '施工中'].includes(String(row.status))"
              class="link"
              type="button"
              @click="openStart(row)"
            >
              {{ row.status === '施工中' ? '改记开工/复测' : '登记开工' }}
            </button>
            <button v-if="String(row.status) === '施工中'" class="link" type="button" @click="openCompletion(row)">
              登记完工
            </button>
            <span v-if="String(row.status) === '已接水'" class="done-text">已回写接网待办</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">该时间段暂无报装单，可先登记或导入历史报装册</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 张报装单（当前筛选/导出范围）</span>
      <span>数据保存在本机浏览器，导入失败不会改动现有台账</span>
    </footer>

    <!-- 登记 / 勘察 / 开工 / 完工 共用一张弹窗，字段随动作切换 -->
    <div v-if="dialog.open" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3 class="modal-title">{{ dialog.title }}</h3>
        <p v-if="dialog.hint" class="modal-hint">{{ dialog.hint }}</p>
        <div class="modal-body">
          <label v-for="field in dialogFields" :key="field.key" class="modal-field" :class="{ required: field.required }">
            <span>{{ field.label }}</span>
            <input
              v-model="dialog.form[field.key]"
              :type="field.type || 'text'"
              :placeholder="field.placeholder || ''"
            />
          </label>
        </div>
        <p v-if="dialogError" class="notice error">{{ dialogError }}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitDialog">保存到原单</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createWaterApply,
  exportWaterApply,
  importWaterApply,
  listWaterApply,
  nextWaterApplyNo,
  recordCompletion,
  recordStart,
  recordSurvey,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

// 列顺序与导出件列头一一对应（接入管径=复测优先的那一份），保证导出来跟列表逐字一样。
const columns = [
  '报装编号',
  '用户名称',
  '小区/地址',
  '申请日期',
  '拟接入管径',
  '现场复测管径',
  '接入管径',
  '勘察结论',
  '接入工程开工日期',
  '接入工程完工日期',
]
const statuses = ['待勘察', '已勘察', '施工中', '已接水']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const notice = ref('')
const noticeKind = ref<'ok' | 'error'>('ok')
const importReport = ref<ReturnType<typeof importWaterApply> | null>(null)
const filters = reactive({ keyword: '', from: '', to: '' })
const fileInput = ref<HTMLInputElement | null>(null)

type DialogKind = 'create' | 'survey' | 'start' | 'completion'
type DialogField = { key: string; label: string; type?: string; required?: boolean; placeholder?: string }

const dialog = reactive<{ open: boolean; kind: DialogKind; title: string; hint: string; id: number | null; form: Record<string, string> }>({
  open: false,
  kind: 'create',
  title: '',
  hint: '',
  id: null,
  form: {},
})
const dialogError = ref('')

const dialogFields = computed<DialogField[]>(() => {
  switch (dialog.kind) {
    case 'create':
      return [
        { key: '报装编号', label: '报装编号（留空自动生成，同一编号不许登两遍）' },
        { key: '用户名称', label: '用户名称', required: true },
        { key: '小区/地址', label: '小区/地址', required: true },
        { key: '申请日期', label: '申请日期', type: 'date', required: true },
        { key: '拟接入管径', label: '拟接入管径', required: true, placeholder: '如 DN100' },
      ]
    case 'survey':
      return [
        { key: '勘察人员', label: '勘察人员', required: true },
        { key: '勘察日期', label: '勘察日期', type: 'date', required: true },
        { key: '勘察结论', label: '勘察结论', required: true },
      ]
    case 'start':
      return [
        { key: '开工日期', label: '接入工程开工日期', type: 'date', required: true },
        { key: '现场复测管径', label: '现场复测管径（与拟接入不一致时以此为准）', placeholder: '如 DN200' },
      ]
    case 'completion':
      return [
        { key: '完工日期', label: '接入工程完工日期', type: 'date', required: true },
        { key: '接水结论', label: '接水结论（回写供水调度接网待办）' },
      ]
  }
})

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => String(row.status) === status).length })),
)
const conflictCount = computed(() => rows.value.filter((row) => row['管径冲突']).length)
const stats = computed(() => [
  { label: '报装单总数', value: total.value },
  { label: '待勘察', value: rows.value.filter((r) => String(r.status) === '待勘察').length },
  { label: '施工中', value: rows.value.filter((r) => String(r.status) === '施工中').length },
  { label: '已接水', value: rows.value.filter((r) => String(r.status) === '已接水').length },
])

function flash(message: string, ok: boolean) {
  notice.value = message
  noticeKind.value = ok ? 'ok' : 'error'
}

function resetFilters() {
  filters.keyword = ''
  filters.from = ''
  filters.to = ''
  reload()
}

function reload() {
  notice.value = ''
  importReport.value = null
  const payload = listWaterApply({ keyword: filters.keyword, from: filters.from, to: filters.to })
  rows.value = payload.items
  total.value = payload.total
}

function openCreate() {
  openDialog('create', '登记用水报装', '窗口登记：挂上用户、拟接入管径；勘察与施工都在这一张单上继续记。', null, {
    报装编号: nextWaterApplyNo(),
    用户名称: '',
    '小区/地址': '',
    申请日期: new Date().toISOString().slice(0, 10),
    拟接入管径: '',
  })
}

function openSurvey(row: EntryRow) {
  openDialog('survey', `登记勘察 · ${row['报装编号']}`, '现场看完把勘察结论记在同一张单上，不另开施工单。', Number(row.id), {
    勘察人员: String(row['勘察人员'] ?? ''),
    勘察日期: String(row['勘察日期'] ?? '') || new Date().toISOString().slice(0, 10),
    勘察结论: String(row['勘察结论'] ?? ''),
  })
}

function openStart(row: EntryRow) {
  openDialog('start', `登记接入工程开工 · ${row['报装编号']}`, `拟接入管径 ${row['拟接入管径']}；现场复测不同则以复测为准。`, Number(row.id), {
    开工日期: String(row['接入工程开工日期'] ?? '') || new Date().toISOString().slice(0, 10),
    现场复测管径: String(row['现场复测管径'] ?? ''),
  })
}

function openCompletion(row: EntryRow) {
  openDialog('completion', `登记接水完工 · ${row['报装编号']}`, '完工结论会回写进供水调度的接网待办。', Number(row.id), {
    完工日期: String(row['接入工程完工日期'] ?? '') || new Date().toISOString().slice(0, 10),
    接水结论: String(row['接水结论'] ?? ''),
  })
}

function openDialog(kind: DialogKind, title: string, hint: string, id: number | null, form: Record<string, string>) {
  dialog.kind = kind
  dialog.title = title
  dialog.hint = hint
  dialog.id = id
  dialog.form = { ...form }
  dialogError.value = ''
  dialog.open = true
}

function closeDialog() {
  dialog.open = false
  dialogError.value = ''
}

function submitDialog() {
  const f = dialog.form
  let result: ReturnType<typeof createWaterApply>
  if (dialog.kind === 'create') {
    result = createWaterApply(f)
  } else if (dialog.id === null) {
    result = { ok: false, message: '缺少报装单，请重新打开' }
  } else if (dialog.kind === 'survey') {
    result = recordSurvey(dialog.id, { 勘察人员: f.勘察人员 ?? '', 勘察日期: f.勘察日期 ?? '', 勘察结论: f.勘察结论 ?? '' })
  } else if (dialog.kind === 'start') {
    result = recordStart(dialog.id, { 开工日期: f.开工日期 ?? '', 现场复测管径: f.现场复测管径 ?? '' })
  } else {
    result = recordCompletion(dialog.id, { 完工日期: f.完工日期 ?? '', 接水结论: f.接水结论 ?? '' })
  }
  if (!result.ok) {
    dialogError.value = result.message
    return
  }
  closeDialog()
  reload()
  flash(result.message, true)
}

// 导出当前时间段的报装单连勘察结论；导出前 service 已校必填项，空/缺列不会真正落盘。
function exportRows() {
  const result = exportWaterApply({ from: filters.from, to: filters.to })
  if (!result.ok) {
    flash(result.message, false)
    return
  }
  downloadText(result.filename, result.content)
  const range = [filters.from, filters.to].filter(Boolean).join(' 至 ') || '全部时段'
  flash(`已导出 ${result.count} 张报装单（${range}），列含报装编号、接入管径与勘察结论，与列表逐字一致`, true)
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function triggerImport() {
  fileInput.value?.click()
}

// 历史报装册：整册先校验后落库，任一行失败都不动现有数据，可改完重新选择文件重来。
function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const report = importWaterApply(String(reader.result ?? ''))
    importReport.value = report
    flash(report.message, report.ok)
    if (report.ok) reload()
    input.value = ''
  }
  reader.onerror = () => {
    flash('文件读取失败，现有台账未改动', false)
    input.value = ''
  }
  reader.readAsText(file, 'utf-8')
}

onMounted(reload)
</script>

<style scoped>
.hidden-file { display: none; }
.notice { margin: 8px 0; padding: 8px 10px; border-radius: 6px; font-size: 13px; }
.notice.ok { background: #ecfdf3; color: #027a48; border: 1px solid #abefc6; }
.notice.error { background: #fef3f2; color: #b42318; border: 1px solid #fda29b; }
.notice-list { padding-left: 24px; }
.notice-list li { margin: 2px 0; }
.badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; }
.badge.warn { background: #fffaeb; color: #b54708; border: 1px solid #fedf89; }
.row-conflict td { background: #fffdf5; }
.legend-item.conflict { background: #fffaeb; color: #b54708; }
.done-text { color: var(--muted); font-size: 12px; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: #fff; border-radius: 10px; width: 520px; max-width: 92vw; padding: 18px 20px; }
.modal-title { margin: 0 0 4px; font-size: 16px; }
.modal-hint { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.modal-body { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow: auto; }
.modal-field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
.modal-field input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.modal-field.required span::after { content: ' *'; color: #b42318; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
