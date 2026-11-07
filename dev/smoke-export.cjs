// Requires a running demo and a dedicated Chrome CDP session. See docs/DASHBOARD_EXPORT.md.
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const ExcelJS = require('../frontend/node_modules/exceljs');
const base = (process.env.POC_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const cdp = process.env.POC_CDP_URL || 'http://127.0.0.1:9226';
const out = path.resolve('.local', 'export-qa-' + Date.now()); fs.mkdirSync(out, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const login = await (await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Demo2026!'})})).json();
  const headers = { Authorization: 'Bearer '+login.token, 'Content-Type': 'application/json' };
  const api = async (url,method='GET',body) => {const r=await fetch(base+'/api'+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v};
  let conn,ws,viewer; const dashboards=[]; const files=[];
  try {
    conn=await api('/connections','POST',{name:'Export QA',host:'127.0.0.1',port:5433,database:'bi_poc_source',username:'bi_reader',password:'Reader2026!'});
    const dataset=await api('/datasets','POST',{connectionId:conn.id,name:'Dữ liệu xuất thử',kind:'VIRTUAL',sql:"SELECT * FROM (VALUES (DATE '2025-01-01','Bắc',10::numeric,2::numeric,'A',21::numeric,105::numeric),(DATE '2025-01-15','Bắc',20::numeric,3::numeric,'A',21.1::numeric,105.1::numeric),(DATE '2025-02-01','Nam',30::numeric,4::numeric,'B',10.8::numeric,106.7::numeric)) t(event_date,region,amount,quantity,category,latitude,longitude)"});
    const types=['bar','line','pie','donut','kpi','histogram','scatter','heatmap','map','stacked-bar','stacked-area'];const ids=[];
    for(const type of types){
      const spec={datasetId:dataset.id,name:type==='bar'||type==='pie'?'Doanh thu / [Bắc]':type+' Việt Nam',chartType:type,dimension:'region',metric:'amount',aggregate:'sum'};
      if(type==='line'||type==='stacked-area'){spec.dimension='event_date';spec.timeGrain='month'}
      if(type==='histogram'){spec.aggregate='count';spec.binCount=2;delete spec.dimension}
      if(type==='scatter')spec.dimension='quantity';
      if(type==='heatmap'){spec.numericColumns=['amount','quantity'];delete spec.dimension}
      if(type==='map'){spec.latitude='latitude';spec.longitude='longitude';spec.labelColumn='region';delete spec.dimension}
      if(type.startsWith('stacked-'))spec.seriesDimension='category';
      ids.push((await api('/charts','POST',spec)).id);
    }
    const dash=await api('/dashboards','POST',{name:'Dashboard xuất thử Việt Nam'});dashboards.push(dash.id);
    await api('/dashboards/'+dash.id+'/layout','PUT',{chartIds:ids});
    const pages=await(await fetch(cdp+'/json')).json();const page=pages.find(p=>p.type==='page');assert.ok(page,'Chrome page missing');
    ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
    let id=0;const pending=new Map(),downloads=new Map(),errors=[];
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.method==='Browser.downloadWillBegin')downloads.set(m.params.guid,{name:m.params.suggestedFilename,state:'started'});if(m.method==='Browser.downloadProgress'){const d=downloads.get(m.params.guid);if(d)d.state=m.params.state}if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
    const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
    const until=async expression=>{for(let i=0;i<300;i++){if(await ev(expression))return;await delay(100)}throw Error('Timed out: '+expression)};
    const native=`(el,v)=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))}`;
    const click=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled)`);await ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`)};
    await call('Runtime.enable');await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:out,eventsEnabled:true});await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
    const init = await call('Page.addScriptToEvaluateOnNewDocument',{source:"sessionStorage.removeItem('bi_poc_token')"});
    await call('Page.navigate',{url:base});await until(`location.origin===${JSON.stringify(base)} && document.readyState==='complete'`);
    await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:init.identifier});
    await ev(`sessionStorage.setItem('bi_poc_token',${JSON.stringify(login.token)});location.reload()`);await until(`!!document.querySelector('nav')`);
    const navigate=async()=>{await ev(`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Dashboards')).click()`);await until(`!!document.querySelector('.dashboard-toolbar select')`);await ev(`(${native})(document.querySelector('.dashboard-toolbar select'),${JSON.stringify(dash.id)})`);await until(`document.querySelector('.dashboard-header h2')?.textContent==='Dashboard xuất thử Việt Nam' && document.querySelectorAll('.dashboard-export-surface [data-chart-id]').length===11`)};
    await navigate();const panel="Array.from(document.querySelectorAll('section.surface')).find(s=>s.querySelector('h2')?.textContent==='Bộ lọc dashboard')";
    await click('Thêm điều kiện');
    const field=async(label,value)=>ev(`(()=>{const l=Array.from((${panel}).querySelectorAll('label')).find(l=>l.firstChild.textContent===${JSON.stringify(label)});(${native})(l.querySelector('input,select'),${JSON.stringify(value)})})()`);
    await field('Cột lọc','region');await field('Giá trị','Bắc');await click('Áp dụng bộ lọc');await until(`!(${panel}).querySelector('fieldset').disabled && document.querySelector('.dashboard-export-context').textContent.includes('Bắc')`);
    const expected=await api('/dashboards/'+dash.id+'/query','POST',{filters:[{datasetId:dataset.id,column:'region',op:'eq',value:'Bắc'}]});
    await field('Giá trị','Nam'); // Deliberately unapplied: exports must still show Bắc.
    await ev(`window.exportRequests=[];const original=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).startsWith('/api/'))window.exportRequests.push(String(args[0]));return original(...args)}`);
    const download=async(label,ext)=>{
      const count=downloads.size;await click(label);
      for(let i=0;i<600;i++){
        const complete=[...downloads.values()].slice(count).find(d=>d.state==='completed'&&d.name.endsWith(ext));
        if(complete){await until(`!document.querySelector('.dashboard-export-progress')`);const filename=path.join(out,complete.name);assert.ok(fs.statSync(filename).size>100);files.push(filename);return filename}
        const text=await ev(`document.querySelector('.dashboard-export-toolbar [role="status"]')?.textContent||''`);if(text.startsWith('Không'))throw Error(text);await delay(100);
      }throw Error('Download timeout for '+label)
    };
    const png=await download('Xuất PNG','.png');const bytes=fs.readFileSync(png);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.ok(bytes.readUInt32BE(16)>1000&&bytes.readUInt32BE(20)>1000);
    const pdf=await download('Xuất PDF','.pdf');const pdfBytes=fs.readFileSync(pdf);assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');assert.ok((pdfBytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=2,'Expected multi-page PDF');
    const xlsx=await download('Xuất Excel','.xlsx');const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(xlsx);assert.equal(workbook.worksheets.length,12);
    assert.ok(workbook.worksheets[0].getCell('B7').value.includes('Bắc'));assert.ok(!workbook.worksheets[0].getCell('B7').value.includes('Nam'));
    expected.charts.forEach((chart,i)=>{
      const sheet=workbook.worksheets[i+1];assert.equal(sheet.getCell('B1').value,chart.name);assert.equal(sheet.getCell('B5').value,chart.rows.length);
      const columns=[...new Set([...(chart.columns||[]),...chart.rows.flatMap(Object.keys)])];columns.forEach((col,j)=>assert.equal(sheet.getCell(8,j+1).value,col));
      chart.rows.forEach((row,r)=>columns.forEach((col,c)=>assert.deepEqual(sheet.getCell(9+r,c+1).value,row[col]??null,`${chart.chartType}: row ${r}, ${col}`)));
    });
    assert.deepEqual(await ev('window.exportRequests'),[],'Export re-queried backend data');
    await click('Chỉnh bố cục');assert.ok(await ev(`Array.from(document.querySelectorAll('.dashboard-export-toolbar button')).every(b=>b.disabled)`),'Export allowed unsaved geometry');await click('Hủy bố cục');
    await ev(`document.querySelector('.dashboard-export-surface').style.height='40000px'`);const count=downloads.size;await click('Xuất PNG');await until(`document.querySelector('.dashboard-export-toolbar [role="status"]')?.textContent.startsWith('Không') && !document.querySelector('.dashboard-export-progress')`);assert.equal(downloads.size,count,'Oversize export unexpectedly downloaded');await ev(`document.querySelector('.dashboard-export-surface').style.height=''`);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await ev(`document.documentElement.scrollWidth<=window.innerWidth+1`));const mobile=await download('Xuất PNG','.png');assert.ok(fs.readFileSync(mobile).readUInt32BE(16)<1000);
    // Empty filtered result must still export a valid workbook and readable image.
    await field('Giá trị','Không tồn tại');await click('Áp dụng bộ lọc');await until(`!(${panel}).querySelector('fieldset').disabled && document.querySelector('.dashboard-export-context').textContent.includes('Không tồn tại')`);
    const empty=await download('Xuất Excel','.xlsx');const emptyBook=new ExcelJS.Workbook();await emptyBook.xlsx.readFile(empty);assert.equal(emptyBook.worksheets.find(s=>s.getCell('B2').value==='kpi / sum').getCell('A9').value,null);
    viewer=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'viewer',password:'Demo2026!'})})).json();await ev(`sessionStorage.setItem('bi_poc_token',${JSON.stringify(viewer.token)});location.reload()`);await until(`!!document.querySelector('nav')`);await navigate();await download('Xuất Excel','.xlsx');assert.ok(!await ev(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Sửa biểu đồ')`));
    assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({files,png,pdf,xlsx,mobile},null,2));console.log('EXPORT BROWSER PASS: 11 chart types, actual PNG/PDF/XLSX downloads, every XLSX row reconciled, applied vs draft filters, no re-query, multi-page PDF, oversize error recovery, mobile, empty result, Viewer.');console.log('Artifacts: '+out);
  }finally{for(const id of dashboards)await api('/dashboards/'+id,'DELETE');if(conn)await api('/connections/'+conn.id,'DELETE');await api('/auth/logout','POST');if(viewer?.token)await fetch(base+'/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+viewer.token}});ws?.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
