'use strict';
const Core = globalThis.DicomDeIdCore;
const $ = id => document.getElementById(id);
const roles = {input:'原始 DICOM',images:'研究影像',records:'院內紀錄'};
const folderHints = {input:'選擇輸入資料夾',images:'選擇影像輸出資料夾',records:'選擇對照表資料夾'};
const dirs = {input:null,images:null,records:null};
const optionalTags = [
    ['00100030','出生日期','PatientBirthDate'],['00100040','性別','PatientSex'],
    ['00101010','年齡','PatientAge'],['00101040','地址','PatientAddress'],
    ['00102154','電話','PatientTelephoneNumbers'],['00080080','機構名稱','InstitutionName'],
    ['00080081','機構地址','InstitutionAddress'],['00080090','轉介醫師','ReferringPhysicianName'],
    ['00081010','工作站名稱','StationName'],['00081030','檢查描述','StudyDescription'],
    ['00081070','操作人員','OperatorsName']
];
let inputs=[], mode='', imported=null, csvName='', busy=false, matchCsvText='', failureCsvText='';
const tagBoxes=[];
function el(tag,text) {const node=document.createElement(tag);if(text!=null) node.textContent=text;return node;}
for (const [code,title,english] of optionalTags) {
    const label=el('label'); label.className='tag';
    const box=el('input'); box.type='checkbox';box.value='x'+code;
    label.append(box,' '+title,el('small',english+' ('+code.slice(0,4)+','+code.slice(4)+')'));
    $('tags').append(label);tagBoxes.push(box);
}
function currentTags(){return tagBoxes.filter(b=>b.checked).map(b=>b.value);}
function log(message){const list=$('log');list.prepend(el('li',new Date().toLocaleTimeString('zh-TW')+' '+message));if(list.children.length>150)list.lastChild.remove();}
function phase(title,n,total){$('progressPanel').hidden=false;$('phase').textContent=title;$('progress').max=total||1;$('progress').value=n;$('counter').textContent=total?n+' / '+total+' 檔':'';}
function nextStep() {
    if (!globalThis.dicomParser) return 'DICOM 解析器載入失敗，請確認 vendor 資料夾與網頁放在一起。';
    if (!window.showDirectoryPicker || !navigator.locks) return '請使用支援資料夾存取的桌面版 Chrome、Edge 或 Opera 開啟本頁。';
    if (!dirs.input) return '請選擇原始 DICOM 資料夾。';
    if (!inputs.length) return '輸入資料夾沒有可掃描的檔案，請重新選擇。';
    if (!dirs.images) return '請選擇研究影像輸出資料夾。';
    if (!dirs.records) return '請選擇院內紀錄資料夾。';
    if (!mode) return '請選擇本批處理模式。';
    if (mode==='csv' && !imported) return '請匯入有效的研究名單 CSV。';
    return '';
}
function dateRule(){
    if(mode!=='csv')return '全部檢查';
    if(!imported)return '待匯入 CSV';
    if(!imported.includesStudyDate)return '僅比對病歷號（兩欄 CSV）';
    return $('ignore').checked?'允許同一病人其他日期':'病歷號與指定日期均須相符';
}
function refresh() {
    for(const b of document.querySelectorAll('button,input')) b.disabled=busy;
    const needed=nextStep();
    $('next').textContent=busy?'作業進行中，請保持分頁開啟。':needed || '設定已備妥，可開始轉換。';
    $('start').disabled=busy || Boolean(needed);
    $('precheck').disabled=busy || !inputs.length || !imported || mode!=='csv' || !globalThis.dicomParser;
    $('csvPanel').hidden=mode!=='csv';
    $('ignoreLabel').hidden=!imported?.includesStudyDate;
    $('tagCount').textContent=currentTags().length+' 項';
    $('allTags').textContent=tagBoxes.every(b=>b.checked)?'全部取消':'全選';
    const parts=[['輸入',dirs.input?dirs.input.name+' · '+inputs.length+' 個待掃描檔案':'待選擇'],
        ['處理模式',mode==='auto'?'自動編號':mode==='csv'?'CSV 指定代號':'待選擇'],
        ['篩選條件',mode?dateRule():'待選擇'],['研究影像',dirs.images?.name || '待選擇'],
        ['院內紀錄',dirs.records?.name || '待選擇']];
    $('summary').replaceChildren(...parts.flatMap(([k,v])=>[el('dt',k),el('dd',v)]));
}
function invalidate(){$('results').hidden=true;$('progressPanel').hidden=true;refresh();}
function notice(text){$('resultTitle').textContent='作業未完成';$('stats').replaceChildren();const p=el('p',text);p.className='error';$('notes').replaceChildren(p);$('matches').hidden=true;$('failures').hidden=true;$('results').hidden=false;log(text);}
async function working(task) {
    if (busy) return;
    busy=true;refresh();
    try{await task();}catch(e){if(e.name!=='AbortError')notice(e.message || String(e));}
    finally{busy=false;refresh();}
}
for(const id of Object.keys(dirs)) $(id).onclick=()=>working(async()=>{
    const dir=await window.showDirectoryPicker({mode:id==='input'?'read':'readwrite'});
    const proposed={...dirs,[id]:dir};
    await Batch.independent(Object.fromEntries(Object.entries(proposed).map(([k,v])=>[roles[k],v])));
    if(id==='input') {
        phase('掃描輸入資料夾',0,0);
        inputs=(await Batch.collect(dir)).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    }
    dirs[id]=dir;$(id).querySelector('span').textContent=dir.name;invalidate();
});
for(const radio of document.querySelectorAll('[name=mode]')) radio.onchange=()=>{mode=radio.value;invalidate();};
$('ignore').onchange=invalidate;
$('tags').onchange=invalidate;
$('allTags').onclick=()=>{const checked=!tagBoxes.every(b=>b.checked);for(const box of tagBoxes)box.checked=checked;invalidate();};
function download(name,content) {
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
    const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('template').onclick=()=>download('PatientID_StudyDate_Mapping_Template.csv','\uFEFF'+Core.CSV_HEADERS.join(',')+'\r\n');
$('importCsv').onclick=()=>{$('csvFile').value='';$('csvFile').click();};
$('csvFile').onchange=()=>working(async()=>{
    const file=$('csvFile').files[0];if(!file)return;
    imported=null;csvName='';$('ignore').checked=false;invalidate();$('csvInfo').textContent='正在驗證名單';
    try {
        const parsed=Core.parseMappingCsv(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
        Batch.validateOwners([],parsed.mapping,parsed.includesStudyDate);
        imported=parsed;csvName=file.name;
        $('csvInfo').textContent=file.name+' · '+parsed.mapping.size+' 列有效對應'+(parsed.warnings.length?' · 已合併 '+parsed.warnings.length+' 列重複資料':'');
    }catch(e){$('csvInfo').textContent='CSV 匯入失敗';throw e;}
});
$('downloadFail').onclick=()=>download('Failure_Report.csv',failureCsvText);
$('downloadMatch').onclick=()=>download('Unmatched_Report.csv',matchCsvText);
function table(id,head,rows) {
    const t=el('table'), h=t.createTHead().insertRow();
    for(const v of head)h.append(el('th',v));
    const body=t.createTBody();
    for(const values of rows.slice(0,200)){const r=body.insertRow();for(const v of values)r.append(el('td',v));}
    const panel=$(id);panel.replaceChildren(t);
    if(rows.length>200)panel.append(el('p','顯示前 200 筆，下載 CSV 可查看全部。'));
}
function render(title,stats,notes,failed,report,preview) {
    $('resultTitle').textContent=title;$('stats').replaceChildren(...stats.map(([label,n])=>{
        const card=el('div');card.className='stat';card.append(el('strong',n),el('small',label));return card;
    }));
    $('notes').replaceChildren(...notes.map(([msg,type])=>{const p=el('p',msg);p.className=type||'';return p;}));
    $('failures').hidden=!failed.length;$('failures').open=Boolean(failed.length);
    $('failTitle').textContent='查看失敗 '+failed.length+' 檔';if(failed.length)table('failTable',['輸入檔案','分類','原因'],failed);
    $('matches').hidden=!report.length;$('matches').open=false;
    if(report.length)table('matchTable',['來源','病歷號','日期','原因'],report.map(r=>[r.source,r.patientId,r.studyDate,r.reason]));
    $('results').hidden=false;
    $('phase').textContent=preview?'預檢完成':title;
}
function errorReason(e){return e?.message || String(e);}
async function readInput(item,preview) {
    let file;
    try{file=await item.handle.getFile();}catch(e){throw Batch.fileError('讀取失敗',e);}
    if(preview){
        try{return {m:await Batch.probe(file)};}catch(e){throw Batch.fileError('無法解析',e);}
    }
    let bytes;
    try{bytes=new Uint8Array(await file.arrayBuffer());}catch(e){throw Batch.fileError('讀取失敗',e);}
    try{const data=dicomParser.parseDicom(bytes);return {bytes,data,m:Batch.metadata(data)};}
    catch(e){
        const part10=bytes.length>=132 && String.fromCharCode(...bytes.subarray(128,132))==='DICM';
        throw Batch.fileError(part10?'DICOM 解析失敗':'無法辨識 DICOM',e);
    }
}
async function execute(preview) {
    $('results').hidden=true;phase('檢查本批設定',0,0);
    const isCsv=mode==='csv', mapping=isCsv?imported.mapping:new Map();
    const dated=isCsv && imported.includesStudyDate;
    const allowOther=dated && $('ignore').checked;
    const match=Core.createCsvMatcher(mapping,dated);
    let state;
    if(dirs.images && dirs.records) {
        state=await Batch.prepare(dirs.images,dirs.records,mapping,dated,(n,total)=>phase('核對既有輸出影像',n,total));
        if(!preview)await Batch.pair(state);
    }
    const exact=new Set(), otherDates=new Map(), combos=new Map(), ambiguous=new Set(), failed=[], notes=[];
    const counts={written:0,exists:0,skipped:0,candidate:0};
    const tags=currentTags();
    const candidateUids=new Set();
    for(let i=0;i<inputs.length;i++){
        const item=inputs[i];
        try {
            const {bytes,data,m}=await readInput(item,preview);
            Batch.checkMeta(m);
            let alias,via,csvDates;
            const k=Core.createPatientStudyKey(m.origPatientID,m.origStudyDate);
            if(isCsv){
                const result=match(m.origPatientID,m.origStudyDate,allowOther);
                if(!combos.has(k))combos.set(k,{patientId:m.origPatientID,studyDate:m.origStudyDate,fileCount:0,matched:false});
                const combo=combos.get(k);combo.fileCount++;
                if(!result?.alias){if(result?.via==='ambiguous')ambiguous.add(k);counts.skipped++;continue;}
                alias=result.alias;via=result.via;csvDates=result.csvDates;combo.matched=true;
                if(via==='exact')result.csvKeys.forEach(id=>exact.add(id));
            }
            if(preview) {
                if(state?.objects.has(m.sop))counts.exists++;
                else if(!candidateUids.has(m.sop)){candidateUids.add(m.sop);counts.candidate++;}
            } else {
                const outcome=await Batch.convert(state,bytes,data,m,alias,tags);
                counts[outcome==='exists'?'exists':'written']++;
            }
            if(via==='id_only'){
                if(!otherDates.has(k))otherDates.set(k,{source:'DICOM',category:'date_ignored',patientId:m.origPatientID,
                    studyDate:m.origStudyDate,newPatientId:alias,fileCount:0,reason:'僅 ID 相符，'+(preview?'符合放寬日期條件':'已輸出或核對既有檔案')+'，代號 '+alias+'。CSV 指定日期：'+csvDates.join('、')});
                otherDates.get(k).fileCount++;
            }
        }catch(e){failed.push([item.path,e.kind||'DICOM 欄位或內容異常',errorReason(e)]);}
        finally{if(i%10===0 || i+1===inputs.length)phase(preview?'預檢名單與標頭':'核對及轉換影像',i+1,inputs.length);}
    }
    const report=isCsv?[...otherDates.values(),...Core.buildMismatchReport(mapping,dated,combos.values(),exact)]:[];
    for(const r of report)if(r.source==='DICOM' && ambiguous.has(Core.createPatientStudyKey(r.patientId,r.studyDate)))
        r.reason+='。此 ID 對應多個研究代號，無法只依 ID 輸出。';
    const reportHeader=['Source','Category','Original_PatientID','Original_StudyDate','New_PatientID','DICOM_File_Count','Reason'];
    matchCsvText=Batch.csv(reportHeader,report.map(r=>[r.source,r.category,r.patientId,r.studyDate,r.newPatientId||'',r.source==='DICOM'?r.fileCount:'',r.reason]));
    failureCsvText=Batch.csv(['Input_Relative_Path','Category','Reason'],failed);
    let reportErrors=0;
    if(!preview){
        const writes=[['Mapping.csv',()=>Batch.saveMapping(state)],['Failure_Report.csv',()=>Batch.save(dirs.records,'Failure_Report.csv',failureCsvText)]];
        writes.push(['Unmatched_Report.csv',()=>Batch.save(dirs.records,'Unmatched_Report.csv',matchCsvText)]);
        for(const [name,save] of writes)try{await save();}catch(e){reportErrors++;notes.push([name+' 儲存失敗：'+errorReason(e),'error']);}
        const emptyCount=[...state.emptySlots.values()].reduce((count,slots)=>count+slots.length,0);
        if(emptyCount){reportErrors++;notes.push(['影像目錄仍有 '+emptyCount+' 個先前中斷留下的空檔，請核對後再交付。','warn']);}
        notes.push(['影像位置：'+dirs.images.name+'。院內紀錄位置：'+dirs.records.name+'。']);
        const selected=optionalTags.filter(([code])=>tags.includes('x'+code)).map(([,title])=>title);
        notes.push(['本批寫出設定：改寫病歷號、檢查單號及原有姓名。額外清除的欄位（若存在）：'+(selected.join('、')||'無')+'。']);
        notes.push(['對外分享前仍須核查 Sequence、私有標籤與影像上燒錄的文字。','warn']);
    } else notes.push(['預檢依標頭與名單比對，實際寫入與內容驗證在轉換時進行。']);
    const stats=[];
    if(isCsv){
        stats.push([dated?'指定日期命中（CSV 列）':'病歷號命中（CSV 列）',exact.size+' / '+mapping.size]);
        if(dated)stats.push(['僅 ID 相符（病人＋日期組）',otherDates.size]);
        notes.push(['研究名單：'+csvName+'。'+(mapping.size>exact.size?'仍有 '+(mapping.size-exact.size)+' 列未完全命中。':'全部指定列均已命中。'),mapping.size>exact.size?'warn':'']);
    }
    stats.push([preview?'預計新增（檔）':'成功寫出（檔）',preview?counts.candidate:counts.written],
        [preview?'既有 UID（檔）':'既有內容相同（檔）',counts.exists],['名單略過（檔）',counts.skipped],['失敗（檔）',failed.length]);
    const title=preview?'名單預檢結果':failed.length||reportErrors?'轉換結束，請檢查失敗項目':'研究代號轉換完成';
    render(title,stats,notes,failed,report,preview);log(title+' · '+inputs.length+' 個輸入檔案');
}
$('precheck').onclick=()=>working(()=>execute(true));
$('start').onclick=()=>working(()=>navigator.locks.request('dicom-deid-export',{ifAvailable:true},lock=>{
    if(!lock)throw Error('另一個分頁正在轉換，請等該批完成再執行。');return execute(false);
}));
$('reset').onclick=()=>{
    if(busy)return;
    for(const id of Object.keys(dirs)){dirs[id]=null;$(id).querySelector('span').textContent=folderHints[id];}
    inputs=[];mode='';imported=null;csvName='';failureCsvText='';matchCsvText='';
    for(const b of document.querySelectorAll('input[type=radio],input[type=checkbox]'))b.checked=false;
    for(const d of document.querySelectorAll('details'))d.open=false;
    for(const id of ['log','stats','notes','failTable','matchTable'])$(id).replaceChildren();
    $('csvFile').value='';$('csvInfo').textContent='尚未匯入 CSV';invalidate();
};
refresh();
