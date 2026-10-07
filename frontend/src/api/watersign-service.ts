import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 用水报装与接入工程台账的专用服务：
// 报装、勘察结论、接入工程的开工/完工都记在同一张单上；
// 导出前先校验必填，导入整册校验通过才落库；接水完工回写供水调度接网待办。

export const WS_KEY = 'watersign'
export const DISPATCH_KEY = 'dispatch'

export const WS_STATUSES = ['待勘察', '已勘察', '施工中', '已完工'] as const

export const WS_FIELDS = [
  '报装编号',
  '用户名称',
  '小区名称',
  '报装日期',
  '拟接入管径',
  '勘察结论',
  '勘察人',
  '开工日期',
  '完工日期',
  '实测管径',
  '施工班组',
  '备注',
] as const

// 导出件的固定列：报装编号、接入管径（以现场复测为准）、勘察结论必须在里面，
// 且顺序固定，少一列一眼就能看出来。
export const EXPORT_COLUMNS = [
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
  '当前状态',
] as const

// 导入册必须带的列（表头逐字匹配）。
export const IMPORT_REQUIRED_COLUMNS = [
  '报装编号',
  '用户名称',
  '小区名称',
  '报装日期',
  '拟接入管径',
] as const

const DATE_FIELDS = ['报装日期', '开工日期', '完工日期'] as const

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime())
}

// 管径归一化后比较：DN100 / dn100 / 100 视为同一种写法。
function normalizeDiameter(value: string): string {
  const matched = value.toUpperCase().match(/DN\s*(\d+)/)
  if (matched) {
    return `DN${matched[1]}`
  }
  const digits = value.match(/\d+/)
  return digits ? `DN${digits[0]}` : value.trim().toUpperCase()
}

// 接入管径：勘察结论与施工实测打架时，以现场复测的那一份为准。
export function effectiveDiameter(row: EntryRow): string {
  const surveyed = text(row, '实测管径')
  return surveyed !== '' ? surveyed : text(row, '拟接入管径')
}

export function diameterConflicts(row: EntryRow): boolean {
  const planned = text(row, '拟接入管径')
  const surveyed = text(row, '实测管径')
  if (planned === '' || surveyed === '') {
    return false
  }
  return normalizeDiameter(planned) !== normalizeDiameter(surveyed)
}

// 完工登记时用：判断拟填的复测值是否与勘察拟接不一致。
export function diameterDiffers(planned: string, surveyed: string): boolean {
  if (planned.trim() === '' || surveyed.trim() === '') {
    return false
  }
  return normalizeDiameter(planned) !== normalizeDiameter(surveyed)
}

function deriveStatus(row: EntryRow): string {
  if (!isBlank(row['完工日期']) && !isBlank(row['实测管径'])) {
    return '已完工'
  }
  if (!isBlank(row['开工日期'])) {
    return '施工中'
  }
  if (!isBlank(row['勘察结论'])) {
    return '已勘察'
  }
  return '待勘察'
}

export function listWaterSigns(filters: Record<string, string> = {}): EntryRow[] {
  const keywordFields = ['报装编号', '用户名称', '小区名称', '勘察结论', '施工班组']
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  return listRows(WS_KEY)
    .filter((row) =>
      pairs.every(([field, value]) => {
        const needle = value.trim()
        if (field === 'dateFrom') {
          return text(row, '报装日期') >= needle
        }
        if (field === 'dateTo') {
          return text(row, '报装日期') <= needle
        }
        if (field === 'keyword' || field === '报装编号') {
          return keywordFields.some((name) => text(row, name).includes(needle))
        }
        return String(row[field] ?? '').includes(needle)
      }),
    )
    .sort((a, b) => String(b['报装编号']).localeCompare(String(a['报装编号']), 'zh-Hans-CN'))
}

export type WaterSignDraft = {
  报装编号: string
  用户名称: string
  小区名称: string
  报装日期: string
  拟接入管径: string
  备注?: string
}

export function createWaterSign(draft: WaterSignDraft): ActionResult {
  const normalized: Record<string, string> = {}
  for (const field of ['报装编号', '用户名称', '小区名称', '报装日期', '拟接入管径', '备注'] as const) {
    normalized[field] = (draft[field] ?? '').trim()
  }
  if (isBlank(normalized['报装编号'])) {
    return { ok: false, message: '报装编号为必填项，不允许空编号登记' }
  }
  if (!isValidDate(normalized['报装日期'])) {
    return { ok: false, message: '报装日期必须是 YYYY-MM-DD 格式的有效日期' }
  }
  if (isBlank(normalized['拟接入管径'])) {
    return { ok: false, message: '拟接入管径为必填项' }
  }
  const rows = listRows(WS_KEY)
  // 同一报装编号不许登两遍。
  if (rows.some((row) => text(row, '报装编号') === normalized['报装编号'])) {
    return { ok: false, message: `报装编号 ${normalized['报装编号']} 已登记，不许重复登账` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id,
    status: '待勘察',
    pending: true,
    abnormal: false,
    报装编号: normalized['报装编号'],
    用户名称: normalized['用户名称'],
    小区名称: normalized['小区名称'],
    报装日期: normalized['报装日期'],
    拟接入管径: normalized['拟接入管径'],
    勘察结论: '',
    勘察人: '',
    开工日期: '',
    完工日期: '',
    实测管径: '',
    施工班组: '',
    备注: normalized['备注'] ?? '',
  }
  saveRows(WS_KEY, [...rows, row])
  return { ok: true, message: `报装单 ${row['报装编号']} 已登记，状态：待勘察` }
}

function findRow(rows: EntryRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function validateDates(updates: Record<string, string>, row: EntryRow): string | null {
  for (const field of DATE_FIELDS) {
    const value = updates[field]
    if (value === undefined) {
      continue
    }
    if (value.trim() !== '' && !isValidDate(value.trim())) {
      return `${field}必须是 YYYY-MM-DD 格式的有效日期`
    }
  }
  const report = (updates['报装日期'] ?? text(row, '报装日期')).trim()
  const start = (updates['开工日期'] ?? text(row, '开工日期')).trim()
  const finish = (updates['完工日期'] ?? text(row, '完工日期')).trim()
  if (start && report && start < report) {
    return '开工日期不能早于报装日期'
  }
  if (finish && start && finish < start) {
    return '完工日期不能早于开工日期'
  }
  return null
}

function persist(rows: EntryRow[], index: number, updates: Record<string, string>): EntryRow {
  const merged: EntryRow = { ...rows[index] }
  for (const field of WS_FIELDS) {
    if (updates[field] !== undefined) {
      merged[field] = updates[field].trim()
    }
  }
  merged.status = deriveStatus(merged)
  merged.pending = merged.status !== '已完工'
  merged.abnormal = diameterConflicts(merged)
  const next = [...rows]
  next[index] = merged
  saveRows(WS_KEY, next)
  return merged
}

export type SurveyDraft = {
  勘察结论: string
  勘察人: string
  拟接入管径?: string
  备注?: string
}

export function saveSurvey(id: number, draft: SurveyDraft): ActionResult {
  const rows = listRows(WS_KEY)
  const index = findRow(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的报装单` }
  }
  const updates: Record<string, string> = {
    勘察结论: draft.勘察结论 ?? '',
    勘察人: draft.勘察人 ?? '',
  }
  if (draft.拟接入管径 !== undefined) {
    updates['拟接入管径'] = draft.拟接入管径
  }
  if (draft.备注 !== undefined) {
    updates['备注'] = draft.备注
  }
  if (isBlank(updates['勘察结论'])) {
    return { ok: false, message: '勘察结论为必填项，现场结论不登记不能过账' }
  }
  if (isBlank(updates['勘察人'])) {
    return { ok: false, message: '勘察人为必填项' }
  }
  const dateError = validateDates(updates, rows[index])
  if (dateError) {
    return { ok: false, message: dateError }
  }
  const merged = persist(rows, index, updates)
  return { ok: true, message: `报装单 ${merged['报装编号']} 的勘察结论已登记，状态：${merged.status}` }
}

export type StartDraft = {
  开工日期: string
  施工班组: string
  备注?: string
}

export function saveStart(id: number, draft: StartDraft): ActionResult {
  const rows = listRows(WS_KEY)
  const index = findRow(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的报装单` }
  }
  if (isBlank(text(rows[index], '勘察结论'))) {
    return { ok: false, message: '勘察结论还没登记，接入工程不允许先开工' }
  }
  const updates: Record<string, string> = {
    开工日期: draft.开工日期 ?? '',
    施工班组: draft.施工班组 ?? '',
  }
  if (draft.备注 !== undefined) {
    updates['备注'] = draft.备注
  }
  if (isBlank(updates['开工日期'])) {
    return { ok: false, message: '开工日期为必填项' }
  }
  if (isBlank(updates['施工班组'])) {
    return { ok: false, message: '施工班组为必填项' }
  }
  const dateError = validateDates(updates, rows[index])
  if (dateError) {
    return { ok: false, message: dateError }
  }
  const merged = persist(rows, index, updates)
  return { ok: true, message: `报装单 ${merged['报装编号']} 的接入工程已开工` }
}

export type FinishDraft = {
  完工日期: string
  实测管径: string
}

export function saveFinish(id: number, draft: FinishDraft): ActionResult {
  const rows = listRows(WS_KEY)
  const index = findRow(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的报装单` }
  }
  const current = rows[index]
  if (isBlank(text(current, '开工日期'))) {
    return { ok: false, message: '接入工程还没开工，不能登记完工' }
  }
  const updates: Record<string, string> = {
    完工日期: draft.完工日期 ?? '',
    实测管径: draft.实测管径 ?? '',
  }
  if (isBlank(updates['完工日期'])) {
    return { ok: false, message: '完工日期为必填项' }
  }
  if (isBlank(updates['实测管径'])) {
    return { ok: false, message: '现场复测管径为必填项；复测与勘察不一致时以复测为准' }
  }
  const dateError = validateDates(updates, current)
  if (dateError) {
    return { ok: false, message: dateError }
  }
  const merged = persist(rows, index, updates)
  // 接水完工结论回写供水调度的接网待办。
  syncDispatchTodo(merged)
  const conflictNote = diameterConflicts(merged)
    ? '；复测管径与勘察拟接管径不一致，已按现场复测为准'
    : ''
  return { ok: true, message: `报装单 ${merged['报装编号']} 已接水完工，结论已回写调度接网待办${conflictNote}` }
}

// ---- 导出：按时间段导出报装单连勘察结论，导出前先校必填项 ----

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export type ExportParams = {
  dateFrom: string
  dateTo: string
}

export type ExportResult = {
  ok: boolean
  message: string
  filename?: string
  content?: string
  count?: number
}

export function exportWaterSigns(params: ExportParams): ExportResult {
  if (!isValidDate(params.dateFrom) || !isValidDate(params.dateTo)) {
    return { ok: false, message: '请先选择有效的导出时间段（起止日期都必填）' }
  }
  if (params.dateFrom > params.dateTo) {
    return { ok: false, message: '导出起始日期不能晚于截止日期' }
  }
  const rows = listWaterSigns({ dateFrom: params.dateFrom, dateTo: params.dateTo })
  if (rows.length === 0) {
    return { ok: false, message: `${params.dateFrom} 至 ${params.dateTo} 没有可导出的报装单，未生成空文件` }
  }
  // 导出前逐行校必填项，缺项不导出，避免出去的册子没法用。
  const invalid: string[] = []
  for (const row of rows) {
    const missing: string[] = []
    for (const field of IMPORT_REQUIRED_COLUMNS) {
      if (isBlank(text(row, field))) {
        missing.push(field)
      }
    }
    if (isBlank(text(row, '勘察结论'))) {
      missing.push('勘察结论')
    }
    if (missing.length > 0) {
      invalid.push(`${text(row, '报装编号') || '(无编号)'}：缺 ${missing.join('、')}`)
    }
  }
  if (invalid.length > 0) {
    return {
      ok: false,
      message: `必填项校验未通过（${invalid.length} 条），已拦截导出：${invalid.slice(0, 3).join('；')}${invalid.length > 3 ? ' 等' : ''}`,
    }
  }
  const lines = [EXPORT_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        text(row, '报装编号'),
        text(row, '用户名称'),
        text(row, '小区名称'),
        text(row, '报装日期'),
        text(row, '拟接入管径'),
        text(row, '实测管径'),
        effectiveDiameter(row),
        text(row, '勘察结论'),
        text(row, '勘察人'),
        text(row, '开工日期'),
        text(row, '完工日期'),
        text(row, '施工班组'),
        String(row.status ?? ''),
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  // 自检：导出件重新解析一遍，行数、列数、关键字段必须跟列表页逐字一样。
  const reparsed = parseCsv(lines.join('\n'))
  const header = reparsed[0] ?? []
  if (header.length !== EXPORT_COLUMNS.length || EXPORT_COLUMNS.some((name, i) => header[i] !== name)) {
    return { ok: false, message: '导出自检失败：表头列与约定不一致，请重试' }
  }
  for (const row of rows) {
    const record = reparsed.find((cells) => cells[0] === text(row, '报装编号'))
    if (!record) {
      return { ok: false, message: `导出自检失败：报装单 ${text(row, '报装编号')} 在导出件中缺失` }
    }
    if (record.length !== EXPORT_COLUMNS.length) {
      return { ok: false, message: `导出自检失败：报装单 ${text(row, '报装编号')} 列数不对（少列或多列）` }
    }
    if (record[6] !== effectiveDiameter(row) || record[7] !== text(row, '勘察结论')) {
      return { ok: false, message: `导出自检失败：报装单 ${text(row, '报装编号')} 的接入管径/勘察结论与列表不一致` }
    }
  }
  return {
    ok: true,
    message: `已导出 ${rows.length} 条报装单（${params.dateFrom} 至 ${params.dateTo}），共 ${EXPORT_COLUMNS.length} 列`,
    filename: `用水报装与勘察结论-${params.dateFrom}_${params.dateTo}.csv`,
    content: `\uFEFF${lines.join('\n')}`,
    count: rows.length,
  }
}

export function downloadWaterSigns(result: NonNullable<Pick<ExportResult, 'filename' | 'content'>>): void {
  const blob = new Blob([result.content ?? ''], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename ?? '用水报装清单.csv'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---- 导入：整册先校验，任何一行不合格整册不落库，原册子不被顶掉 ----

export function parseCsv(content: string): string[][] {
  // 去掉 Excel 常带的 BOM。
  const source = content.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') {
        i += 1
      }
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

export type ImportResult = {
  ok: boolean
  message: string
  added?: number
  updated?: number
  total?: number
}

export function importWaterSigns(content: string): ImportResult {
  const grid = parseCsv(content)
  if (grid.length === 0) {
    return { ok: false, message: '导入文件是空的，未改动原有册子' }
  }
  const header = grid[0].map((cell) => cell.trim())
  const missingColumns = IMPORT_REQUIRED_COLUMNS.filter((name) => !header.includes(name))
  if (missingColumns.length > 0) {
    return { ok: false, message: `导入册缺少必填列：${missingColumns.join('、')}，未改动原有册子` }
  }
  const indexOf = (name: string): number => header.indexOf(name)
  const records = grid.slice(1)
  if (records.length === 0) {
    return { ok: false, message: '导入册只有表头没有数据，未改动原有册子' }
  }
  const seen = new Set<string>()
  const parsed: EntryRow[] = []
  const errors: string[] = []
  records.forEach((cells, lineNo) => {
    const pick = (name: string): string => {
      const idx = indexOf(name)
      return idx >= 0 ? (cells[idx] ?? '').trim() : ''
    }
    const code = pick('报装编号')
    const tag = `第 ${lineNo + 2} 行（${code || '无编号'}）`
    if (code === '') {
      errors.push(`${tag}：报装编号不能为空`)
      return
    }
    if (seen.has(code)) {
      errors.push(`${tag}：报装编号 ${code} 在导入册里出现了两次`)
      return
    }
    seen.add(code)
    const row: Record<string, string> = {}
    for (const field of WS_FIELDS) {
      row[field] = pick(field)
    }
    for (const name of ['用户名称', '小区名称', '拟接入管径']) {
      if (row[name] === '') {
        errors.push(`${tag}：${name}不能为空`)
      }
    }
    if (!isValidDate(row['报装日期'])) {
      errors.push(`${tag}：报装日期必须是 YYYY-MM-DD 格式`)
    }
    for (const field of ['开工日期', '完工日期']) {
      if (row[field] !== '' && !isValidDate(row[field])) {
        errors.push(`${tag}：${field}必须是 YYYY-MM-DD 格式或留空`)
      }
    }
    if (row['开工日期'] && row['报装日期'] && row['开工日期'] < row['报装日期']) {
      errors.push(`${tag}：开工日期早于报装日期`)
    }
    if (row['完工日期'] && row['开工日期'] && row['完工日期'] < row['开工日期']) {
      errors.push(`${tag}：完工日期早于开工日期`)
    }
    if (row['完工日期'] && row['实测管径'] === '') {
      errors.push(`${tag}：已登完工日期的，必须回填现场复测管径`)
    }
    if (row['勘察结论'] === '' && (row['开工日期'] !== '' || row['完工日期'] !== '')) {
      errors.push(`${tag}：按当时的结论回填，缺勘察结论不能登开工/完工`)
    }
    parsed.push({ id: 0, status: '', pending: true, abnormal: false, ...row })
  })
  // 任意一行不合格：整册不落库，窗口可以修好文件重来。
  if (errors.length > 0) {
    return {
      ok: false,
      message: `导入校验未通过（${errors.length} 处），原有册子未改动：${errors.slice(0, 3).join('；')}${errors.length > 3 ? ' 等' : ''}`,
    }
  }

  // 校验通过才动库里的数据：按报装编号幂等 upsert，重来一遍不会翻倍。
  const rows = listRows(WS_KEY)
  const byCode = new Map(rows.map((row) => [text(row, '报装编号'), row]))
  let added = 0
  let updated = 0
  let nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const finished: EntryRow[] = []
  for (const incoming of parsed) {
    const code = text(incoming, '报装编号')
    const existing = byCode.get(code)
    const status = deriveStatus(incoming)
    if (existing) {
      const merged: EntryRow = { ...existing }
      for (const field of WS_FIELDS) {
        merged[field] = text(incoming, field)
      }
      merged.status = status
      merged.pending = status !== '已完工'
      merged.abnormal = diameterConflicts(merged)
      byCode.set(code, merged)
      updated += 1
      if (merged.status === '已完工') {
        finished.push(merged)
      }
    } else {
      nextId += 1
      const created: EntryRow = {
        ...incoming,
        id: nextId,
        status,
        pending: status !== '已完工',
        abnormal: diameterConflicts(incoming),
      }
      byCode.set(code, created)
      added += 1
      if (status === '已完工') {
        finished.push(created)
      }
    }
  }
  const next = [...byCode.values()].sort((a, b) =>
    text(a, '报装编号').localeCompare(text(b, '报装编号'), 'zh-Hans-CN'),
  )
  saveRows(WS_KEY, next)
  // 历史册里已接水完工的，结论一并回写调度接网待办。
  for (const row of finished) {
    syncDispatchTodo(row)
  }
  return {
    ok: true,
    message: `导入完成：新增 ${added} 条、更新 ${updated} 条；同编号重导只会更新，不会翻倍`,
    added,
    updated,
    total: parsed.length,
  }
}

export function importTemplate(): { filename: string; content: string } {
  const header = [
    '报装编号',
    '用户名称',
    '小区名称',
    '报装日期',
    '拟接入管径',
    '勘察结论',
    '勘察人',
    '开工日期',
    '完工日期',
    '实测管径',
    '施工班组',
    '备注',
  ]
  const sample = [
    'BZ-2026-1001',
    '示例小区物业',
    '示例小区',
    '2026-10-08',
    'DN100',
    '具备接入条件，拟用管径DN100',
    '张三',
    '',
    '',
    '',
    '',
    '按当时结论回填',
  ].map(csvEscape)
  return {
    filename: '历史报装册-导入模板.csv',
    content: `\uFEFF${header.join(',')}\n${sample.join(',')}`,
  }
}

// ---- 接水完工回写供水调度接网待办 ----

export function dispatchTodoCode(waterCode: string): string {
  return `JW-${waterCode}`
}

function syncDispatchTodo(row: EntryRow): void {
  if (String(row.status) !== '已完工') {
    return
  }
  const waterCode = text(row, '报装编号')
  const todoCode = dispatchTodoCode(waterCode)
  const diameter = effectiveDiameter(row)
  const dispatch = listRows(DISPATCH_KEY)
  const existingIndex = dispatch.findIndex((item) => text(item, '调度编号') === todoCode)
  const todo: EntryRow = {
    id: existingIndex >= 0 ? dispatch[existingIndex].id : dispatch.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: existingIndex >= 0 ? String(dispatch[existingIndex].status) : '待下达',
    pending: existingIndex >= 0 ? dispatch[existingIndex].pending : true,
    abnormal: existingIndex >= 0 ? dispatch[existingIndex].abnormal : false,
    调度编号: todoCode,
    调度时段: `${text(row, '完工日期')} 接网`,
    目标供水量: `${diameter} 接水`,
    实际供水量: `来源报装单 ${waterCode}（${text(row, '小区名称')}）`,
    调度方式: '接网待办',
    调度人员: text(row, '施工班组'),
    下达时间: '',
    调度状态: existingIndex >= 0 ? String(dispatch[existingIndex]['调度状态']) : '待下达',
  }
  const next = existingIndex >= 0 ? [...dispatch] : [...dispatch, todo]
  if (existingIndex >= 0) {
    next[existingIndex] = todo
  }
  saveRows(DISPATCH_KEY, next)
}

// 应用启动时对账一次：已完工的报装单在调度侧都应有接网待办，重复执行不翻倍。
export function ensureDispatchTodos(): number {
  const before = new Set(listRows(DISPATCH_KEY).map((item) => text(item, '调度编号')))
  let created = 0
  for (const row of listRows(WS_KEY)) {
    if (String(row.status) !== '已完工') {
      continue
    }
    const code = dispatchTodoCode(text(row, '报装编号'))
    if (!before.has(code)) {
      syncDispatchTodo(row)
      before.add(code)
      created += 1
    }
  }
  return created
}
