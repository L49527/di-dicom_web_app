// ===== dicomParser Setup =====
// dicomParser is loaded globally via CDN in index.html

// App State
let inputHandle = null;
let outputHandle = null;
let dicomFilesList = []; // Array of FileSystemFileHandle
let isProcessing = false;
let patientMapping = new Map();
let accessionMapping = new Map();
let mappingLog = [];

// DOM Elements
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

// Check File System Access API support
const supportsFSA = ('showDirectoryPicker' in window);
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
OPTIONAL_TAGS.forEach(t => {
    const div = document.createElement('div');
    div.className = "flex items-center gap-3 p-2 hover:bg-white rounded transition";
    div.innerHTML = `
        <label class="relative flex items-center cursor-pointer">
            <input type="checkbox" value="${t.tag}" class="tag-checkbox peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-300 checked:border-primary checked:bg-primary transition-all">
            <span class="absolute text-white opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" stroke-width="1"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
            </span>
        </label>
        <span class="text-sm text-slate-700 select-none">${t.name}</span>
    `;
    tagsForm.appendChild(div);
});

// Toggle All Tags
let allTagsChecked = false;
document.getElementById('toggleAllTags').addEventListener('click', () => {
    allTagsChecked = !allTagsChecked;
    document.querySelectorAll('.tag-checkbox').forEach(cb => cb.checked = allTagsChecked);
});

function getSelectedTags() {
    return Array.from(document.querySelectorAll('.tag-checkbox:checked')).map(cb => cb.value);
}

// ------------------------------------------
// 2. File UI Helpers
// ------------------------------------------
function logToTerminal(message, type = 'info') {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });

    let colorClass = 'text-slate-500';
    if (type === 'success') colorClass = 'text-emerald-600 font-medium';
    if (type === 'warning') colorClass = 'text-amber-600 font-medium';
    if (type === 'error') colorClass = 'text-rose-600 font-medium';
    if (type === 'system') colorClass = 'text-primary/80 font-medium tracking-wide';

    div.className = colorClass;
    div.innerHTML = `<span class="opacity-40 font-semibold">[${time}]</span> ${message}`;

    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toastIcon');
    const toastMsg = document.getElementById('toastMsg');

    toastMsg.textContent = message;
    toast.className = `fixed bottom-6 right-6 transform transition-all duration-300 z-50 px-6 py-4 rounded-xl shadow-lg shadow-slate-200 border text-slate-700 bg-white flex items-center gap-3 pointer-events-none`;

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
    setTimeout(() => { toast.classList.add('translate-y-24', 'opacity-0'); }, 3000);
}

function checkReady() {
    if (inputHandle && outputHandle && !isProcessing && dicomFilesList.length > 0) {
        startBtn.disabled = false;
        startBtn.classList.add('animate-pulse');
        setTimeout(() => startBtn.classList.remove('animate-pulse'), 1000);
    } else {
        startBtn.disabled = true;
    }
}

// ------------------------------------------
// 3. File System Access Handle (I/O)
// ------------------------------------------

btnInput.addEventListener('click', async () => {
    if (isProcessing) return;
    try {
        inputHandle = await window.showDirectoryPicker({ mode: 'read' });
        labelInput.textContent = inputHandle.name;
        labelInput.classList.remove('text-slate-400');
        labelInput.classList.add('text-primary', 'font-bold');
        logToTerminal(`Input directory selected: ${inputHandle.name}`, 'system');

        // Scan for files
        logToTerminal(`Scanning directory for DICOM files...`, 'info');
        dicomFilesList = [];
        await scanDirectory(inputHandle, dicomFilesList);

        queueCount.textContent = `0 / ${dicomFilesList.length}`;
        logToTerminal(`Scanning complete. Found ${dicomFilesList.length} files.`, 'success');
        showToast(`已掃描 ${dicomFilesList.length} 個檔案`, 'success');
        checkReady();
    } catch (err) {
        if (err.name !== 'AbortError') showToast('無法讀取輸入資料夾', 'error');
    }
});

btnOutput.addEventListener('click', async () => {
    if (isProcessing) return;
    try {
        outputHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

        // Verify permissions
        const permission = await outputHandle.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            throw new Error("Write permission denied.");
        }

        labelOutput.textContent = outputHandle.name;
        labelOutput.classList.remove('text-slate-400');
        labelOutput.classList.add('text-emerald-600', 'font-bold');
        logToTerminal(`Output directory selected: ${outputHandle.name} (Write Permission Granted)`, 'system');

        checkReady();
    } catch (err) {
        if (err.name !== 'AbortError') showToast('無法取得寫入權限', 'error');
    }
});

async function scanDirectory(dirHandle, fileList) {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            if (!entry.name.startsWith('.') && entry.name !== 'DICOMDIR') {
                fileList.push(entry);
            }
        } else if (entry.kind === 'directory') {
            await scanDirectory(entry, fileList);
        }
    }
}

// ------------------------------------------
// 4. DICOM Streaming & Patching Logic
// ------------------------------------------

function getSequenceId(originalId, prefix, mapping) {
    if (!mapping.has(originalId)) {
        const newSize = mapping.size + 1;
        const paddedNum = newSize.toString().padStart(3, '0');
        mapping.set(originalId, `${prefix}_${paddedNum}`);
    }
    return mapping.get(originalId);
}

function patchStringInPlace(byteArray, element, newString) {
    if (!element) return;
    const offset = element.dataOffset;
    const length = element.length;
    let finalString = newString.slice(0, length).padEnd(length, ' ');
    for (let i = 0; i < length; i++) {
        byteArray[offset + i] = finalString.charCodeAt(i);
    }
}

startBtn.addEventListener('click', async () => {
    if (!inputHandle || !outputHandle || dicomFilesList.length === 0 || isProcessing) return;

    isProcessing = true;
    startBtn.disabled = true;
    btnInput.disabled = true;
    btnOutput.disabled = true;
    startBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>轉換中...</span>`;

    progressContainer.classList.remove('hidden');
    progressStatus.textContent = "正在向硬碟串流寫入...";

    patientMapping.clear();
    accessionMapping.clear();
    mappingLog = [];

    let processedCount = 0;
    let errorCount = 0;
    const totalFiles = dicomFilesList.length;
    const tagsToClear = getSelectedTags();

    logToTerminal(`Started Streaming Engine. Targets: ${totalFiles} files.`, 'system');

    for (let i = 0; i < totalFiles; i++) {
        const fileHandle = dicomFilesList[i];

        try {
            // 1. Read Native File
            const file = await fileHandle.getFile();
            const arrayBuffer = await file.arrayBuffer();
            const byteArray = new Uint8Array(arrayBuffer);

            // 2. Parse Valid DICOM
            let dataSet;
            try {
                dataSet = dicomParser.parseDicom(byteArray);
            } catch (err) {
                throw new Error("Not a valid DICOM file");
            }

            // 3. Extract Core Identifiers
            const origPatientID = dataSet.string('x00100020') || 'Unknown_PatientID';
            const origAccessionNo = dataSet.string('x00080050') || 'Unknown_AccessionNo';
            const modality = dataSet.string('x00080060') || 'UNK';

            const cleanOrigPatientID = origPatientID.trim();
            const cleanOrigAccession = origAccessionNo.trim();

            const newPatientID = getSequenceId(cleanOrigPatientID, "Subject", patientMapping);
            const newAccessionNo = getSequenceId(cleanOrigAccession, "Study", accessionMapping);

            // 4. In-Place Override
            patchStringInPlace(byteArray, dataSet.elements['x00100020'], newPatientID); // PatID
            patchStringInPlace(byteArray, dataSet.elements['x00080050'], newAccessionNo); // Accession
            patchStringInPlace(byteArray, dataSet.elements['x00100010'], newPatientID); // PatName

            // 5. Override Selected Optional Tags
            tagsToClear.forEach(tag => {
                if (dataSet.elements[tag]) {
                    patchStringInPlace(byteArray, dataSet.elements[tag], ""); // Replace with blanks
                }
            });

            // 6. Log for CSV
            if (!mappingLog.some(log => log.origAccessionNo === cleanOrigAccession)) {
                mappingLog.push({
                    modality: modality.trim(),
                    origPatientID: cleanOrigPatientID,
                    newPatientID: newPatientID,
                    origAccessionNo: cleanOrigAccession,
                    newAccessionNo: newAccessionNo
                });
            }

            // 7. Write to Output Directory (Stream safely to limit memory)
            // Create nested folders: OutputRoot/OriginalPatientID/OriginalAccessionNo/
            const patientDirHandle = await outputHandle.getDirectoryHandle(cleanOrigPatientID, { create: true });
            const studyDirHandle = await patientDirHandle.getDirectoryHandle(cleanOrigAccession, { create: true });

            const outputFileHandle = await studyDirHandle.getFileHandle(file.name, { create: true });
            const writable = await outputFileHandle.createWritable();
            await writable.write(byteArray);
            await writable.close(); // Crucial to close stream to free handles

            if (i % 50 === 0 || i === totalFiles - 1) {
                logToTerminal(`Streamed [${modality.trim()}] ${cleanOrigPatientID} => ${newPatientID}`, 'success');
            }

        } catch (err) {
            errorCount++;
            logToTerminal(`Error on ${fileHandle.name}: ${err.message}`, 'error');
        }

        processedCount++;

        // Update UI
        if (processedCount % 10 === 0 || processedCount === totalFiles) {
            const percentage = ((processedCount / totalFiles) * 100).toFixed(1);
            progressBar.style.width = `${percentage}%`;
            progressPercentage.textContent = `${percentage}%`;
            queueCount.textContent = `${processedCount} / ${totalFiles}`;
        }
    }

    // 8. Generate Mapping Table in Root Output
    progressStatus.textContent = "Writing CSV Mapping...";
    logToTerminal(`Generating Mapping.csv at output root...`, 'system');

    try {
        let csvContent = "Modality,Original_PatientID,New_PatientID,Original_AccessionNo,New_AccessionNo\n";
        mappingLog.forEach(row => {
            csvContent += `${row.modality},${row.origPatientID},${row.newPatientID},${row.origAccessionNo},${row.newAccessionNo}\n`;
        });

        const csvFileHandle = await outputHandle.getFileHandle("Mapping.csv", { create: true });
        const csvWritable = await csvFileHandle.createWritable();
        // Prepend UTF-8 BOM so Excel opens it properly
        await csvWritable.write("\uFEFF" + csvContent);
        await csvWritable.close();

        logToTerminal(`Mapping.csv saved successfully.`, 'success');
    } catch (err) {
        logToTerminal(`Failed to save CSV: ${err.message}`, 'error');
    }

    // Finished
    progressStatus.textContent = "所有轉換任務完成！";
    logToTerminal(`Stream Processing Complete! ${processedCount - errorCount} Success, ${errorCount} Errors.`, 'system');
    showToast('去識別化完成！檔案已寫入硬碟。', 'success');

    // Reset button
    isProcessing = false;
    startBtn.innerHTML = `<i class="fas fa-play"></i> <span>開始串流轉換</span>`;
    btnInput.disabled = false;
    btnOutput.disabled = false;
});

function resetApp() {
    if (isProcessing) {
        showToast('處理中無法重設', 'error');
        return;
    }
    inputHandle = null;
    outputHandle = null;
    dicomFilesList = [];
    patientMapping.clear();
    accessionMapping.clear();
    mappingLog = [];

    labelInput.textContent = "未選擇";
    labelInput.className = "text-xs font-mono text-slate-400 font-normal";
    labelOutput.textContent = "未選擇";
    labelOutput.className = "text-xs font-mono text-slate-400 font-normal";

    queueCount.textContent = "0 / 0";
    terminal.innerHTML = `
        <div class="text-slate-400">[System] Memory-Safe FileStream Engine Initialized.</div>
        <div class="text-slate-400">[System] Native File System API Supported: <span class="font-bold text-emerald-500">YES</span></div>
        <div class="text-slate-400">[System] Waiting for folder permissions...</div>
    `;

    progressContainer.classList.add('hidden');
    progressBar.style.width = `0%`;
    progressPercentage.textContent = `0.0%`;
    startBtn.disabled = true;
    showToast('系統狀態已重設', 'info');
}
