'use strict';
const Batch = (() => {
    const Core = globalThis.DicomDeIdCore;
    const fields = ['modality', 'origPatientID', 'origStudyDate', 'newPatientID', 'origAccessionNo', 'newAccessionNo'];
    const headers = ['Modality','Original_PatientID','Original_StudyDate','New_PatientID','Original_AccessionNo','New_AccessionNo'];
    const key = (...parts) => JSON.stringify(parts);
    const pathKey = row => key(row.newPatientID, row.newAccessionNo);
    const legacyKey = row => key(row.origPatientID, row.origStudyDate, row.origAccessionNo);
    const str = (data, tag) => String(data.string(tag) || '').replace(/\0/g, '').trim();
    const validUid = value => value.length <= 64 && /^[0-9]+(?:\.[0-9]+)+$/.test(value);
    function csv(head, rows) {
        const quote = v => '"' + String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"','""') + '"';
        return '\uFEFF' + [head, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
    }
    async function optionalFile(dir, name) {
        try { return await dir.getFileHandle(name); }
        catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
    }
    async function save(dir, name, content) {
        const previous = await optionalFile(dir, name);
        const file = previous || await dir.getFileHandle(name, {create:true});
        let stream;
        try {
            stream = await file.createWritable();
            await stream.write(content);
            await stream.close();
        } catch (e) {
            try {
                if (stream) await stream.abort();
                if (!previous && !(await file.getFile()).size) await dir.removeEntry(name);
            } catch {}
            throw e;
        }
    }
    async function independent(dirs) {
        const entries = Object.entries(dirs).filter(([,v]) => v);
        for (let i=0; i<entries.length; i++) {
            for (const [b, right] of entries.slice(i+1)) {
                const [a, left] = entries[i];
                if (await left.isSameEntry(right) || await left.resolve(right) !== null || await right.resolve(left) !== null)
                    throw Error(a+'與'+b+'資料夾相同或互相包含，請選擇獨立資料夾');
            }
        }
    }
    // The user picks only a root output folder. Keep PHI-bearing records in a
    // separate child directory without changing the existing batch validation.
    const IMAGE_SUBDIR='研究影像';
    const RECORD_SUBDIR='院內對照表_不可對外提供';
    async function checkOutputRoot(root) {
        // Old v4.1 exports stored mapping and images together at the root.
        // Never silently reuse or relocate such historical data.
        for (const name of ['Mapping.csv','StudyIndex.json','Unmatched_Report.csv','Failure_Report.csv','.dicom-batch-id']) {
            if(await optionalFile(root,name))throw Error('輸出主目錄已有舊版 '+name+'。請先備份，將研究影像與院內對照表整理至指定的兩個子資料夾後再選擇；程式不會自動搬移敏感資料。');
        }
        for await (const entry of root.values()) {
            if(entry.name.startsWith('.'))continue;
            if(entry.kind==='directory' && (entry.name===IMAGE_SUBDIR || entry.name===RECORD_SUBDIR))continue;
            throw Error('輸出主目錄有其他檔案或資料夾：'+entry.name+'。請選擇專用的空輸出目錄，或先備份並整理舊版輸出。');
        }
    }
    async function child(root,name,create){
        try{return await root.getDirectoryHandle(name,{create});}
        catch(e){if(!create && e.name==='NotFoundError')return null;throw e;}
    }
    async function outputLayout(root,create=false){
        await checkOutputRoot(root);
        const images=await child(root,IMAGE_SUBDIR,false);
        const records=await child(root,RECORD_SUBDIR,false);
        if(!create && !images && !records)return null;
        if(images && !records && (await collect(images)).length)
            throw Error('已有研究影像，但缺少「院內對照表_不可對外提供」。請先復原同一批的對照資料，不可重新編號。');
        if(!create && (!images || !records))return null;
        return {images:images||await child(root,IMAGE_SUBDIR,true),records:records||await child(root,RECORD_SUBDIR,true)};
    }
    async function collect(dir, prefix='', out=[]) {
        for await (const entry of dir.values()) {
            if (entry.name.startsWith('.') || entry.name === 'DICOMDIR') continue;
            const path = prefix + entry.name;
            if (entry.kind === 'directory') await collect(entry, path+'/', out);
            else out.push({handle:entry,path});
        }
        return out;
    }
    function metadata(data) {
        return {origPatientID:str(data,'x00100020'), origAccessionNo:str(data,'x00080050'),
            origStudyDate:str(data,'x00080020'), study:str(data,'x0020000d'), sop:str(data,'x00080018'),
            modality:str(data,'x00080060') || 'IMG', syntax:str(data,'x00020010')};
    }
    function checkMeta(m) {
        if (!m.origPatientID) throw Error('缺少 Patient ID');
        if (!m.origAccessionNo) throw Error('缺少 Accession Number');
        if (!validUid(m.study)) throw Error('Study Instance UID 缺漏或格式無效');
        if (!validUid(m.sop)) throw Error('SOP Instance UID 缺漏或格式無效');
        Core.getTransferSyntaxInfo(m.syntax);
    }
    async function probe(file) {
        const size = 256*1024;
        if (file.size > size) {
            try {
                const data = dicomParser.parseDicom(new Uint8Array(await file.slice(0,size).arrayBuffer()), {untilTag:'x0020000e'});
                const m = metadata(data);
                if (m.study && m.origPatientID) return m;
            } catch {}
        }
        return metadata(dicomParser.parseDicom(new Uint8Array(await file.arrayBuffer())));
    }
    function validateOwners(rows, imported, dated) {
        const owners = new Map();
        function add(alias, id) {
            if (!Core.SAFE_ALIAS_PATTERN.test(alias) || /[.]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(alias))
                throw Error('代號無法作為跨平台資料夾名稱：'+alias);
            const normalized = alias.toLowerCase();
            const old = owners.get(normalized);
            if (old && (old.id !== id || old.alias !== alias))
                throw Error('代號衝突：'+alias+'（'+old.id+'／'+id+'）。請修正對照表後再執行。');
            owners.set(normalized, {id,alias});
        }
        for (const row of rows) add(row.newPatientID, row.origPatientID);
        for (const [k,alias] of imported) add(alias, dated ? k.split('\u001f')[0] : k);
        return owners;
    }
    const marker = '.dicom-batch-id';
    async function readMarker(dir) {
        const f = await optionalFile(dir, marker);
        if (!f) return '';
        const id = (await (await f.getFile()).text()).trim();
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('批次配對檔損壞：'+dir.name);
        return id;
    }
    async function prepare(images, records, imported, dated, onScan=()=>{}) {
        for (const name of ['Mapping.csv','Unmatched_Report.csv','Failure_Report.csv','StudyIndex.json']) {
            if (await optionalFile(images,name)) throw Error('研究影像資料夾含 '+name+'。請將舊版的院內紀錄移到對應的院內資料夾，再重新執行。');
        }
        const imageMarker=await readMarker(images), recordMarker=await readMarker(records);
        if (imageMarker && recordMarker && imageMarker!==recordMarker) throw Error('研究影像與院內紀錄屬於不同批次');
        const mappingFile=await optionalFile(records,'Mapping.csv');
        const prior=mappingFile ? Core.parseExistingMapping(await (await mappingFile.getFile()).text()) : [];
        const indexFile=await optionalFile(records,'StudyIndex.json');
        const reserved=indexFile ? JSON.parse(await (await indexFile.getFile()).text()) : [];
        if (!Array.isArray(reserved)) throw Error('StudyIndex.json 格式錯誤');
        if (imageMarker && !recordMarker && (prior.length || reserved.length)) throw Error('院內紀錄無法與已配對的影像資料夾核對');
        const rows=[...prior,...reserved];
        validateOwners(rows,imported,dated);
        const byPath = new Map(), studies = new Map(), aliases=new Map();
        const legacy = new Map(), objects=new Map(), lastNumber=new Map(), successful = new Map();
        for (const row of rows) {
            if (!row.origPatientID || !row.origAccessionNo || !/^[0-9]+$/.test(row.newAccessionNo)) throw Error('既有對照資料含無效欄位');
            aliases.set(row.origPatientID, aliases.get(row.origPatientID) || row.newPatientID);
            const p=pathKey(row);
            if (!byPath.has(p)) byPath.set(p,[]);
            byPath.get(p).push(row);
            if (row.study) {
                if (!validUid(row.study) || studies.has(row.study)) throw Error('院內索引包含重複或無效的 Study UID');
                studies.set(row.study,row);
            } else legacy.set(legacyKey(row),row);
        }
        for (const r of prior) successful.set(key(...fields.map(f=>r[f])),r);
        const emptySlots=new Map();
        const existing=await collect(images);
        if (existing.length && recordMarker && !imageMarker) throw Error('此影像資料夾已有檔案，但與院內紀錄沒有配對');
        let scanned=0;
        for (const {handle,path} of existing) {
            const parts=path.split('/');
            const bucket=key(parts[0],parts[1]);
            if (parts.length!==3 || !byPath.has(bucket) || !/_\d+\.dcm$/i.test(parts[2])) throw Error('輸出資料夾有無法對應的檔案：'+path+'。請核對院內紀錄或選擇空資料夾。');
            const num=Number(parts[2].match(/_(\d+)\.dcm$/i)[1]);
            lastNumber.set(bucket,Math.max(lastNumber.get(bucket)||0,num));
            const file=await handle.getFile();
            if (!file.size) {
                const slotKey=key(bucket,parts[2].replace(/_\d+\.dcm$/i,''));
                if (!emptySlots.has(slotKey)) emptySlots.set(slotKey,[]);
                emptySlots.get(slotKey).push(parts[2]);
                continue;
            }
            const m=await probe(file);
            const candidates=byPath.get(bucket);
            const owner=candidates.find(r=>r.study===m.study) || candidates.find(r=>!r.study && r.origStudyDate===m.origStudyDate);
            if (!owner || !validUid(m.sop) || !validUid(m.study) || m.origPatientID!==parts[0] || m.origAccessionNo!==parts[1])
                throw Error('輸出影像與對照資料不一致：'+path);
            const previous=studies.get(m.study);
            if (previous && (pathKey(previous)!==bucket || previous.origPatientID!==owner.origPatientID)) throw Error('既有 Study UID 指向不同病人或目錄：'+path);
            studies.set(m.study,{...owner,study:m.study});
            if (objects.has(m.sop)) throw Error('輸出中有重複的 SOP Instance UID：'+path);
            objects.set(m.sop,{handle,study:m.study,bucket});
            successful.set(key(...fields.map(f=>owner[f])),owner);
            onScan(++scanned,existing.length);
        }
        return {images,records,prior,reserved,studies,aliases,legacy,objects,lastNumber,successful,
            emptySlots,imageMarker,recordMarker,nextPatient:Core.nextSequenceNumber(rows.map(r=>r.newPatientID)),
            nextAcc:Core.nextSequenceNumber(rows.map(r=>r.newAccessionNo))};
    }
    async function pair(state) {
        const id=state.imageMarker || state.recordMarker || crypto.randomUUID();
        if (!state.recordMarker) await save(state.records,marker,id);
        if (!state.imageMarker) await save(state.images,marker,id);
    }
    function choose(state,m,alias) {
        const old=state.studies.get(m.study);
        if (old && (old.origPatientID!==m.origPatientID || old.origAccessionNo!==m.origAccessionNo ||
            old.origStudyDate!==m.origStudyDate || (alias && old.newPatientID!==alias)))
            throw Error('同一 Study UID 的病人、日期、檢查單號或研究代號與既有資料衝突');
        if (old) return old;
        const historical=state.legacy.get(legacyKey(m));
        const claimed=historical && [...state.studies.values()].some(r=>pathKey(r)===pathKey(historical));
        if (historical && !claimed && alias && historical.newPatientID!==alias) throw Error('舊版對照表的研究代號與本批不同');
        const newPatientID=alias || historical?.newPatientID || state.aliases.get(m.origPatientID) || String(state.nextPatient++);
        const newAccessionNo=historical && !claimed ? historical.newAccessionNo : String(state.nextAcc++);
        return {study:m.study,origPatientID:m.origPatientID,origStudyDate:m.origStudyDate,origAccessionNo:m.origAccessionNo,
            modality:m.modality,newPatientID,newAccessionNo};
    }
    function rewrite(bytes,data,m,row,tags) {
        const changes={x00100020:row.newPatientID,x00080050:row.newAccessionNo};
        if (data.elements.x00100010) changes.x00100010=row.newPatientID;
        const out=Core.rewriteDicomStrings(bytes,data,changes,m.syntax,tags);
        const check=dicomParser.parseDicom(out);
        for (const [tag,v] of Object.entries(changes)) if(str(check,tag)!==v) throw Error('改寫欄位驗證失敗：'+tag);
        for(const tag of tags) if(check.elements[tag] && str(check,tag)) throw Error('清除欄位驗證失敗：'+tag);
        if(str(check,'x00080018')!==m.sop || str(check,'x0020000d')!==m.study) throw Error('UID 驗證失敗');
        return out;
    }
    const fileError = (kind,e) => Object.assign(new Error(e.message || String(e)),{kind});
    async function convert(state,bytes,data,m,alias,tags) {
        const row=choose(state,m,alias), bucket=pathKey(row);
        const out=rewrite(bytes,data,m,row,tags), found=state.objects.get(m.sop);
        if (found) {
            if (found.study!==m.study || found.bucket!==bucket) throw Error('SOP UID 對應到其他檢查');
            const oldFile=await found.handle.getFile();
            if (oldFile.size!==out.length) throw Error('相同 SOP UID 的內容或清除設定不同，請核對或使用新輸出批次');
            const old=new Uint8Array(await oldFile.arrayBuffer());
            if (!out.every((v,i)=>old[i]===v)) throw Error('相同 SOP UID 的內容或清除設定不同，請核對或使用新輸出批次');
            return 'exists';
        }
        try {
            if (!state.studies.has(m.study)) {
                const extended=[...state.reserved,row];
                await save(state.records,'StudyIndex.json',JSON.stringify(extended));
                state.reserved=extended;
                state.studies.set(m.study,row);
                if (!state.aliases.has(m.origPatientID)) state.aliases.set(m.origPatientID,row.newPatientID);
            }
            const patientDir=await state.images.getDirectoryHandle(row.newPatientID,{create:true});
            const dir=await patientDir.getDirectoryHandle(row.newAccessionNo,{create:true});
            let n=state.lastNumber.get(bucket)||0, name;
            const prefix=m.modality.replace(/[^A-Za-z0-9_-]/g,'') || 'IMG';
            const slots=state.emptySlots.get(key(bucket,prefix));
            if (slots?.length) {
                name=slots.pop();
                const existing=await optionalFile(dir,name);
                if (existing && (await existing.getFile()).size) throw Error('原本空白的檔案已有內容，請重新核對');
            } else {
                do { name=prefix+'_'+String(++n).padStart(6,'0')+'.dcm'; } while(await optionalFile(dir,name));
            }
            state.lastNumber.set(bucket,n);
            try {
                await save(dir,name,out);
            } catch(e) {
                const file=await optionalFile(dir,name);
                if (file && !(await file.getFile()).size) await dir.removeEntry(name);
                throw e;
            }
            state.objects.set(m.sop,{study:m.study,bucket,handle:await dir.getFileHandle(name)});
            state.successful.set(key(...fields.map(f=>row[f])),row);
            return 'written';
        } catch(e) {throw fileError('寫入失敗',e);}
    }
    async function saveMapping(state) {
        const rows=[...state.successful.values()].map(r=>fields.map(f=>r[f]));
        await save(state.records,'Mapping.csv',csv(headers,rows));
    }
    return {collect,independent,checkOutputRoot,outputLayout,prepare,pair,convert,saveMapping,checkMeta,metadata,probe,save,csv,fileError,validateOwners};
})();
