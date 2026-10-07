import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 用水报装与接入工程：一份报装从窗口登记、现场勘察到接入工程开工/完工都记在同一张单上。
// 这里集中放领域规则，页面只渲染；与其他模块一样由 local-service 统一转出。
const KEY = 'waterapply'
const DISPATCH_KEY = 'dispatch'

const STATUSES = ['待勘察', '已勘察', '施工中', '已接水'] as const

// 报装单业务字段（不含 id/status/pending/abnormal 这些公共列）。
export const WATERAPPLY_FIELDS = [
  '报装编号',
  '用户名称',
  '小区/地址',
  '申请日期',
  '拟接入管径',
  '勘察人员',
  '勘察日期',
  '勘察结论',
  '现场复测管径',
  '接入工程开工日期',
  '接入工程完工日期',
  '接水结论',
] as const

// 导出件固定列头，顺序不能动：少一列、空一行都靠它一眼看出来。
const EXPORT_HEADERS = [
  '报装编号',
  '用户名称',
  '小区/地址',
  '申请日期',
  '拟接入管径',
  '现场复测管径',
  '接入管径',
  '勘察人员',
  '勘察日期',
  '勘察结论',
  '接入工程开工日期',
  '接入工程完工日期',
  '接水结论',
  '接水状态',
]

// 窗口登记时必须填的项；导出前也按这一组校。
const REQUIRED_FIELDS = ['报装编号', '用户名称', '小区/地址', '申请日期', '拟接入管径']

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

/**
 * 接入管径：现场复测的那份优先。勘察（拟接入）与施工时现场复测打架时，以现场复测为准。
 * 列表页和导出件共用这一个口径，保证导出来跟列表逐字一样。
 */
export function effectiveDiameter(row: EntryRow): string {
  const remeasured = text(row, '现场复测管径')
  if (remeasured !== '') {
    return remeasured
  }
  return text(row, '拟接入管径')
}

export function diameterConflict(row: EntryRow): boolean {
  const planned = text(row, '拟接入管径')
  const remeasured = text(row, '现场复测管径')
  return planned !== '' && remeasured !== '' && planned !== remeasured
}

function inferStatus(row: EntryRow): string {
  if (text(row, '接入工程完工日期') !== '') return '已接水'
  if (text(row, '接入工程开工日期') !== '') return '施工中'
  if (text(row, '勘察结论') !== '') return '已勘察'
  return '待勘察'
}

// 列表/导出统一走这里，补出派生列，口径只有一份。
export function presentRow(row: EntryRow): EntryRow {
  const status = STATUSES.includes(row.status as (typeof STATUSES)[number])
    ? String(row.status)
    : inferStatus(row)
  return {
    ...row,
    status,
    接入管径: effectiveDiameter(row),
    管径冲突: diameterConflict(row),
    pending: status !== '已接水',
    abnormal: diameterConflict(row),
  }
}

export function listWaterApply(filters: { keyword?: string; from?: string; to?: string } = {}): {
  items: EntryRow[]
  total: number
} {
  let rows = listRows(KEY).map(presentRow)
  const keyword = (filters.keyword ?? '').trim()
  if (keyword) {
    rows = rows.filter((row) =>
      ['报装编号', '用户名称', '小区/地址', '勘察结论'].some((field) =>
        text(row, field).includes(keyword),
      ),
    )
  }
  if (filters.from) {
    rows = rows.filter((row) => text(row, '申请日期') >= filters.from!)
  }
  if (filters.to) {
    rows = rows.filter((row) => text(row, '申请日期') <= filters.to!)
  }
  return { items: rows, total: rows.length }
}

function nextApplyNo(rows: EntryRow[]): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const row of rows) {
    const matched = /^BS-(\d{4})(\d{3,})$/.exec(text(row, '报装编号'))
    if (matched && Number(matched[1]) === year) {
      max = Math.max(max, Number(matched[2]))
    }
  }
  return `BS-${year}${String(max + 1).padStart(3, '0')}`
}

export function nextWaterApplyNo(): string {
  return nextApplyNo(listRows(KEY))
}

function requireFields(row: Partial<EntryRow>): string[] {
  return REQUIRED_FIELDS.filter((field) => String(row[field] ?? '').trim() === '').map(
    (field) => `缺少必填项「${field}」`,
  )
}

// 窗口登记：同一报装编号不许登两遍。
export function createWaterApply(input: Partial<EntryRow>): ActionResult {
  const rows = listRows(KEY)
  const no = String(input['报装编号'] ?? '').trim() || nextApplyNo(rows)
  const draft: EntryRow = {
    id: 0,
    status: '待勘察',
    pending: true,
    abnormal: false,
    '报装编号': no,
    '用户名称': String(input['用户名称'] ?? '').trim(),
    '小区/地址': String(input['小区/地址'] ?? '').trim(),
    '申请日期': String(input['申请日期'] ?? '').trim(),
    '拟接入管径': String(input['拟接入管径'] ?? '').trim(),
    '勘察人员': '',
    '勘察日期': '',
    '勘察结论': '',
    '现场复测管径': '',
    '接入工程开工日期': '',
    '接入工程完工日期': '',
    '接水结论': '',
  }
  const problems = requireFields(draft)
  if (problems.length) {
    return { ok: false, message: `报装单${problems[0]}` }
  }
  if (rows.some((row) => text(row, '报装编号') === no)) {
    return { ok: false, message: `报装编号 ${no} 已登记过，同一报装编号不许登两遍` }
  }
  draft.id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  saveRows(KEY, [...rows, draft])
  return { ok: true, message: `报装单 ${no} 已登记，等待现场勘察` }
}

function findIndex(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

// 现场勘察：在原单上回填勘察人员、勘察日期与勘察结论，单不换、编号不变。
export function recordSurvey(
  id: number,
  payload: { 勘察人员: string; 勘察日期: string; 勘察结论: string },
): ActionResult {
  const rows = listRows(KEY)
  const index = findIndex(rows, id)
  if (index < 0) return { ok: false, message: '没有找到这张报装单' }
  const current = rows[index]
  if (!['待勘察', '已勘察'].includes(String(current.status))) {
    return { ok: false, message: `当前状态「${current.status}」不能再登记勘察` }
  }
  if (!payload.勘察人员.trim() || !payload.勘察日期.trim() || !payload.勘察结论.trim()) {
    return { ok: false, message: '勘察人员、勘察日期、勘察结论都要填，不能空着回填' }
  }
  const updated: EntryRow = {
    ...current,
    勘察人员: payload.勘察人员.trim(),
    勘察日期: payload.勘察日期.trim(),
    勘察结论: payload.勘察结论.trim(),
    status: '已勘察',
  }
  const next = [...rows]
  next[index] = presentRow(updated)
  saveRows(KEY, next)
  return { ok: true, message: `报装单 ${text(current, '报装编号')} 勘察结论已记在原单上` }
}

// 接入工程开工：现场复测管径在这里落单；与拟接入管径不一致时先标出来，但仍以复测为准。
export function recordStart(
  id: number,
  payload: { 开工日期: string; 现场复测管径: string },
): ActionResult {
  const rows = listRows(KEY)
  const index = findIndex(rows, id)
  if (index < 0) return { ok: false, message: '没有找到这张报装单' }
  const current = rows[index]
  if (!['已勘察', '施工中'].includes(String(current.status))) {
    return { ok: false, message: `当前状态「${current.status}」还不能登记开工（先勘察）` }
  }
  if (!payload.开工日期.trim()) {
    return { ok: false, message: '开工日期必填' }
  }
  const updated: EntryRow = {
    ...current,
    接入工程开工日期: payload.开工日期.trim(),
    现场复测管径: payload.现场复测管径.trim() || text(current, '现场复测管径'),
    status: '施工中',
  }
  const presented = presentRow(updated)
  const next = [...rows]
  next[index] = presented
  saveRows(KEY, next)
  const warn = presented.abnormal
    ? `；现场复测 ${presented['接入管径']} 与拟接入 ${text(current, '拟接入管径')} 不一致，已按现场复测口径登记`
    : ''
  return { ok: true, message: `报装单 ${text(current, '报装编号')} 接入工程已开工${warn}` }
}

// 接水完工：在同一张单记完工日期与接水结论，并回写供水调度的接网待办。
export function recordCompletion(
  id: number,
  payload: { 完工日期: string; 接水结论: string },
): ActionResult {
  const rows = listRows(KEY)
  const index = findIndex(rows, id)
  if (index < 0) return { ok: false, message: '没有找到这张报装单' }
  const current = rows[index]
  if (String(current.status) !== '施工中') {
    return { ok: false, message: `当前状态「${current.status}」还不能登记完工（先开工）` }
  }
  if (!payload.完工日期.trim()) {
    return { ok: false, message: '完工日期必填' }
  }
  if (!text(current, '接入工程开工日期')) {
    return { ok: false, message: '还没登记开工日期，不能直接完工' }
  }
  const updated: EntryRow = presentRow({
    ...current,
    接入工程完工日期: payload.完工日期.trim(),
    接水结论: payload.接水结论.trim(),
    status: '已接水',
  })
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  upsertDispatchTodo(updated)
  return { ok: true, message: `报装单 ${text(current, '报装编号')} 已接水，结论已回写供水调度接网待办` }
}

// 接网待办：一张报装对应一条（按 调度编号 JW-报装编号 去重），反复完工/重复导入不会翻倍。
function dispatchTodoNo(row: EntryRow): string {
  return `JW-${text(row, '报装编号')}`
}

export function upsertDispatchTodo(row: EntryRow): EntryRow {
  const todos = listRows(DISPATCH_KEY)
  const no = dispatchTodoNo(row)
  const index = todos.findIndex((item) => text(item, '调度编号') === no)
  const todo: EntryRow = {
    id: index >= 0 ? todos[index].id : todos.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1,
    status: '待下达',
    pending: true,
    abnormal: false,
    调度编号: no,
    调度时段: text(row, '接入工程完工日期'),
    目标供水量: `接水点 ${text(row, '小区/地址')}`,
    实际供水量: '',
    调度方式: '接网待办',
    调度人员: text(row, '勘察人员'),
    下达时间: text(row, '接入工程完工日期'),
    调度状态: '',
    待办类型: '接网待办',
    报装编号: text(row, '报装编号'),
    用户名称: text(row, '用户名称'),
    接入管径: effectiveDiameter(row),
    完工日期: text(row, '接入工程完工日期'),
    接水结论: text(row, '接水结论'),
  }
  const next = index >= 0 ? todos.map((item, i) => (i === index ? todo : item)) : [...todos, todo]
  saveRows(DISPATCH_KEY, next)
  return todo
}

export function listDispatchTodos(): EntryRow[] {
  return listRows(DISPATCH_KEY).filter((row) => text(row, '待办类型') === '接网待办')
}

// 调度侧办结一条接网待办（泛型动作处理不了的扩展列，单独提供）。
export function closeDispatchTodo(id: number): ActionResult {
  const todos = listRows(DISPATCH_KEY)
  const index = todos.findIndex((row) => Number(row.id) === id)
  if (index < 0) return { ok: false, message: '没有找到这条接网待办' }
  const updated: EntryRow = { ...todos[index], status: '已完成', pending: false }
  const next = [...todos]
  next[index] = updated
  saveRows(DISPATCH_KEY, next)
  return { ok: true, message: `接网待办 ${text(todos[index], '调度编号')} 已办结` }
}

// ---------- CSV ----------

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsv(headers: string[], records: EntryRow[]): string {
  const lines = [headers.map((h) => csvEscape(h)).join(',')]
  for (const row of records) {
    lines.push(headers.map((h) => csvEscape(String(row[h] ?? ''))).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

// 支持引号、转义引号、字段内换行；表头缺列时由调用方判断。
function parseCsv(content: string): string[][] {
  const src = content.replace(/^﻿/, '')
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      record.push(field)
      field = ''
      // 跳过文件末尾空行
      if (record.some((cell) => cell.trim() !== '')) rows.push(record)
      record = []
    } else {
      field += ch
    }
  }
  record.push(field)
  if (record.some((cell) => cell.trim() !== '')) rows.push(record)
  return rows
}

export type ExportWindow = { from?: string; to?: string }

export type WaterApplyExport =
  | { ok: true; filename: string; content: string; count: number }
  | { ok: false; message: string; errors: string[] }

// 窗口导出某段时间的报装单（按申请日期）连勘察结论。导出前先校必填项；空时段或缺项直接拦下。
export function exportWaterApply(window: ExportWindow = {}): WaterApplyExport {
  const { items } = listWaterApply({ from: window.from, to: window.to })
  const range = [window.from, window.to].filter(Boolean).join(' 至 ') || '全部时段'
  if (items.length === 0) {
    return { ok: false, message: `${range}没有可导出的报装单，已取消导出（不会生成空文件）`, errors: [] }
  }
  const errors: string[] = []
  for (const row of items) {
    const missing = REQUIRED_FIELDS.filter((field) => text(row, field) === '')
    if (missing.length) {
      errors.push(`报装单 ${text(row, '报装编号') || '(无编号)'}：缺 ${missing.join('、')}`)
    }
  }
  if (errors.length) {
    return {
      ok: false,
      message: `导出前校验未通过：${errors.length} 张报装单必填项不全，已取消导出`,
      errors,
    }
  }
  const content = toCsv(EXPORT_HEADERS, items)
  return {
    ok: true,
    filename: `用水报装清单-${range.replace(/\s+/g, '_')}.csv`,
    content,
    count: items.length,
  }
}

export type ImportReport = {
  ok: boolean
  message: string
  inserted: number
  updated: number
  todosWritten: number
  errors: string[]
}

// 历史报装册导入：整册先解析、校验，任何一行有问题都不落库（原来的册子原样保留，可改完重来）。
// 按报装编号幂等回填：库里已有的更新、没有的新增；再导一次不会翻倍。
export function importWaterApply(content: string): ImportReport {
  const grid = parseCsv(content)
  if (grid.length === 0) {
    return { ok: false, message: '文件是空的，没有可导入的报装单', inserted: 0, updated: 0, todosWritten: 0, errors: [] }
  }
  const headers = grid[0].map((h) => h.trim())
  const requiredColumns = ['报装编号', '用户名称', '小区/地址', '申请日期', '拟接入管径', '勘察结论']
  const missingColumns = requiredColumns.filter((col) => !headers.includes(col))
  if (missingColumns.length) {
    return {
      ok: false,
      message: `导入册缺少必需列：${missingColumns.join('、')}，已整册退回，现有台账未改动`,
      inserted: 0,
      updated: 0,
      todosWritten: 0,
      errors: [],
    }
  }

  const errors: string[] = []
  const incoming: EntryRow[] = []
  const seenNo = new Set<string>()
  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r]
    const get = (name: string) => (cells[headers.indexOf(name)] ?? '').trim()
    const no = get('报装编号')
    if (!no) {
      errors.push(`第 ${r + 1} 行：报装编号为空`)
      continue
    }
    if (seenNo.has(no)) {
      errors.push(`第 ${r + 1} 行：报装编号 ${no} 在本册子里重复`)
      continue
    }
    seenNo.add(no)
    for (const col of ['用户名称', '小区/地址', '申请日期', '拟接入管径']) {
      if (get(col) === '') errors.push(`第 ${r + 1} 行（${no}）：必填项「${col}」为空`)
    }
    const explicitStatus = get('接水状态')
    const merged: EntryRow = {
      id: 0,
      status: STATUSES.includes(explicitStatus as (typeof STATUSES)[number]) ? explicitStatus : '',
      pending: true,
      abnormal: false,
    }
    for (const field of WATERAPPLY_FIELDS) {
      const col = headers.indexOf(field)
      merged[field] = col >= 0 ? (cells[col] ?? '').trim() : ''
    }
    incoming.push(presentRow(merged))
  }

  if (errors.length) {
    // 关键：任何错误都不 saveRows，localStorage 里的原册子原封不动。
    return {
      ok: false,
      message: `导入册有 ${errors.length} 处问题，已全部退回且未改动现有台账，修正后可重新导入`,
      inserted: 0,
      updated: 0,
      todosWritten: 0,
      errors,
    }
  }

  const existing = listRows(KEY)
  const byNo = new Map(existing.map((row) => [text(row, '报装编号'), row]))
  let inserted = 0
  let updated = 0
  const mergedRows = [...existing]
  for (const incomingRow of incoming) {
    const no = text(incomingRow, '报装编号')
    const old = byNo.get(no)
    if (old) {
      // 按当时的结论回填原单，编号/id 不变；复测管径随册带回，接入管径仍按复测优先重算。
      const rewritten = presentRow({ ...incomingRow, id: old.id })
      const index = mergedRows.findIndex((row) => Number(row.id) === Number(old.id))
      mergedRows[index] = rewritten
      updated += 1
    } else {
      const id = mergedRows.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0) + 1
      const created = presentRow({ ...incomingRow, id })
      mergedRows.push(created)
      byNo.set(no, created)
      inserted += 1
    }
  }
  saveRows(KEY, mergedRows)

  // 已接水的历史单同样把结论回写进调度接网待办；按编号幂等，不会翻倍。
  let todosWritten = 0
  for (const row of mergedRows.filter((r) => String(r.status) === '已接水')) {
    upsertDispatchTodo(row)
    todosWritten += 1
  }

  return {
    ok: true,
    message: `导入完成：新增 ${inserted} 张、回填更新 ${updated} 张，接网待办同步 ${todosWritten} 条；重复编号未翻倍`,
    inserted,
    updated,
    todosWritten,
    errors: [],
  }
}
