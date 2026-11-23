const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const Core=require('../core'), parser=require('../vendor/dicomParser.min.js');
const context=vm.createContext({DicomDeIdCore:Core,dicomParser:parser,Uint8Array,crypto:require('node:crypto').webcrypto});
const Batch=vm.runInContext(require('node:fs').readFileSync(path.join(__dirname,'../batch.js'),'utf8')+'\nBatch',context);
class Handle {
    constructor(p,kind,control){this.p=p;this.name=path.basename(p);this.kind=kind;this.control=control;}
    async isSameEntry(h){return this.p===h.p;}
    async resolve(h){const rel=path.relative(this.p,h.p);return rel.startsWith('..')?null:rel.split(path.sep);}
    async *values(){for(const d of await fs.readdir(this.p,{withFileTypes:true}))yield new Handle(path.join(this.p,d.name),d.isFile()?'file':'directory',this.control);}
    async getFileHandle(name,opts={}){
        const p=path.join(this.p,name);
        if(opts.create){const f=await fs.open(p,'a');await f.close();}
        try{await fs.access(p);}catch{throw Object.assign(Error(name),{name:'NotFoundError'});}
        return new Handle(p,'file',this.control);
    }
    async getDirectoryHandle(name,opts={}){
        const p=path.join(this.p,name);
        if(opts.create)await fs.mkdir(p,{recursive:true});
        else{try{if(!(await fs.stat(p)).isDirectory())throw Error('Not a directory');}catch{throw Object.assign(Error(name),{name:'NotFoundError'});}}
        return new Handle(p,'directory',this.control);
    }
    async removeEntry(name){await fs.unlink(path.join(this.p,name));}
    async getFile(){return new Blob([await fs.readFile(this.p)]);}
    async createWritable(){let bytes;return {
        write:async v=>{if(this.name===this.control.fail)throw Error('simulated disk full');bytes=v;},
        close:()=>fs.writeFile(this.p,bytes),abort:async()=>{}
    };}
}
async function setup(t) {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'didicom-v42-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const h=new Handle(root,'directory',{});
    const images=await h.getDirectoryHandle('images',{create:true}),records=await h.getDirectoryHandle('records',{create:true});
    const open=(list=new Map(),dated=false)=>Batch.prepare(images,records,list,dated);
    return {root,h,images,records,open};
}
const EX='1.2.840.10008.1.2.1', IM='1.2.840.10008.1.2', BE='1.2.840.10008.1.2.2';
function element(tag,vr,value,syntax) {
    const long=vr==='OB',implicit=syntax===IM,be=syntax===BE;
    const b=Buffer.isBuffer(value)?value:Buffer.from(value);
    const val=b.length%2?Buffer.concat([b,Buffer.from([vr==='UI'?0:32])]):b;
    const head=Buffer.alloc(implicit?8:long?12:8);
    const short=(v,p)=>be?head.writeUInt16BE(v,p):head.writeUInt16LE(v,p);
    const wide=(v,p)=>be?head.writeUInt32BE(v,p):head.writeUInt32LE(v,p);
    short(parseInt(tag.slice(0,4),16),0);short(parseInt(tag.slice(4),16),2);
    if(implicit)wide(val.length,4);
    else{head.write(vr,4);if(long)wide(val.length,8);else short(val.length,6);}
    return Buffer.concat([head,val]);
}
function fixture(sop='1.2.3.1',{study='1.2.3',patient='P01',date='20260101',series=study+'.10',syntax=EX,pixel=42}={}) {
    const tags=[['00080016','UI','1.2.840.10008.5.1.4.1.1.2'],['00080018','UI',sop],['00080020','DA',date],['00080050','SH','ACC1'],['00080060','CS','CT'],['00100010','PN','Test^Person'],['00100020','LO',patient],['00100030','DA','20000101'],['0020000d','UI',study],['0020000e','UI',series],['7fe00010','OB',Buffer.from([pixel,7,8,9])]];
    return new Uint8Array(Buffer.concat([Buffer.alloc(128),Buffer.from('DICM'),element('00020010','UI',syntax,EX),...tags.map(t=>element(...t,syntax))]));
}
async function convert(state,bytes,alias='CASE01',tags=[]){
    const ds=parser.parseDicom(bytes),m=Batch.metadata(ds);Batch.checkMeta(m);
    return Batch.convert(state,bytes,ds,m,alias,tags);
}
for(const syntax of [EX,IM,BE])test('改寫、像素保留及重跑 '+syntax,async t=>{
    const {open,images}=await setup(t),state=await open();await Batch.pair(state);
    const bytes=fixture(undefined,{syntax});assert.equal(await convert(state,bytes,'CASE-A0001',['x00100030']),'written');
    const files=await Batch.collect(images);assert.equal(files.length,1);
    const data=parser.parseDicom(new Uint8Array(await (await files[0].handle.getFile()).arrayBuffer()));
    assert.equal(data.string('x00100020'),'CASE-A0001');assert.equal(data.string('x00100010'),'CASE-A0001');
    assert.equal((data.string('x00100030')||'').trim(),'');const px=data.elements.x7fe00010;
    assert.deepEqual([...data.byteArray.slice(px.dataOffset,px.dataOffset+4)],[42,7,8,9]);
    await Batch.saveMapping(state);assert.equal(await convert(await open(),bytes,'CASE-A0001',['x00100030']),'exists');
});
test('部分失敗、中斷、補件、補新 series 與手動刪檔',async t=>{
    const {open,images,records}=await setup(t);let s=await open();await Batch.pair(s);
    const a=fixture(),b=fixture('1.2.3.2'),c=fixture('1.2.3.3',{series:'1.2.3.20'});
    await convert(s,a);images.control.fail='CT_000002.dcm';await assert.rejects(convert(s,b),/disk full/);images.control.fail=null;
    s=await open();assert.equal(await convert(s,a),'exists');assert.equal(await convert(s,b),'written');
    assert.equal(await convert(s,c),'written');await Batch.saveMapping(s);
    let files=await Batch.collect(images);assert.equal(files.length,3);
    await fs.unlink(files[0].handle.p);s=await open();assert.equal(await convert(s,a),'written');
    assert.equal((await Batch.collect(images)).length,3);assert.equal((await Batch.collect(records)).some(f=>f.path==='Mapping.csv'),true);
});
test('跨批代號衝突在寫入前發現（含大小寫）',async t=>{
    const {open,images}=await setup(t),s=await open();await Batch.pair(s);await convert(s,fixture());await Batch.saveMapping(s);
    for(const alias of ['CASE01','case01'])await assert.rejects(open(new Map([['P02',alias]])),/代號衝突/);
    assert.equal((await Batch.collect(images)).length,1);
});
test('日期例外保留兩個未命中的指定日期',()=>{
    const parsed=Core.parseMappingCsv('Original_PatientID,Original_StudyDate,New_PatientID\nP01,20250101,A01\nP01,20260101,A01');
    const match=Core.createCsvMatcher(parsed.mapping,true)('P01','20261123',true);
    assert.equal(match.via,'id_only');assert.equal(match.csvKeys.length,0);
    const report=Core.buildMismatchReport(parsed.mapping,true,[{patientId:'P01',studyDate:'20261123',fileCount:1,matched:true}],match.csvKeys);
    assert.equal(report.filter(r=>r.source==='CSV'&&r.category==='date_mismatch').length,2);
});
test('同一檢查單號下不同 Study 分開，衝突 SOP 保護既有輸出',async t=>{
    const {open,images}=await setup(t),s=await open();await Batch.pair(s);await convert(s,fixture());
    await convert(s,fixture('1.2.4.1',{study:'1.2.4'}));
    await assert.rejects(convert(s,fixture(undefined,{pixel:99})),/內容或清除設定不同/);
    assert.deepEqual(Array.from(await Batch.collect(images),x=>x.path).sort(),['CASE01/1/CT_000001.dcm','CASE01/2/CT_000001.dcm']);
});
test('資料夾重疊與錯誤配對',async t=>{
    const {h,images,records,open}=await setup(t);
    await assert.rejects(Batch.independent({a:h,b:images}),/互相包含/);
    await assert.rejects(Batch.independent({a:records,b:records}),/相同/);
    const s=await open();await Batch.pair(s);await fs.writeFile(path.join(records.p,'.dicom-batch-id'),require('node:crypto').randomUUID());
    await assert.rejects(open(),/不同批次/);
});
test('舊版只靠影像辨識已完成 SOP，後補沿用原對照',async t=>{
    const {open,images,records}=await setup(t);const s=await open();await convert(s,fixture());
    await Batch.saveMapping(s);await fs.unlink(path.join(records.p,'StudyIndex.json'));
    const map=await fs.readFile(path.join(records.p,'Mapping.csv'));await fs.writeFile(path.join(images.p,'Mapping.csv'),map);
    await assert.rejects(open(),/舊版/);await fs.unlink(path.join(images.p,'Mapping.csv'));
    const resumed=await open();await Batch.pair(resumed);
    assert.equal(await convert(resumed,fixture()),'exists');assert.equal(await convert(resumed,fixture('1.2.3.2')),'written');
});
test('頁面操作：預檢、例外日期、寫入失敗、分流報表與重設',async t=>{
    const {h}=await setup(t),input=await h.getDirectoryHandle('input',{create:true}),output=await h.getDirectoryHandle('output',{create:true});
    const images=await output.getDirectoryHandle('研究影像',{create:true}),records=await output.getDirectoryHandle('院內對照表_不可對外提供',{create:true});
    await fs.writeFile(path.join(input.p,'scan.dcm'),fixture(undefined,{date:'20261123'}));
    const html=await fs.readFile(path.join(__dirname,'../index.html'),'utf8');
    class Node {
        constructor(tag){this.tag=tag;this.children=[];this.disabled=false;this.checked=false;this.textContent='';}
        append(...nodes){this.children.push(...nodes);}
        prepend(node){this.children.unshift(node);}
        replaceChildren(...nodes){this.children=nodes;}
        querySelector(){return this.span || (this.span=new Node('span'));}
        createTHead(){return this;} createTBody(){return this;} insertRow(){const r=new Node('tr');this.append(r);return r;}
    }
    const ids=new Map([...html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"/g)].map(([,tag,id])=>[id,new Node(tag)]));
    const radios=['auto','csv'].map(value=>Object.assign(new Node('input'),{value,type:'radio'}));
    const nodes=[...ids.values(),...radios];
    const document={getElementById:k=>ids.get(k),createElement:tag=>{const n=new Node(tag);nodes.push(n);return n;},
        querySelectorAll:q=>q==='[name=mode]'?radios:nodes.filter(n=>q==='button,input'?['button','input'].includes(n.tag):
            q==='details'?n.tag==='details':['radio','checkbox'].includes(n.type)||n===ids.get('ignore'))};
    const picker=[input,output],ui=vm.createContext({document,window:{showDirectoryPicker:async()=>picker.shift()},
        navigator:{locks:{request:(_id,_opts,fn)=>fn({})}},DicomDeIdCore:Core,dicomParser:parser,Batch,Uint8Array,TextDecoder});
    vm.runInContext(await fs.readFile(path.join(__dirname,'../app.js'),'utf8'),ui);
    const get=k=>ids.get(k);const click=id=>get(id).onclick();
    for(const k of ['input','output'])await click(k);
    radios[1].onchange();
    get('csvFile').files=[Object.assign(new Blob(['Original_PatientID,Original_StudyDate,New_PatientID\nP01,20250101,A01\nP01,20260101,A01']),{name:'cohort.csv'})];
    await get('csvFile').onchange();get('ignore').checked=true;get('ignore').onchange();await click('allTags');
    await click('precheck');
    assert.equal(get('resultTitle').textContent,'名單預檢結果');
    assert.equal(get('stats').children[0].children[0].textContent,'0 / 2');
    assert.equal(get('stats').children[1].children[0].textContent,1);
    assert.equal((await fs.readdir(records.p)).length,0);
    images.control.fail='CT_000001.dcm';await click('start');assert.equal(get('failTitle').textContent,'查看失敗 1 檔');
    assert.match(await fs.readFile(path.join(records.p,'Failure_Report.csv'),'utf8'),/scan.dcm.*寫入失敗/);
    images.control.fail=null;await click('start');assert.equal(get('resultTitle').textContent,'研究代號轉換完成');
    assert.equal((await Batch.collect(images)).length,1);
    assert.match(await fs.readFile(path.join(records.p,'Unmatched_Report.csv'),'utf8'),/date_ignored/);
    click('reset');assert.equal(get('ignore').checked,false);assert.equal(get('tagCount').textContent,'0 項');
    assert.equal(get('start').disabled,true);assert.equal(get('results').hidden,true);
});

test('雙資料夾模式：預檢不建立目錄，執行時自動分流並安全續跑',async t=>{
    const {h}=await setup(t);
    const output=await h.getDirectoryHandle('new-output',{create:true});
    assert.equal(await Batch.outputLayout(output,false),null);
    assert.deepEqual(await fs.readdir(output.p),[]);
    const {images,records}=await Batch.outputLayout(output,true);
    assert.deepEqual((await fs.readdir(output.p)).sort(),['研究影像','院內對照表_不可對外提供'].sort());
    let state=await Batch.prepare(images,records,new Map(),false);
    await Batch.pair(state);
    const data=fixture();
    assert.equal(await convert(state,data),'written');
    await Batch.saveMapping(state);
    state=await Batch.prepare(images,records,new Map(),false);
    assert.equal(await convert(state,data),'exists');
    assert.equal((await Batch.collect(images)).length,1);
    assert.equal((await Batch.collect(records)).some(x=>x.path==='Mapping.csv'),true);
});

test('輸出主目錄含舊版對照表時拒絕默默搬移',async t=>{
    const {h}=await setup(t);const output=await h.getDirectoryHandle('old-export',{create:true});
    await fs.writeFile(path.join(output.p,'Mapping.csv'),'Original_PatientID,New_PatientID');
    await assert.rejects(Batch.outputLayout(output,true),/舊版 Mapping.csv/);
    assert.deepEqual(await fs.readdir(output.p),['Mapping.csv']);
});

test('研究影像存在但對照資料遺失時禁止重新編號',async t=>{
    const {h}=await setup(t);const output=await h.getDirectoryHandle('partial',{create:true});
    const images=await output.getDirectoryHandle('研究影像',{create:true});
    await fs.writeFile(path.join(images.p,'CT_000001.dcm'),fixture());
    await assert.rejects(Batch.outputLayout(output,true),/缺少「院內對照表/);
    assert.equal((await fs.readdir(output.p)).includes('院內對照表_不可對外提供'),false);
});
