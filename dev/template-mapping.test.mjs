import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldProblem, suggestMapping } from '../frontend/src/template-mapping.ts'
const fields = [ {key:'date',label:'Ngày',kind:'date'}, {key:'revenue',label:'Doanh thu',kind:'number'}, {key:'region',label:'Vùng',kind:'text'}, {key:'category',label:'Danh mục',kind:'text'} ]
const col = (name,kind) => ({name,kind,type:kind})
test('suggests real demo and imported CSV columns without hardcoding a dataset', () => {
 assert.deepEqual(suggestMapping(fields,[col('order_date','date'),col('amount','number'),col('region','text'),col('category','text')]),{date:'order_date',revenue:'amount',region:'region',category:'category'})
 assert.deepEqual(suggestMapping(fields,[col('c_ngay','date'),col('c_doanh_thu','number'),col('c_khu_vuc','text'),col('c_danh_muc','text')]),{date:'c_ngay',revenue:'c_doanh_thu',region:'c_khu_vuc',category:'c_danh_muc'})
})
test('does not guess when names are ambiguous, wrong kind, or unrelated', () => {
 assert.deepEqual(suggestMapping(fields,[col('revenue','number'),col('amount','number'),col('order_date','text'),col('mystery','text')]),{})
 assert.deepEqual(suggestMapping(fields,[col('total','number'),col('placed','date'),col('branch','text')]),{})
})
test('reports missing kind and missing or stale mapping with business label', () => {
 assert.match(fieldProblem(fields[0],[col('order_date','text')],{}),/Ngày/)
 assert.match(fieldProblem(fields[1],[col('amount','number')],{}),/Chọn cột/)
 assert.match(fieldProblem(fields[1],[col('amount','number')],{revenue:'deleted'}),/không còn phù hợp/)
 assert.equal(fieldProblem(fields[1],[col('amount','number')],{revenue:'amount'}),'')
})
test('supports explicit alternate mappings and supports metadata column names with spaces', () => {
 assert.equal(fieldProblem(fields[1],[col('net_total','number')],{revenue:'net_total'}),'')
 assert.deepEqual(suggestMapping(fields,[col('doanh thu','number')]),{revenue:'doanh thu'})
 assert.equal(fieldProblem(fields[1],[col('Net total','number')],{revenue:'Net total'}),'')
})
