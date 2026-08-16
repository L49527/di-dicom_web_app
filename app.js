'use strict';

const Core = window.DicomDeIdCore;
if (!Core) throw new Error('DicomDeIdCore failed to load.');

let inputHandle = null;
let outputHandle = null;
let dicomFilesList = [];
let isProcessing = false;
let processingMode = null;
let importedPatientMapping = new Map();
let importedCsvWarnings = [];
let importedCsvName = '';
let importedCsvIncludesStudyDate = false;
let patientMapping = new Map();
let accessionMapping = new Map();
let mappingLog = [];

const btnInput = document.getElementById('btnInput');
const btnOutput = document.getElementById('btnOutput');
const labelInput = document.getElementById('labelInput');
const labelOutput = document.getElementById('labelOutput');
const startBtn = document.getElementById('startBtn');
const queueCount = document.getElementById('queueCount');
const terminal = document.getElementById('terminal');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressPercentage = document.getElementById('progressPercentage');
const progressStatus = document.getElementById('progressStatus');
const fsaStatus = document.getElementById('fsaStatus');
const csvModePanel = document.getElementById('csvModePanel');
const btnMappingCsv = document.getElementById('btnMappingCsv');
const mappingCsvInput = document.getElementById('mappingCsvInput');
const mappingCsvStatus = document.getElementById('mappingCsvStatus');
const downloadCsvTemplate = document.getElementById('downloadCsvTemplate');
const modeRadios = Array.from(document.querySelectorAll('input[name="processingMode"]'));

const supportsFSA = 'showDirectoryPicker' in window;
if (!supportsFSA) {
    document.getElementById('browserWarning').classList.remove('hidden');
    fsaStatus.textContent = 'NO';
    fsaStatus.className = 'font-bold text-rose-500';
    btnInput.disabled = true;
    btnOutput.disabled = true;
}

// ------------------------------------------
// 1. Tag Configuration Panel
// ------------------------------------------
const OPTIONAL_TAGS = [
    { tag: 'x00100030', name: 'PatientBirthDate (0010,0030)' },
    { tag: 'x00100040', name: 'PatientSex (0010,0040)' },
    { tag: 'x00101010', name: 'PatientAge (0010,1010)' },
    { tag: 'x00101040', name: 'PatientAddress (0010,1040)' },
    { tag: 'x00102154', name: 'PatientTelephoneNumbers (0010,2154)' },
    { tag: 'x00080080', name: 'InstitutionName (0008,0080)' },
    { tag: 'x00080081', name: 'InstitutionAddress (0008,0081)' },
    { tag: 'x00080090', name: 'ReferringPhysicianName (0008,0090)' },
    { tag: 'x00081010', name: 'StationName (0008,1010)' },
    { tag: 'x00081030', name: 'StudyDescription (0008,1030)' },
    { tag: 'x00081070', name: 'OperatorsName (0008,1070)' }
];

const tagsForm = document.getElementById('optionalTagsForm');
OPTIONAL_TAGS.forEach(item => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-3 p-2 hover:bg-white rounded-lg transition-colors';
    div.innerHTML = `
        <label class="relative flex items-center cursor-pointer">
            <input type="checkbox" value="${item.tag}" class="tag-checkbox peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-300 checked:border-primary checked:bg-primary transition-all">
            <span class="absolute text-white opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
            </span>
        </label>
        <span class="text-sm text-slate-700 select-none">${item.name}</span>
    `;
    tagsForm.appendChild(div);
});

let allTagsChecked = false;
document.getElementById('toggleAllTags').addEventListener('click', () => {
    allTagsChecked = !allTagsChecked;
    document.querySelectorAll('.tag-checkbox').forEach(checkbox => {
        checkbox.checked = allTagsChecked;
    });
});

function getSelectedTags() {
    return Array.from(document.querySelectorAll('.tag-checkbox:checked')).map(checkbox => checkbox.value);
}

// ------------------------------------------
// 2. UI Helpers and Mode Selection
// ------------------------------------------
function logToTerminal(message, type = 'info') {
    const div = document.createElement('div');
    const timeSpan = document.createElement('span');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });

    let colorClass = 'text-slate-500';
    if (type === 'success') colorClass = 'text-emerald-600 font-medium';
    if (type === 'warning') colorClass = 'text-amber-600 font-medium';
    if (type === 'error') colorClass = 'text-rose-600 font-medium';
    if (type === 'system') colorClass = 'text-primary/80 font-medium tracking-wide';

    div.className = colorClass;
    timeSpan.className = 'opacity-40 font-semibold';
    timeSpan.textContent = `[${time}]`;
    div.appendChild(timeSpan);
    div.appendChild(document.createTextNode(` ${message}`));
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMsg = document.getElementById('toastMsg');

    toastMsg.textContent = message;
    toast.className = 'fixed bottom-6 right-6 transform transition-all duration-300 z-50 px-6 py-4 rounded-xl shadow-lg shadow-slate-200 border text-slate-700 bg-white flex items-center gap-3 pointer-events-none';

    if (type === 'success') {
        toast.classList.add('border-emerald-200');
        toastIcon.className = 'fas fa-check-circle text-emerald-500 text-xl';
    } else if (type === 'error') {
        toast.classList.add('border-rose-200', 'bg-rose-50');
        toastIcon.className = 'fas fa-triangle-exclamation text-rose-600 text-xl';
    } else {
        toast.classList.add('border-blue-200');
        toastIcon.className = 'fas fa-info-circle text-primary text-xl';
    }

    toast.classList.remove('translate-y-24', 'opacity-0');
    window.setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 3000);
}

function setCsvStatus(message, type = 'idle') {
    const styles = {
        idle: 'text-slate-500 bg-slate-50 border-slate-200',
        success: 'text-emerald-700 bg-emerald-50 border-emerald-200',
        warning: 'text-amber-700 bg-amber-50 border-amber-200',
        error: 'text-rose-700 bg-rose-50 border-rose-200'
    };
    mappingCsvStatus.className = `mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${styles[type]}`;
    mappingCsvStatus.textContent = message;
}

function checkReady() {
    const directoriesReady = Boolean(inputHandle && outputHandle && dicomFilesList.length > 0);
    const modeReady = processingMode === 'auto' || processingMode === 'csv';
    const csvReady = processingMode !== 'csv' || importedPatientMapping.size > 0;
    startBtn.disabled = !(supportsFSA && !isProcessing && directoriesReady && modeReady && csvReady);
}

function setProcessingControlsDisabled(disabled) {
    btnInput.disabled = disabled || !supportsFSA;
    btnOutput.disabled = disabled || !supportsFSA;
    btnMappingCsv.disabled = disabled;
    downloadCsvTemplate.disabled = disabled;
    modeRadios.forEach(radio => { radio.disabled = disabled; });
}

modeRadios.forEach(radio => {
    radio.addEventListener('change', event => {
        processingMode = event.target.value;
        csvModePanel.classList.toggle('hidden', processingMode !== 'csv');
        const label = processingMode === 'csv' ? 'CSV 指定代號（白名單）' : '全部病人自動編號';
        logToTerminal(`Processing mode selected: ${label}`, 'system');
        checkReady();
    });
});

btnMappingCsv.addEventListener('click', () => {
    mappingCsvInput.value = '';
    mappingCsvInput.click();
});

function applyMappingCsvText(text, fileName) {
    const result = Core.parseMappingCsv(text);
    importedPatientMapping = result.mapping;
    importedCsvWarnings = result.warnings;
    importedCsvName = fileName;
    importedCsvIncludesStudyDate = result.includesStudyDate;

    const duplicateText = importedCsvWarnings.length > 0
        ? `；另有 ${importedCsvWarnings.length} 列重複資料已去重`
        : '';
    const matchLabel = importedCsvIncludesStudyDate ? 'ID＋StudyDate' : 'Patient ID（舊版格式）';
    setCsvStatus(`✓ ${fileName}：${importedPatientMapping.size} 組有效 ${matchLabel} 對應${duplicateText}`, importedCsvWarnings.length ? 'warning' : 'success');
    logToTerminal(`CSV mapping loaded: ${fileName}, ${importedPatientMapping.size} valid mappings.`, 'success');
    showToast(`已匯入 ${importedPatientMapping.size} 組 Patient ID 對應`, 'success');
    checkReady();
    return { count: importedPatientMapping.size, warnings: importedCsvWarnings.length };
}

mappingCsvInput.addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    importedPatientMapping = new Map();
    importedCsvWarnings = [];
    importedCsvName = '';
    importedCsvIncludesStudyDate = false;
    setCsvStatus('正在驗證 CSV…', 'idle');
    checkReady();

    try {
        const buffer = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        applyMappingCsvText(text, file.name);
    } catch (error) {
        setCsvStatus(`CSV 驗證失敗：${error.message}`, 'error');
        logToTerminal(`CSV validation failed: ${error.message}`, 'error');
        showToast('CSV 格式或內容不正確', 'error');
    }

    checkReady();
});

downloadCsvTemplate.addEventListener('click', () => {
    const content = `\uFEFF${Core.CSV_HEADERS.join(',')}\r\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'PatientID_StudyDate_Mapping_Template.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

// ------------------------------------------
// 3. Directory Selection
// ------------------------------------------
btnInput.addEventListener('click', async () => {
    if (isProcessing) return;
    try {
        inputHandle = await window.showDirectoryPicker({ mode: 'read' });
        labelInput.textContent = inputHandle.name;
        labelInput.classList.remove('text-slate-400');
        labelInput.classList.add('text-primary', 'font-bold');
        logToTerminal(`Input directory selected: ${inputHandle.name}`, 'system');
        logToTerminal('Scanning directory for DICOM files…', 'info');

        dicomFilesList = [];
        await scanDirectory(inputHandle, dicomFilesList);
        queueCount.textContent = `0 / ${dicomFilesList.length}`;
        logToTerminal(`Scanning complete. Found ${dicomFilesList.length} files.`, 'success');
        showToast(`已掃描 ${dicomFilesList.length} 個檔案`, 'success');
        checkReady();
    } catch (error) {
        if (error.name !== 'AbortError') showToast('無法讀取輸入資料夾', 'error');
    }
});

btnOutput.addEventListener('click', async () => {
    if (isProcessing) return;
    try {
        outputHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const permission = await outputHandle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') throw new Error('Write permission denied.');

        labelOutput.textContent = outputHandle.name;
        labelOutput.classList.remove('text-slate-400');
        labelOutput.classList.add('text-emerald-600', 'font-bold');
        logToTerminal(`Output directory selected: ${outputHandle.name} (Write Permission Granted)`, 'system');
        checkReady();
    } catch (error) {
        if (error.name !== 'AbortError') showToast('無法取得寫入權限', 'error');
    }
});

async function scanDirectory(dirHandle, fileList) {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            if (!entry.name.startsWith('.') && entry.name !== 'DICOMDIR') fileList.push(entry);
        } else if (entry.kind === 'directory') {
            await scanDirectory(entry, fileList);
        }
    }
}

// ------------------------------------------
// 4. DICOM Streaming and Rewriting
// ------------------------------------------
function getSequenceId(originalId, prefix, mapping) {
    if (!mapping.has(originalId)) mapping.set(originalId, `${prefix}${mapping.size + 1}`);
    return mapping.get(originalId);
}

async function getNestedDirectoryHandle(rootHandle, pathParts) {
    let currentHandle = rootHandle;
    for (const part of pathParts) currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    return currentHandle;
}

function csvEscape(value) {
    const raw = String(value ?? '');
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
}

function createMappingKey(patientId, accessionNo) {
    return `${patientId}\u001F${accessionNo}`;
}

function getSafeModalityPrefix(modality) {
    return (modality || 'IMG').trim().replace(/[^A-Za-z0-9_-]/g, '') || 'IMG';
}

function cleanDicomString(value) {
    return String(value ?? '').replace(/\0/g, '').trim();
}

function clearOptionalTags(byteArray, dataSet, tagsToClear) {
    const result = new Uint8Array(byteArray);
    tagsToClear.forEach(tag => {
        const element = dataSet.elements[tag];
        if (!element) return;
        if (!Number.isInteger(element.dataOffset) || !Number.isInteger(element.length) || element.dataOffset + element.length > result.length) {
            throw new Error(`Optional tag ${tag} has an invalid byte range`);
        }
        result.fill(0x20, element.dataOffset, element.dataOffset + element.length);
    });
    return result;
}

function verifyRewrittenDicom(byteArray, expected, originalElements) {
    let verifiedDataSet;
    try {
        verifiedDataSet = dicomParser.parseDicom(byteArray);
    } catch (error) {
        throw new Error('重寫後的 DICOM 無法重新解析');
    }

    if (cleanDicomString(verifiedDataSet.string('x00100020')) !== expected.patientId) {
        throw new Error('重寫後 PatientID 驗證失敗');
    }
    if (originalElements.x00100010 && cleanDicomString(verifiedDataSet.string('x00100010')) !== expected.patientId) {
        throw new Error('重寫後 PatientName 驗證失敗');
    }
    if (cleanDicomString(verifiedDataSet.string('x00080050')) !== expected.accessionNo) {
        throw new Error('重寫後 AccessionNumber 驗證失敗');
    }
}

function updateProgress(processedCount, totalFiles) {
    const percentage = totalFiles === 0 ? '0.0' : ((processedCount / totalFiles) * 100).toFixed(1);
    progressBar.style.width = `${percentage}%`;
    progressPercentage.textContent = `${percentage}%`;
    queueCount.textContent = `${processedCount} / ${totalFiles}`;
}

function renderFsaStatusMarkup() {
    const statusClass = supportsFSA ? 'text-emerald-500' : 'text-rose-500';
    const statusText = supportsFSA ? 'YES' : 'NO';
    return `<div class="text-slate-400">[System] Native File System API Supported: <span class="font-bold ${statusClass}">${statusText}</span></div>`;
}

startBtn.addEventListener('click', async () => {
    if (isProcessing || startBtn.disabled || dicomFilesList.length === 0) return;
    if (processingMode === 'csv' && importedPatientMapping.size === 0) {
        showToast('請先匯入有效的 Patient ID CSV', 'error');
        return;
    }

    isProcessing = true;
    startBtn.disabled = true;
    setProcessingControlsDisabled(true);
    startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>轉換中…</span>';
    progressContainer.classList.remove('hidden');
    progressStatus.textContent = '正在向硬碟串流寫入…';

    patientMapping.clear();
    accessionMapping.clear();
    mappingLog = [];

    let processedCount = 0;
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let mappingWriteFailed = false;
    const totalFiles = dicomFilesList.length;
    const tagsToClear = getSelectedTags();
    const mappingKeys = new Set();
    const studyFileCounts = new Map();
    const seenCsvMappingKeys = new Set();
    const modeLabel = processingMode === 'csv'
        ? `CSV whitelist (${importedCsvName}, ${importedPatientMapping.size} patients)`
        : 'automatic numbering';

    logToTerminal(`Started Streaming Engine. Mode: ${modeLabel}. Targets: ${totalFiles} files.`, 'system');

    for (let index = 0; index < totalFiles; index++) {
        const fileHandle = dicomFilesList[index];

        try {
            const file = await fileHandle.getFile();
            const byteArray = new Uint8Array(await file.arrayBuffer());
            let dataSet;
            try {
                dataSet = dicomParser.parseDicom(byteArray);
            } catch (error) {
                throw new Error('Not a valid DICOM file');
            }

            const patientIdElement = dataSet.elements.x00100020;
            const accessionElement = dataSet.elements.x00080050;
            const cleanOriginalPatientId = cleanDicomString(dataSet.string('x00100020'));
            const cleanOriginalAccession = cleanDicomString(dataSet.string('x00080050'));
            const cleanOriginalStudyDate = cleanDicomString(dataSet.string('x00080020'));
            const modality = cleanDicomString(dataSet.string('x00080060')) || 'UNK';
            const transferSyntaxUid = cleanDicomString(dataSet.string('x00020010'));

            if (!patientIdElement || !cleanOriginalPatientId) throw new Error('Missing PatientID (0010,0020)');
            if (!accessionElement || !cleanOriginalAccession) throw new Error('Missing AccessionNumber (0008,0050)');

            let newPatientId;
            if (processingMode === 'csv') {
                const csvMappingKey = importedCsvIncludesStudyDate
                    ? Core.createPatientStudyKey(cleanOriginalPatientId, cleanOriginalStudyDate)
                    : cleanOriginalPatientId;
                if (!importedPatientMapping.has(csvMappingKey)) {
                    skippedCount++;
                    continue;
                }
                seenCsvMappingKeys.add(csvMappingKey);
                newPatientId = importedPatientMapping.get(csvMappingKey);
            } else {
                newPatientId = getSequenceId(cleanOriginalPatientId, '', patientMapping);
            }

            const accessionKey = createMappingKey(cleanOriginalPatientId, cleanOriginalAccession);
            const newAccessionNo = getSequenceId(accessionKey, '', accessionMapping);
            const clearedByteArray = clearOptionalTags(byteArray, dataSet, tagsToClear);
            const replacements = {
                x00100020: newPatientId,
                x00080050: newAccessionNo
            };
            if (dataSet.elements.x00100010) replacements.x00100010 = newPatientId;

            const rewrittenByteArray = Core.rewriteDicomStrings(
                clearedByteArray,
                dataSet,
                replacements,
                transferSyntaxUid
            );
            verifyRewrittenDicom(
                rewrittenByteArray,
                { patientId: newPatientId, accessionNo: newAccessionNo },
                dataSet.elements
            );

            const studyFileKey = createMappingKey(newPatientId, newAccessionNo);
            const nextFileNumber = (studyFileCounts.get(studyFileKey) || 0) + 1;
            const outputDirHandle = await getNestedDirectoryHandle(outputHandle, [newPatientId, newAccessionNo]);
            const outputFileName = `${getSafeModalityPrefix(modality)}_${String(nextFileNumber).padStart(6, '0')}.dcm`;
            const outputFileHandle = await outputDirHandle.getFileHandle(outputFileName, { create: true });
            const writable = await outputFileHandle.createWritable();

            try {
                await writable.write(rewrittenByteArray);
                await writable.close();
            } catch (error) {
                try {
                    if (typeof writable.abort === 'function') await writable.abort();
                } catch (_) {
                    // Report the original write error.
                }
                throw error;
            }

            studyFileCounts.set(studyFileKey, nextFileNumber);
            successCount++;

            const mappingKey = createMappingKey(
                createMappingKey(cleanOriginalPatientId, cleanOriginalStudyDate),
                cleanOriginalAccession
            );
            if (!mappingKeys.has(mappingKey)) {
                mappingKeys.add(mappingKey);
                mappingLog.push({
                    modality,
                    origPatientID: cleanOriginalPatientId,
                    origStudyDate: cleanOriginalStudyDate,
                    newPatientID: newPatientId,
                    origAccessionNo: cleanOriginalAccession,
                    newAccessionNo
                });
            }

            if (index % 50 === 0 || index === totalFiles - 1) {
                logToTerminal(`Streamed file ${index + 1} [${modality}] => ${newPatientId}/${newAccessionNo}/${outputFileName}`, 'success');
            }
        } catch (error) {
            errorCount++;
            logToTerminal(`Error on file ${index + 1}: ${error.message}`, 'error');
        } finally {
            processedCount++;
            if (processedCount % 10 === 0 || processedCount === totalFiles) updateProgress(processedCount, totalFiles);
        }
    }

    progressStatus.textContent = '正在寫入 Mapping.csv…';
    logToTerminal('Generating Mapping.csv at output root…', 'system');

    try {
        let csvContent = 'Modality,Original_PatientID,Original_StudyDate,New_PatientID,Original_AccessionNo,New_AccessionNo\n';
        mappingLog.forEach(row => {
            csvContent += [
                row.modality,
                row.origPatientID,
                row.origStudyDate,
                row.newPatientID,
                row.origAccessionNo,
                row.newAccessionNo
            ].map(csvEscape).join(',') + '\n';
        });

        const csvFileHandle = await outputHandle.getFileHandle('Mapping.csv', { create: true });
        const csvWritable = await csvFileHandle.createWritable();
        await csvWritable.write(`\uFEFF${csvContent}`);
        await csvWritable.close();
        logToTerminal(`Mapping.csv saved with ${mappingLog.length} successful mapping rows.`, 'success');
    } catch (error) {
        mappingWriteFailed = true;
        logToTerminal(`Failed to save Mapping.csv: ${error.message}`, 'error');
    }

    const csvNotFoundCount = processingMode === 'csv'
        ? importedPatientMapping.size - seenCsvMappingKeys.size
        : 0;
    const csvMissingLabel = importedCsvIncludesStudyDate ? 'CSV 未找到 ID＋日期' : 'CSV 未找到 ID';
    const summary = `成功 ${successCount}、ID／日期不符略過 ${skippedCount}、DICOM 錯誤 ${errorCount}、${csvMissingLabel} ${csvNotFoundCount}`;
    progressStatus.textContent = mappingWriteFailed ? `影像處理完成，但 Mapping.csv 寫入失敗｜${summary}` : `全部完成｜${summary}`;
    logToTerminal(`Stream Processing Complete! ${summary}${mappingWriteFailed ? '；Mapping.csv write failed' : ''}.`, 'system');
    const completedWithErrors = mappingWriteFailed || errorCount > 0;
    showToast(completedWithErrors ? `轉換完成，請檢查錯誤紀錄：${summary}` : `去識別化完成：${summary}`, completedWithErrors ? 'error' : 'success');

    isProcessing = false;
    startBtn.innerHTML = '<i class="fas fa-play"></i><span>開始串流轉換</span>';
    setProcessingControlsDisabled(false);
    checkReady();
});

function resetApp() {
    if (isProcessing) {
        showToast('處理中無法重設', 'error');
        return;
    }

    inputHandle = null;
    outputHandle = null;
    dicomFilesList = [];
    processingMode = null;
    importedPatientMapping = new Map();
    importedCsvWarnings = [];
    importedCsvName = '';
    importedCsvIncludesStudyDate = false;
    patientMapping.clear();
    accessionMapping.clear();
    mappingLog = [];

    modeRadios.forEach(radio => { radio.checked = false; });
    csvModePanel.classList.add('hidden');
    mappingCsvInput.value = '';
    setCsvStatus('尚未匯入 CSV', 'idle');

    labelInput.textContent = '未選擇';
    labelInput.className = 'text-xs font-mono text-slate-400 font-normal';
    labelOutput.textContent = '未選擇';
    labelOutput.className = 'text-xs font-mono text-slate-400 font-normal';
    queueCount.textContent = '0 / 0';
    terminal.innerHTML = `
        <div class="text-slate-400">[System] Memory-Safe FileStream Engine Initialized.</div>
        ${renderFsaStatusMarkup()}
        <div class="text-slate-400">[System] Waiting for folder permissions and processing mode…</div>
    `;
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0.0%';
    progressStatus.textContent = '準備串流…';
    startBtn.disabled = true;
    showToast('系統狀態已重設', 'info');
}

window.resetApp = resetApp;
window.applyMappingCsvText = applyMappingCsvText;
checkReady();
