import test from 'node:test'
import assert from 'node:assert/strict'
import { cellValue, dataColumns, fileBase, filterLabels, pageSlices, sheetName } from '../frontend/src/dashboard-export-model.ts'
import { buildWorkbook } from '../frontend/src/dashboard-export-excel.ts'
const snapshot = {dashboard:{id:'demo',name:'Doanh thu Việt Nam',share_token:'not-for-export',charts:[{id:'chart',name:'Doanh thu / miền [Bắc]',chartType:'bar',aggregate:'sum',dimension:'region',metric:'amount',columns:['label','value'],rows:[{label:'=HYPERLINK("bad")',value:0},{label:'NULL row',value:null},{label:'Precise',value:'123456789012345678.90'}],x:0,y:0,w:12,h:9}]},filterLabels:['Bán hàng · region: = Bắc'],refreshedAt:'2026-11-07T01:00:00Z',exportedAt:'2026-11-07T02:00:00Z'}
test('numeric cells preserve zero, NULL, exact strings and Excel precision limits',()=>{
 assert.equal(cellValue(0),0);assert.equal(cellValue(null),null);assert.equal(cellValue('0012'),'0012')
 assert.equal(cellValue(0.12345678901234567),'0.12345678901234566');assert.equal(cellValue(9007199254740992),'9007199254740992')
 assert.equal(cellValue(Infinity),'Infinity');assert.equal(cellValue(1e-310),'1e-310');assert.equal(cellValue(false),false)
})
test('file/sheet names remain valid, bounded and unique for duplicate titles',()=>{
 assert.ok(!/[<>:"/\\|?*]/.test(fileBase('A/B:*?','2026-11-07T00:00:00.000Z')))
 assert.equal(sheetName('A'.repeat(70),0).length,31)
 assert.notEqual(sheetName('same',0).toLowerCase(),sheetName('same',1).toLowerCase())
 assert.ok(!/[\\/*?:\[\]]/.test(sheetName('bad[]:/name',0)))
})
test('columns preserve server order and include extended chart row fields',()=>{
 assert.deepEqual(dataColumns({columns:['label','value'],rows:[{value:1,lower_bound:0,label:'A'},{upper_bound:2}]}),['label','value','lower_bound','upper_bound'])
})
test('filter descriptions use the applied dataset scope and UTC date range',()=>{
 assert.deepEqual(filterLabels([{datasetId:'ds',column:'day',op:'date',value:'2025-01-01',end:'2025-01-31'}],[{id:'ds',name:'Sales'}]),['Sales · day: 2025-01-01 → 2025-01-31 (UTC)'])
})
test('PDF pages cover all pixels and prefer gaps between chart rows',()=>{
 const pages=pageSlices(1500,800,[{top:100,bottom:500},{top:520,bottom:1000},{top:1020,bottom:1480}])
 assert.equal(pages[0].height,520);assert.equal(pages.reduce((n,p)=>n+p.height,0),1500)
 pages.forEach((p,i)=>{assert.ok(p.height>0 && p.height<=800);assert.equal(p.top,i?pages[i-1].top+pages[i-1].height:0)})
 assert.equal(pageSlices(2000,700,[{top:0,bottom:2000}]).length,3)
 assert.throws(()=>pageSlices(10,0,[]))
})
test('XLSX opens with exact rows, literal formulas, metadata, NULL and zero',async()=>{
 const original=buildWorkbook(snapshot);const buffer=await original.xlsx.writeBuffer();const loaded=new original.constructor();await loaded.xlsx.load(buffer)
 assert.equal(loaded.worksheets.length,2)
 const info=loaded.worksheets[0],data=loaded.worksheets[1]
 assert.equal(info.getCell('B2').value,snapshot.dashboard.name);assert.equal(info.getCell('B7').value,snapshot.filterLabels[0])
 assert.equal(data.getCell('A9').value,'=HYPERLINK("bad")');assert.equal(data.getCell('A9').type,3)
 assert.equal(data.getCell('B9').value,0);assert.equal(data.getCell('B10').value,null);assert.equal(data.getCell('B11').value,'123456789012345678.90')
 assert.equal(data.views[0].ySplit,8);assert.equal(data.getCell('A8').value,'label')
 assert.ok(!JSON.stringify(loaded.model).includes('not-for-export'))
})
test('empty dashboard exports a readable summary without fake chart data',async()=>{
 const book=buildWorkbook({...snapshot,dashboard:{...snapshot.dashboard,charts:[]}});assert.equal(book.worksheets.length,1);assert.equal(book.worksheets[0].getCell('B6').value,0)
})
