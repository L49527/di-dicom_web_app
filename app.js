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
const btnPrecheck = document.getElementById('btnPrecheck');
const resultsPanel = document.getElementById('resultsPanel');
const resultsTitle = document.getElementById('resultsTitle');
const resultsStats = document.getElementById('resultsStats');
const resultsNote = document.getElementById('resultsNote');
const resultsTableWrap = document.getElementById('resultsTableWrap');
const resultsTableBody = document.getElementById('resultsTableBody');
const btnDownloadReport = document.getElementById('btnDownloadReport');
const toastClose = document.getElementById('toastClose');
let lastReportRows = [];
let toastTimer = null;
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
    const sticky = type === 'error';
    toast.className = `fixed bottom-6 right-6 max-w-md transform transition-all duration-300 z-50 px-6 py-4 rounded-xl shadow-lg shadow-slate-200 border text-slate-700 bg-white flex items-start gap-3 ${sticky ? 'pointer-events-auto' : 'pointer-events-none'}`;
    toastClose.classList.toggle('hidden', !sticky);

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
    window.clearTimeout(toastTimer);
    // Errors stay until the user closes them; other messages fade after a few seconds.
    if (!sticky) toastTimer = window.setTimeout(hideToast, 4000);
}

function hideToast() {
    const toast = document.getElementById('toast');
    toast.classList.add('translate-y-24', 'opacity-0');
    toast.classList.remove('pointer-events-auto');
    toast.classList.add('pointer-events-none');
}

toastClose.addEventListener('click', hideToast);

// ------------------------------------------
// Results panel
// ------------------------------------------
const CATEGORY_LABELS = {
    date_mismatch: { text: '日期不符', className: 'bg-rose-100 text-rose-700' },
    leading_zero: { text: '前導 0 遺失', className: 'bg-amber-100 text-amber-700' },
    not_found: { text: '找不到 ID', className: 'bg-slate-200 text-slate-700' },
    not_listed: { text: '不在名單', className: 'bg-slate-100 text-slate-500' }
};

function renderResults({ title, stats, note, rows }) {
    resultsTitle.lastChild.textContent = title;
    resultsStats.replaceChildren(...stats.map(stat => {
        const tones = {
            good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
            bad: 'border-rose-200 bg-rose-50 text-rose-700',
            warn: 'border-amber-200 bg-amber-50 text-amber-700',
            neutral: 'border-slate-200 bg-slate-50 text-slate-600'
        };
        const card = document.createElement('div');
        card.className = `rounded-xl border px-3 py-2 ${tones[stat.tone] || tones.neutral}`;
        const value = document.createElement('div');
        value.className = 'text-xl font-black font-mono';
        value.textContent = stat.value;
        const label = document.createElement('div');
        label.className = 'text-[11px] font-semibold leading-snug';
        label.textContent = stat.label;
        card.append(value, label);
        return card;
    }));
    resultsNote.textContent = note || '';

    const problems = (rows || []).filter(row => row.category !== 'not_listed');
    lastReportRows = rows || [];
    resultsTableBody.replaceChildren(...problems.slice(0, 200).map(row => {
        const tr = document.createElement('tr');
        const badge = CATEGORY_LABELS[row.category];
        const cells = [
            null,
            row.source === 'CSV' ? 'CSV 列' : `DICOM（${row.fileCount} 檔）`,
            row.patientId,
            row.studyDate || '（空白）',
            row.reason
        ];
        cells.forEach((text, index) => {
            const td = document.createElement('td');
            td.className = index === 4 ? 'px-3 py-2 text-slate-600' : 'px-3 py-2 whitespace-nowrap font-mono text-slate-700';
            if (index === 0) {
                const span = document.createElement('span');
                span.className = `inline-block rounded-md px-2 py-0.5 font-sans font-bold ${badge.className}`;
                span.textContent = badge.text;
                td.appendChild(span);
            } else {
                td.textContent = text;
            }
            tr.appendChild(td);
        });
        return tr;
    }));
    if (problems.length > 200) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'px-3 py-2 text-slate-500';
        td.textContent = `…另有 ${problems.length - 200} 筆，請下載問題清單查看`;
        tr.appendChild(td);
        resultsTableBody.appendChild(tr);
    }
    resultsTableWrap.classList.toggle('hidden', problems.length === 0);
    btnDownloadReport.classList.toggle('hidden', lastReportRows.length === 0);
    resultsPanel.classList.remove('hidden');
}

function buildReportCsv(rows) {
    let content = 'Source,Category,Original_PatientID,Original_StudyDate,New_PatientID,DICOM_File_Count,Reason\n';
    rows.forEach(row => {
        content += [
            row.source,
            row.category,
            row.patientId,
            row.studyDate,
            row.newPatientId || '',
            row.source === 'DICOM' ? row.fileCount : '',
            row.reason
        ].map(csvEscape).join(',') + '\n';
    });
    return `\uFEFF${content}`;
}

function countProblems(rows) {
    const csvRows = rows.filter(row => row.source === 'CSV');
    return {
        dateMismatch: csvRows.filter(row => row.category === 'date_mismatch').length,
        leadingZero: csvRows.filter(row => row.category === 'leading_zero').length,
        notFound: csvRows.filter(row => row.category === 'not_found').length
    };
}

btnDownloadReport.addEventListener('click', () => {
    const blob = new Blob([buildReportCsv(lastReportRows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Unmatched_Report.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

document.getElementById('btnCloseResults').addEventListener('click', () => resultsPanel.classList.add('hidden'));

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
    btnPrecheck.disabled = !(supportsFSA && !isProcessing && inputHandle && dicomFilesList.length > 0
        && processingMode === 'csv' && importedPatientMapping.size > 0);
}

function setProcessingControlsDisabled(disabled) {
    btnInput.disabled = disabled || !supportsFSA;
    btnOutput.disabled = disabled || !supportsFSA;
    btnMappingCsv.disabled = disabled;
    downloadCsvTemplate.disabled = disabled;
    btnPrecheck.disabled = disabled;
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

const HEADER_PROBE_BYTES = 256 * 1024;

async function readPatientAndStudyDate(fileHandle) {
    const file = await fileHandle.getFile();
    const parse = bytes => {
        const dataSet = dicomParser.parseDicom(bytes, { untilTag: 'x00100020' });
        return {
            patientId: cleanDicomString(dataSet.string('x00100020')),
            studyDate: cleanDicomString(dataSet.string('x00080020'))
        };
    };
    // Only the start of the file is needed; fall back to the whole file if the header is larger.
    if (file.size > HEADER_PROBE_BYTES) {
        try {
            const head = parse(new Uint8Array(await file.slice(0, HEADER_PROBE_BYTES).arrayBuffer()));
            if (head.patientId) return head;
        } catch (_) {
            // Retry with the full file below.
        }
    }
    return parse(new Uint8Array(await file.arrayBuffer()));
}

btnPrecheck.addEventListener('click', async () => {
    if (isProcessing || btnPrecheck.disabled) return;
    isProcessing = true;
    setProcessingControlsDisabled(true);
    startBtn.disabled = true;
    const originalLabel = btnPrecheck.innerHTML;
    btnPrecheck.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>預檢中…';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0.0%';
    progressStatus.textContent = '預檢比對中（只讀取標頭，不寫入檔案）…';
    logToTerminal(`預檢開始：${dicomFilesList.length} 個檔案 vs CSV ${importedPatientMapping.size} 組對應`, 'system');

    const combos = new Map();
    let unreadable = 0;
    let matchedFiles = 0;
    const total = dicomFilesList.length;

    for (let index = 0; index < total; index++) {
        try {
            const { patientId, studyDate } = await readPatientAndStudyDate(dicomFilesList[index]);
            if (!patientId) throw new Error('Missing PatientID');
            const comboKey = Core.createPatientStudyKey(patientId, studyDate);
            if (!combos.has(comboKey)) combos.set(comboKey, { patientId, studyDate, fileCount: 0, matched: false });
            const combo = combos.get(comboKey);
            combo.fileCount++;
            const csvKey = importedCsvIncludesStudyDate ? comboKey : patientId;
            if (importedPatientMapping.has(csvKey)) {
                combo.matched = true;
                matchedFiles++;
            }
        } catch (_) {
            unreadable++;
        }
        if ((index + 1) % 20 === 0 || index === total - 1) updateProgress(index + 1, total);
    }

    const rows = Core.buildMismatchReport(importedPatientMapping, importedCsvIncludesStudyDate, combos.values());
    const counts = countProblems(rows);
    const matchedCsvRows = importedPatientMapping.size - rows.filter(row => row.source === 'CSV').length;
    const problemTotal = counts.dateMismatch + counts.leadingZero + counts.notFound;

    renderResults({
        title: '預檢結果（尚未轉換）',
        stats: [
            { label: `CSV 可對上（共 ${importedPatientMapping.size} 列）`, value: matchedCsvRows, tone: matchedCsvRows === importedPatientMapping.size ? 'good' : 'neutral' },
            { label: '日期不符', value: counts.dateMismatch, tone: counts.dateMismatch ? 'bad' : 'good' },
            { label: '前導 0 遺失', value: counts.leadingZero, tone: counts.leadingZero ? 'warn' : 'good' },
            { label: '資料夾找不到 ID', value: counts.notFound, tone: counts.notFound ? 'warn' : 'good' }
        ],
        note: `將輸出 ${matchedFiles} 個檔案；${total - matchedFiles - unreadable} 個檔案不在名單會略過${unreadable ? `；${unreadable} 個檔案無法讀取（可能不是 DICOM）` : ''}。`
            + (problemTotal ? ' 建議先修正 CSV 後重新匯入，再開始轉換。' : ' CSV 全部對上，可以開始轉換。'),
        rows
    });
    progressStatus.textContent = `預檢完成｜可對上 ${matchedCsvRows}/${importedPatientMapping.size} 列`;
    logToTerminal(`預檢完成：可對上 ${matchedCsvRows}/${importedPatientMapping.size} 列，日期不符 ${counts.dateMismatch}、前導 0 遺失 ${counts.leadingZero}、找不到 ID ${counts.notFound}`, problemTotal ? 'warning' : 'success');
    showToast(problemTotal ? `預檢發現 ${problemTotal} 列 CSV 沒對上，請看結果表` : '預檢通過，CSV 全部對上', problemTotal ? 'error' : 'success');

    btnPrecheck.innerHTML = originalLabel;
    isProcessing = false;
    setProcessingControlsDisabled(false);
    checkReady();
});

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
    resultsPanel.classList.add('hidden');

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
    const dicomCombos = new Map();
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
                const comboKey = Core.createPatientStudyKey(cleanOriginalPatientId, cleanOriginalStudyDate);
                if (!dicomCombos.has(comboKey)) {
                    dicomCombos.set(comboKey, {
                        patientId: cleanOriginalPatientId,
                        studyDate: cleanOriginalStudyDate,
                        fileCount: 0,
                        matched: false
                    });
                }
                const combo = dicomCombos.get(comboKey);
                combo.fileCount++;
                if (!importedPatientMapping.has(csvMappingKey)) {
                    skippedCount++;
                    continue;
                }
                combo.matched = true;
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
            logToTerminal(`Error on file ${index + 1}（${fileHandle.name}）: ${error.message}`, 'error');
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

    let mismatchSummary = '';
    let reportRows = [];
    if (processingMode === 'csv') {
        ({ summary: mismatchSummary, rows: reportRows } = await writeMismatchReport(dicomCombos));
    }

    const csvNotFoundCount = processingMode === 'csv'
        ? importedPatientMapping.size - seenCsvMappingKeys.size
        : 0;
    const csvMissingLabel = importedCsvIncludesStudyDate ? 'CSV 未找到 ID＋日期' : 'CSV 未找到 ID';
    const summary = `成功 ${successCount} 檔、不在 CSV 名單略過 ${skippedCount} 檔、DICOM 錯誤 ${errorCount} 檔、${csvMissingLabel} ${csvNotFoundCount} 列${mismatchSummary}`;
    progressStatus.textContent = mappingWriteFailed ? `影像處理完成，但 Mapping.csv 寫入失敗｜${summary}` : `全部完成｜${summary}`;
    logToTerminal(`Stream Processing Complete! ${summary}${mappingWriteFailed ? '；Mapping.csv write failed' : ''}.`, 'system');
    const counts = countProblems(reportRows);
    const stats = [
        { label: '成功輸出（檔）', value: successCount, tone: successCount ? 'good' : 'neutral' },
        { label: 'DICOM 錯誤（檔）', value: errorCount, tone: errorCount ? 'bad' : 'good' }
    ];
    if (processingMode === 'csv') {
        stats.splice(1, 0, { label: '不在名單略過（檔）', value: skippedCount, tone: 'neutral' });
        stats.push({ label: 'CSV 沒對上（列）', value: csvNotFoundCount, tone: csvNotFoundCount ? 'bad' : 'good' });
    }
    const noteParts = [];
    if (counts.dateMismatch) noteParts.push(`日期不符 ${counts.dateMismatch} 列`);
    if (counts.leadingZero) noteParts.push(`疑似前導 0 遺失 ${counts.leadingZero} 列`);
    if (counts.notFound) noteParts.push(`資料夾找不到 ID ${counts.notFound} 列`);
    renderResults({
        title: mappingWriteFailed ? '轉換結果（Mapping.csv 寫入失敗）' : '轉換結果',
        stats,
        note: (noteParts.length ? `CSV 沒對上的原因：${noteParts.join('、')}。下表列出每一筆。` : '')
            + (errorCount ? ' DICOM 錯誤的檔名請看下方 log。' : ''),
        rows: reportRows
    });

    const completedWithErrors = mappingWriteFailed || errorCount > 0;
    showToast(completedWithErrors ? `轉換完成，請檢查錯誤紀錄：${summary}` : `去識別化完成：${summary}`, completedWithErrors ? 'error' : 'success');

    isProcessing = false;
    startBtn.innerHTML = '<i class="fas fa-play"></i><span>開始串流轉換</span>';
    setProcessingControlsDisabled(false);
    checkReady();
});

async function writeMismatchReport(dicomCombos) {
    const rows = Core.buildMismatchReport(
        importedPatientMapping,
        importedCsvIncludesStudyDate,
        dicomCombos.values()
    );
    const problems = rows.filter(row => row.category !== 'not_listed');
    const dateMismatch = rows.filter(row => row.category === 'date_mismatch' && row.source === 'CSV').length;
    const leadingZero = rows.filter(row => row.category === 'leading_zero' && row.source === 'CSV').length;

    if (problems.length > 0) {
        logToTerminal(`CSV 對應問題 ${problems.length} 筆（完整清單見 Unmatched_Report.csv）：`, 'error');
        problems.slice(0, 30).forEach(row => {
            const datePart = row.studyDate ? ` StudyDate ${row.studyDate}` : '';
            const filePart = row.source === 'DICOM' ? `（${row.fileCount} 檔）` : `（CSV 代號 ${row.newPatientId}）`;
            logToTerminal(`[${row.source}] ID ${row.patientId}${datePart}${filePart}：${row.reason}`, 'error');
        });
        if (problems.length > 30) logToTerminal(`…其餘 ${problems.length - 30} 筆請看 Unmatched_Report.csv`, 'error');
    }

    if (rows.length > 0) {
        try {
            const handle = await outputHandle.getFileHandle('Unmatched_Report.csv', { create: true });
            const writable = await handle.createWritable();
            await writable.write(buildReportCsv(rows));
            await writable.close();
            logToTerminal(`Unmatched_Report.csv saved with ${rows.length} rows.`, 'success');
        } catch (error) {
            logToTerminal(`Failed to save Unmatched_Report.csv: ${error.message}`, 'error');
        }
    }

    const parts = [];
    if (dateMismatch > 0) parts.push(`其中日期不符 ${dateMismatch} 列`);
    if (leadingZero > 0) parts.push(`疑似前導 0 遺失 ${leadingZero} 列`);
    return { rows, summary: parts.length > 0 ? `（${parts.join('、')}，詳見 Unmatched_Report.csv）` : '' };
}

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
    resultsPanel.classList.add('hidden');
    lastReportRows = [];
    startBtn.disabled = true;
    btnPrecheck.disabled = true;
    showToast('系統狀態已重設', 'info');
}

window.resetApp = resetApp;
window.applyMappingCsvText = applyMappingCsvText;
checkReady();
