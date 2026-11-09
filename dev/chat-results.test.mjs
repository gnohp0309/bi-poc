import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChatResult, parseResultTable, formatResultValue } from '../frontend/src/chat-result-model.ts'

const parse = r => parseChatResult(JSON.stringify({ analysis_result: { schemaVersion: 1, kind: 'statistical_test', status: 'success', ...r } }))
test('malformed history is reported without throwing', () => {
  assert.equal(parseChatResult('{oops').problems.length, 1)
  assert.equal(parseChatResult('null').problems.length, 1)
  assert.equal(parseChatResult('{}').result, undefined)
})
test('legacy tables remain readable and have no invented statistical metadata', () => {
  const r = parseChatResult(JSON.stringify({ data: { columns: ['n'], rows: [{ n: 0 }, { n: null }] } }))
  assert.equal(r.table.rows[0].n, 0)
  assert.equal(r.table.rows[1].n, null)
  assert.equal(r.result, undefined)
})
test('exploration reports are linked only from saved exploration results with a dataset UUID', () => {
  const datasetId = '204a35ee-800c-4dc3-8f1f-cf2590eae80d'
  const exploration = { datasetId }
  assert.equal(parseChatResult(JSON.stringify({ intent: 'explore', exploration })).explorationDatasetId, datasetId)
  assert.equal(parseChatResult(JSON.stringify({ intent: 'query', exploration })).explorationDatasetId, undefined)
  assert.equal(parseChatResult(JSON.stringify({ intent: 'explore', exploration: { datasetId: '../other' } })).explorationDatasetId, undefined)
})
test('zero and a missing value stay distinct; small p-values do not round to zero', () => {
  assert.equal(formatResultValue(0), '0')
  assert.equal(formatResultValue(null), '—')
  assert.equal(formatResultValue(undefined), '—')
  assert.match(formatResultValue(1e-14), /e-14/)
})
test('precise numeric strings are preserved verbatim', () => {
  const raw = '90071992547409931234567890.123456789'
  const r = parse({ statistic: { status: 'available', value: raw }, pValue: { status: 'available', value: '1e-300' } }).result
  assert.equal(r.statistic.value, raw)
  assert.equal(formatResultValue(r.statistic.value), raw)
  assert.equal(r.pValue.value, '1e-300')
})
test('a p-value alone never produces a conclusion or passes assumptions', () => {
  const r = parse({ pValue: { status: 'available', value: 0.001 } }).result
  assert.equal(r.conclusion, undefined)
  assert.deepEqual(r.assumptions, [])
})
test('insufficient data and unavailable metrics keep reasons', () => {
  const r = parse({ status: 'insufficient_data', reason: 'Need two groups', pValue: { status: 'not_computed', value: null, reason: 'Only one group' }, confidenceInterval: { status: 'not_applicable', reason: 'Method has no CI' } }).result
  assert.equal(r.status, 'insufficient_data')
  assert.equal(r.reason, 'Need two groups')
  assert.equal(r.pValue.value, null)
  assert.equal(r.confidenceInterval.status, 'not_applicable')
})
test('assumptions, hypotheses, sample counts, engine conclusion survive parsing', () => {
  const r = parse({ method: 'Welch T-test', hypotheses: { h0: 'equal means', h1: 'different means' }, sample: { total: 10, used: 8, missing: 2, groups: [{ name: 'A', count: 4 }] }, assumptions: [{ name: 'Independence', status: 'not_checked' }, { name: 'Normality', status: 'failed' }], conclusion: 'Engine conclusion', provenance: { engine: 'scipy', sampled: true, sampleSize: 8 } }).result
  assert.equal(r.hypotheses.h0, 'equal means')
  assert.equal(r.sample.missing, 2)
  assert.equal(r.assumptions[0].status, 'not_checked')
  assert.equal(r.assumptions[1].status, 'failed')
  assert.equal(r.conclusion, 'Engine conclusion')
  assert.equal(r.provenance.sampled, true)
})
test('table limit is explicit and does not become a source population count', () => {
  const r = parseResultTable({ columns: ['x'], rows: Array.from({ length: 601 }, (_, x) => ({ x })), truncated: false })
  assert.equal(r.rows.length, 500)
  assert.equal(r.receivedRows, 601)
  assert.equal(r.truncated, true)
})
test('invalid tables are rejected, including nested cells and duplicate columns', () => {
  assert.equal(parseResultTable({ columns: ['x'], rows: [{ x: {} }] }), undefined)
  assert.equal(parseResultTable({ columns: ['x', 'x'], rows: [] }), undefined)
  assert.equal(parseResultTable({ columns: ['x'], rows: [null] }), undefined)
})
test('newer schema falls back to the legacy table and reports the unsupported version', () => {
  const r = parseChatResult(JSON.stringify({ data: { columns: ['n'], rows: [{ n: 2 }] }, analysis_result: { schemaVersion: 2, kind: 'query', status: 'success' } }))
  assert.equal(r.table.rows[0].n, 2)
  assert.equal(r.result, undefined)
  assert.equal(r.problems.length, 1)
})
test('invalid chart only affects that chart, not the table or conclusion', () => {
  const r = parse({ conclusion: 'Still available', data: { columns: ['n'], rows: [{ n: 1 }] }, charts: [{ chartType: 'unknown', rows: [] }, { chartType: 'bar', rows: [{ value: 1 }] }, { chartType: 'kpi', metric: 'n', aggregate: 'sum', rows: [{ value: null }] }] })
  assert.equal(r.result.data.rows[0].n, 1)
  assert.equal(r.result.charts.length, 1)
  assert.equal(r.result.charts[0].rows[0].value, null)
  assert.equal(r.result.conclusion, 'Still available')
  assert.equal(r.problems.length, 2)
})
test('dashboard references must be UUIDs', () => {
  assert.equal(parseChatResult('{"dashboard_id":"javascript:alert(1)"}').dashboardId, undefined)
  assert.equal(parseChatResult('{"dashboard_id":"00000000-0000-0000-0000-000000000001"}').dashboardId, '00000000-0000-0000-0000-000000000001')
})
test('HTML-like content is data; parser does not interpret or strip statistical statements', () => {
  assert.equal(parse({ conclusion: '<img src=x onerror=alert(1)>' }).result.conclusion, '<img src=x onerror=alert(1)>')
})
