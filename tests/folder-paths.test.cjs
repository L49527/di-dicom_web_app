const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');

const context=vm.createContext({DicomDeIdCore:{},Uint8Array});
const Batch=vm.runInContext(fsSync.readFileSync(path.join(__dirname,'../batch.js'),'utf8')+'\nBatch',context);

class Handle {
    constructor(p,kind){this.p=p;this.kind=kind;this.name=path.basename(p);}
    async isSameEntry(other){return this.p===other.p;}
    async resolve(other){const relative=path.relative(this.p,other.p);return relative.startsWith('..')?null:relative?relative.split(path.sep):[];}
    async *values(){for(const e of await fs.readdir(this.p,{withFileTypes:true}))yield new Handle(path.join(this.p,e.name),e.isDirectory()?'directory':'file');}
    async getDirectoryHandle(name,opts={}){
        const target=path.join(this.p,name);
        if(opts.create)await fs.mkdir(target,{recursive:true});
        else{try{await fs.access(target);}catch{throw Object.assign(Error(name),{name:'NotFoundError'});}}
        return new Handle(target,'directory');
    }
    async getFileHandle(name){
        const target=path.join(this.p,name);
        try{await fs.access(target);}catch{throw Object.assign(Error(name),{name:'NotFoundError'});}
        return new Handle(target,'file');
    }
}
async function sandbox(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dicom-overlap-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return new Handle(root,'directory');}

// Output overlap is allowed, but generated DICOM and mapping data must never be
// scanned as source input, including after the user chooses a different output.
test('input and output may be the same directory without re-reading exports',async t=>{
    const root=await sandbox(t);
    await fs.writeFile(path.join(root.p,'original.dcm'),'source');
    const images=await root.getDirectoryHandle('研究影像',{create:true});
    const records=await root.getDirectoryHandle('院內對照表_不可對外提供',{create:true});
    await fs.writeFile(path.join(images.p,'generated.dcm'),'generated');
    await fs.writeFile(path.join(records.p,'Mapping.csv'),'sensitive');
    await Batch.checkOutputRoot(root,root);
    assert.equal((await Batch.folderPlan(root,root)).kind,'same');
    assert.deepEqual(Array.from(await Batch.collectInput(root,root),x=>x.path),['original.dcm']);
});

test('output nested in input is excluded as an entire subtree',async t=>{
    const input=await sandbox(t);
    const child=await input.getDirectoryHandle('processed',{create:true});
    await fs.writeFile(path.join(input.p,'original.dcm'),'source');
    await fs.writeFile(path.join(child.p,'old-export.dcm'),'generated');
    assert.equal((await Batch.folderPlan(input,child)).kind,'output-inside-input');
    assert.deepEqual(Array.from(await Batch.collectInput(input,child),x=>x.path),['original.dcm']);
});

test('input may be a non-output child of destination; generated children remain protected',async t=>{
    const output=await sandbox(t);
    const input=await output.getDirectoryHandle('raw',{create:true});
    await fs.writeFile(path.join(input.p,'source.dcm'),'source');
    assert.equal((await Batch.folderPlan(input,output)).kind,'input-inside-output');
    await Batch.checkOutputRoot(output,input);
    const images=await output.getDirectoryHandle('研究影像',{create:true});
    const records=await output.getDirectoryHandle('院內對照表_不可對外提供',{create:true});
    await assert.rejects(Batch.folderPlan(images,output),/不能位於輸出的/);
    await assert.rejects(Batch.folderPlan(records,output),/不能位於輸出的/);
});

test('legacy mapping is never silently treated as source data',async t=>{
    const root=await sandbox(t);
    await fs.writeFile(path.join(root.p,'Mapping.csv'),'historical');
    await assert.rejects(Batch.checkOutputRoot(root,root),/舊版 Mapping.csv/);
});
