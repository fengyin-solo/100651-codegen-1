<template>
  <section class="page" data-module="watersign">
    <header class="page-head">
      <div>
        <h2>用水报装与接入工程台账</h2>
        <p class="page-desc">
          一份报装挂用户、拟接入管径与勘察结论；现场在同一张单上登记接入工程开工与完工。
          复测管径与勘察不一致时以现场复测为准，接水完工自动回写供水调度接网待办。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记报装单</button>
        <button class="btn" type="button" @click="downloadTpl">下载导入模板</button>
        <button class="btn" type="button" @click="triggerImport">导入历史报装册</button>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          class="hidden-file"
          @change="onFilePicked"
        />
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">调度接网待办</span>
        <strong class="stat-value">{{ todoCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item warn-legend">管径复测与勘察不符：{{ conflictCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>报装编号/用户/小区/勘察结论</span>
        <input v-model="filters.keyword" placeholder="按关键字检索" />
      </label>
      <label class="filter-item">
        <span>当前状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>报装日期起</span>
        <input v-model="filters.dateFrom" type="date" />
      </label>
      <label class="filter-item">
        <span>报装日期止</span>
        <input v-model="filters.dateTo" type="date" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <section class="export-panel">
      <div class="export-title">按时间段导出报装单（连勘察结论）</div>
      <div class="export-controls">
        <label class="filter-item">
          <span>起始日期</span>
          <input v-model="exportRange.dateFrom" type="date" />
        </label>
        <label class="filter-item">
          <span>截止日期</span>
          <input v-model="exportRange.dateTo" type="date" />
        </label>
        <button class="btn primary" type="button" @click="doExport">导出 CSV 文件</button>
        <span class="export-hint">导出前自动逐行校验必填项，并自检列数与关键字段是否与列表逐字一致</span>
      </div>
      <p v-if="exportMessage" :class="['import-msg', exportOk ? 'ok-text' : 'error-text']">{{ exportMessage }}</p>
    </section>

    <p v-if="importMessage" :class="['import-msg', importOk ? 'ok-text' : 'error-text']">{{ importMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>同单登记</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'conflict-row': isConflict(row) }">
          <td>{{ row['报装编号'] }}</td>
          <td>{{ row['用户名称'] }}</td>
          <td>{{ row['小区名称'] }}</td>
          <td>{{ row['报装日期'] }}</td>
          <td>{{ row['拟接入管径'] || '—' }}</td>
          <td>
            {{ row['实测管径'] || '—' }}
            <span v-if="isConflict(row)" class="warn-tag" title="现场复测与勘察拟接不一致，以复测为准">复测不符</span>
          </td>
          <td><strong>{{ effectiveDiameter(row) || '—' }}</strong></td>
          <td class="conclusion-cell">{{ row['勘察结论'] || '—' }}</td>
          <td>{{ row['勘察人'] || '—' }}</td>
          <td>{{ row['开工日期'] || '—' }}</td>
          <td>{{ row['完工日期'] || '—' }}</td>
          <td>{{ row['施工班组'] || '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.status === '已完工'" class="sync-tag" title="已回写供水调度接网待办">已回写调度</span>
          </td>
          <td class="row-actions">
            <button
              v-if="row.status === '待勘察' || row.status === '已勘察'"
              class="link"
              type="button"
              @click="openSurvey(row)"
            >
              登记勘察
            </button>
            <button
              v-if="row.status === '已勘察' || row.status === '施工中'"
              class="link"
              type="button"
              @click="openStart(row)"
            >
              登记开工
            </button>
            <button v-if="row.status === '施工中'" class="link" type="button" @click="openFinish(row)">
              登记完工
            </button>
            <span v-if="row.status === '已完工'" class="muted-link">已接水</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">该时间段没有报装单，可先登记或导入历史报装册</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 张报装单 · 勘察与施工记在同一张单上</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记报装单 -->
    <div v-if="dialog === 'create'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>登记用水报装单</h3>
        <div class="form-grid">
          <label><span>报装编号 *</span><input v-model="createForm.报装编号" placeholder="如 BZ-2026-0006" /></label>
          <label><span>用户名称 *</span><input v-model="createForm.用户名称" /></label>
          <label><span>小区名称 *</span><input v-model="createForm.小区名称" /></label>
          <label><span>报装日期 *</span><input v-model="createForm.报装日期" type="date" /></label>
          <label><span>拟接入管径 *</span><input v-model="createForm.拟接入管径" placeholder="如 DN100" /></label>
          <label class="full-cell"><span>备注</span><input v-model="createForm.备注" /></label>
        </div>
        <p v-if="dialogMessage" class="error-text">{{ dialogMessage }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 勘察结论（与报装同一张单） -->
    <div v-if="dialog === 'survey'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>登记勘察结论 · {{ activeRow?.['报装编号'] }}</h3>
        <div class="form-grid">
          <label class="full-cell">
            <span>勘察结论 *</span>
            <textarea v-model="surveyForm.勘察结论" rows="3" placeholder="现场看完的结论：是否具备接入条件、开口位置等"></textarea>
          </label>
          <label><span>勘察人 *</span><input v-model="surveyForm.勘察人" /></label>
          <label><span>拟接入管径（可现场更正）</span><input v-model="surveyForm.拟接入管径" /></label>
          <label class="full-cell"><span>备注</span><input v-model="surveyForm.备注" /></label>
        </div>
        <p v-if="dialogMessage" class="error-text">{{ dialogMessage }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitSurvey">保存勘察结论</button>
        </div>
      </div>
    </div>

    <!-- 接入工程开工 -->
    <div v-if="dialog === 'start'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>登记接入工程开工 · {{ activeRow?.['报装编号'] }}</h3>
        <p class="modal-context">勘察结论：{{ activeRow?.['勘察结论'] }}</p>
        <div class="form-grid">
          <label><span>开工日期 *</span><input v-model="startForm.开工日期" type="date" /></label>
          <label><span>施工班组 *</span><input v-model="startForm.施工班组" /></label>
          <label class="full-cell"><span>备注</span><input v-model="startForm.备注" /></label>
        </div>
        <p v-if="dialogMessage" class="error-text">{{ dialogMessage }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitStart">保存开工</button>
        </div>
      </div>
    </div>

    <!-- 接入工程完工：现场复测管径 -->
    <div v-if="dialog === 'finish'" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <h3>登记接入工程完工 · {{ activeRow?.['报装编号'] }}</h3>
        <p class="modal-context">
          勘察拟接管径：{{ activeRow?.['拟接入管径'] }} ｜ 开工日期：{{ activeRow?.['开工日期'] }}
        </p>
        <div class="form-grid">
          <label><span>完工日期 *</span><input v-model="finishForm.完工日期" type="date" /></label>
          <label>
            <span>现场复测管径 *</span>
            <input v-model="finishForm.实测管径" placeholder="如 DN100" />
          </label>
        </div>
        <p v-if="finishConflict" class="warn-text">
          复测管径与勘察拟接管径不一致，保存后以现场复测的 {{ finishForm.实测管径 }} 为准，并回写调度接网待办。
        </p>
        <p v-else class="modal-tip">完工结论将回写进供水调度的接网待办（调度编号 JW-{{ activeRow?.['报装编号'] }}）。</p>
        <p v-if="dialogMessage" class="error-text">{{ dialogMessage }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitFinish">保存完工并回写调度</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  WS_FIELDS,
  createWaterSign,
  diameterConflicts,
  diameterDiffers,
  downloadWaterSigns,
  effectiveDiameter,
  ensureDispatchTodos,
  exportWaterSigns,
  importTemplate,
  importWaterSigns,
  listWaterSigns,
  saveFinish,
  saveStart,
  saveSurvey,
} from '@/api/watersign-service'
import { listRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const DISPATCH_KEY = 'dispatch'

const columns = [
  '报装编号',
  '用户名称',
  '小区名称',
  '报装日期',
  '拟接入管径',
  '实测管径',
  '接入管径',
  '勘察结论',
  '勘察人',
  '开工日期',
  '完工日期',
  '施工班组',
]
const statuses = ['待勘察', '已勘察', '施工中', '已完工']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const todoCount = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ keyword: '', status: '', dateFrom: '', dateTo: '' })
const exportRange = ref<{ dateFrom: string; dateTo: string }>({ dateFrom: '2026-09-01', dateTo: '2026-10-31' })
const exportMessage = ref('')
const exportOk = ref(false)
const importMessage = ref('')
const importOk = ref(false)

const dialog = ref<'' | 'create' | 'survey' | 'start' | 'finish'>('')
const activeRow = ref<EntryRow | null>(null)
const dialogMessage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const createForm = ref({ 报装编号: '', 用户名称: '', 小区名称: '', 报装日期: '', 拟接入管径: '', 备注: '' })
const surveyForm = ref({ 勘察结论: '', 勘察人: '', 拟接入管径: '', 备注: '' })
const startForm = ref({ 开工日期: '', 施工班组: '', 备注: '' })
const finishForm = ref({ 完工日期: '', 实测管径: '' })

const stats = computed(() => [
  { label: '待勘察报装', value: rows.value.filter((row) => row.status === '待勘察').length },
  { label: '施工中工程', value: rows.value.filter((row) => row.status === '施工中').length },
  { label: '已完工接水', value: rows.value.filter((row) => row.status === '已完工').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => String(row.status) === status).length })),
)
const conflictCount = computed(() => rows.value.filter((row) => diameterConflicts(row)).length)

const finishConflict = computed(() => {
  if (!activeRow.value || !finishForm.value.实测管径.trim()) {
    return false
  }
  return diameterDiffers(String(activeRow.value['拟接入管径'] ?? ''), finishForm.value.实测管径)
})

function isConflict(row: EntryRow): boolean {
  return diameterConflicts(row)
}

function resetFilters() {
  filters.value = { keyword: '', status: '', dateFrom: '', dateTo: '' }
  reload()
}

function buildQuery(): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.value.keyword.trim()) {
    query.keyword = filters.value.keyword.trim()
  }
  if (filters.value.dateFrom) {
    query.dateFrom = filters.value.dateFrom
  }
  if (filters.value.dateTo) {
    query.dateTo = filters.value.dateTo
  }
  return query
}

function reload() {
  errorMessage.value = ''
  ensureDispatchTodos()
  const query = buildQuery()
  let list = listWaterSigns(query)
  if (filters.value.status) {
    list = list.filter((row) => String(row.status) === filters.value.status)
  }
  rows.value = list
  total.value = list.length
  todoCount.value = listRows(DISPATCH_KEY).filter((item) => String(item['调度方式']) === '接网待办').length
}

function closeDialog() {
  dialog.value = ''
  activeRow.value = null
  dialogMessage.value = ''
}

function openCreate() {
  createForm.value = { 报装编号: '', 用户名称: '', 小区名称: '', 报装日期: '2026-10-07', 拟接入管径: '', 备注: '' }
  dialogMessage.value = ''
  dialog.value = 'create'
}

function submitCreate() {
  const result = createWaterSign(createForm.value)
  if (!result.ok) {
    dialogMessage.value = result.message
    return
  }
  closeDialog()
  importMessage.value = ''
  reload()
}

function openSurvey(row: EntryRow) {
  activeRow.value = row
  surveyForm.value = {
    勘察结论: String(row['勘察结论'] ?? ''),
    勘察人: String(row['勘察人'] ?? ''),
    拟接入管径: String(row['拟接入管径'] ?? ''),
    备注: String(row['备注'] ?? ''),
  }
  dialogMessage.value = ''
  dialog.value = 'survey'
}

function submitSurvey() {
  if (!activeRow.value) {
    return
  }
  const result = saveSurvey(Number(activeRow.value.id), surveyForm.value)
  if (!result.ok) {
    dialogMessage.value = result.message
    return
  }
  closeDialog()
  reload()
}

function openStart(row: EntryRow) {
  activeRow.value = row
  startForm.value = {
    开工日期: String(row['开工日期'] ?? ''),
    施工班组: String(row['施工班组'] ?? ''),
    备注: String(row['备注'] ?? ''),
  }
  dialogMessage.value = ''
  dialog.value = 'start'
}

function submitStart() {
  if (!activeRow.value) {
    return
  }
  const result = saveStart(Number(activeRow.value.id), startForm.value)
  if (!result.ok) {
    dialogMessage.value = result.message
    return
  }
  closeDialog()
  reload()
}

function openFinish(row: EntryRow) {
  activeRow.value = row
  finishForm.value = { 完工日期: '2026-10-07', 实测管径: String(row['拟接入管径'] ?? '') }
  dialogMessage.value = ''
  dialog.value = 'finish'
}

function submitFinish() {
  if (!activeRow.value) {
    return
  }
  const result = saveFinish(Number(activeRow.value.id), finishForm.value)
  if (!result.ok) {
    dialogMessage.value = result.message
    return
  }
  closeDialog()
  importMessage.value = ''
  importOk.value = true
  importMessage.value = result.message
  reload()
}

function doExport() {
  exportMessage.value = ''
  const result = exportWaterSigns(exportRange.value)
  exportOk.value = result.ok
  if (!result.ok || !result.content) {
    exportMessage.value = result.message
    return
  }
  downloadWaterSigns({ filename: result.filename ?? '', content: result.content })
  exportMessage.value = `✔ ${result.message}。文件已开始下载，若打开后为空或缺列，请按表头 ${WS_FIELDS.length + 1} 列核对。`
}

function downloadTpl() {
  const tpl = importTemplate()
  downloadWaterSigns({ filename: tpl.filename, content: tpl.content })
}

function triggerImport() {
  fileInput.value?.click()
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const content = String(reader.result ?? '')
    const result = importWaterSigns(content)
    importOk.value = result.ok
    // 导入失败时服务端整册未落库，原册子不动；修好文件可直接再来一次。
    importMessage.value = result.ok
      ? `✔ ${result.message}`
      : `✘ ${result.message}。可修正文件后重新导入。`
    if (result.ok) {
      reload()
    }
  }
  reader.onerror = () => {
    importOk.value = false
    importMessage.value = '✘ 文件读取失败，原有册子未改动，可重试。'
  }
  reader.readAsText(file, 'utf-8')
}

onMounted(reload)
</script>
