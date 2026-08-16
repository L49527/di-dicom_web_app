(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.DicomDeIdCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CSV_HEADERS = ['Original_PatientID', 'New_PatientID'];
    const SAFE_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
    const DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99';
    const IMPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2';
    const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2';
    const STANDARD_TRANSFER_SYNTAX_PREFIX = '1.2.840.10008.1.2.';

    class MappingCsvError extends Error {
        constructor(message, lineNumber) {
            super(lineNumber ? `第 ${lineNumber} 列：${message}` : message);
            this.name = 'MappingCsvError';
            this.lineNumber = lineNumber || null;
        }
    }

    function parseCsvRows(input) {
        const text = String(input ?? '').replace(/^\uFEFF/, '');
        const rows = [];
        let row = [];
        let field = '';
        let state = 'unquoted';
        let lineNumber = 1;
        let rowStartLine = 1;

        function finishField() {
            row.push(field);
            field = '';
            state = 'unquoted';
        }

        function finishRow() {
            finishField();
            if (!row.every(value => value.trim() === '')) {
                rows.push({ values: row, lineNumber: rowStartLine });
            }
            row = [];
            rowStartLine = lineNumber + 1;
        }

        for (let index = 0; index < text.length; index++) {
            const char = text[index];

            if (state === 'quoted') {
                if (char === '"') {
                    if (text[index + 1] === '"') {
                        field += '"';
                        index++;
                    } else {
                        state = 'afterQuote';
                    }
                } else {
                    field += char;
                    if (char === '\n') lineNumber++;
                }
                continue;
            }

            if (state === 'afterQuote') {
                if (char === ',') {
                    finishField();
                    continue;
                }
                if (char === '\r' || char === '\n') {
                    if (char === '\r' && text[index + 1] === '\n') index++;
                    finishRow();
                    lineNumber++;
                    continue;
                }
                if (char === ' ' || char === '\t') continue;
                throw new MappingCsvError('引號欄位結束後只能接逗號或換行', lineNumber);
            }

            if (char === '"') {
                if (field.length !== 0) {
                    throw new MappingCsvError('引號只能出現在欄位開頭', lineNumber);
                }
                state = 'quoted';
            } else if (char === ',') {
                finishField();
            } else if (char === '\r' || char === '\n') {
                if (char === '\r' && text[index + 1] === '\n') index++;
                finishRow();
                lineNumber++;
            } else {
                field += char;
            }
        }

        if (state === 'quoted') {
            throw new MappingCsvError('引號欄位沒有正確結束', lineNumber);
        }

        if (field.length > 0 || row.length > 0 || state === 'afterQuote') {
            finishRow();
        }

        return rows;
    }

    function parseMappingCsv(text) {
        const rows = parseCsvRows(text);
        if (rows.length === 0) {
            throw new MappingCsvError('CSV 是空的');
        }

        const headers = rows[0].values.map(value => value.trim());
        if (headers.length !== CSV_HEADERS.length || headers.some((value, index) => value !== CSV_HEADERS[index])) {
            throw new MappingCsvError(`標題必須正好是 ${CSV_HEADERS.join(',')}`, rows[0].lineNumber);
        }

        const mapping = new Map();
        const aliasOwners = new Map();
        const warnings = [];

        for (const row of rows.slice(1)) {
            if (row.values.length !== 2) {
                throw new MappingCsvError('每列必須正好有兩欄', row.lineNumber);
            }

            const originalPatientId = row.values[0].trim();
            const newPatientId = row.values[1].trim();

            if (!originalPatientId) {
                throw new MappingCsvError('Original_PatientID 不可空白', row.lineNumber);
            }
            if (!newPatientId) {
                throw new MappingCsvError('New_PatientID 不可空白', row.lineNumber);
            }
            if (!SAFE_ALIAS_PATTERN.test(newPatientId)) {
                throw new MappingCsvError('New_PatientID 必須為 1–64 個 ASCII 英數、底線、連字號或句點，且以英數開頭', row.lineNumber);
            }

            if (mapping.has(originalPatientId)) {
                if (mapping.get(originalPatientId) !== newPatientId) {
                    throw new MappingCsvError(`同一 Original_PatientID「${originalPatientId}」出現不同代號`, row.lineNumber);
                }
                warnings.push(`第 ${row.lineNumber} 列與前面重複，已自動去重`);
                continue;
            }

            if (aliasOwners.has(newPatientId) && aliasOwners.get(newPatientId) !== originalPatientId) {
                throw new MappingCsvError(`New_PatientID「${newPatientId}」已被另一位病人使用`, row.lineNumber);
            }

            mapping.set(originalPatientId, newPatientId);
            aliasOwners.set(newPatientId, originalPatientId);
        }

        if (mapping.size === 0) {
            throw new MappingCsvError('CSV 沒有任何有效對應資料');
        }

        return { mapping, warnings };
    }

    function getTransferSyntaxInfo(transferSyntaxUid) {
        const uid = String(transferSyntaxUid ?? '').replace(/\0/g, '').trim();

        if (!uid) throw new Error('DICOM 缺少 Transfer Syntax UID');
        if (uid === DEFLATED_EXPLICIT_VR_LITTLE_ENDIAN) {
            throw new Error('不支援 Deflated Explicit VR Little Endian');
        }
        if (uid === IMPLICIT_VR_LITTLE_ENDIAN) {
            return { uid, explicitVr: false, littleEndian: true };
        }
        if (uid === EXPLICIT_VR_BIG_ENDIAN) {
            return { uid, explicitVr: true, littleEndian: false };
        }
        if (uid.startsWith(STANDARD_TRANSFER_SYNTAX_PREFIX)) {
            return { uid, explicitVr: true, littleEndian: true };
        }

        throw new Error(`不支援的 Transfer Syntax UID：${uid}`);
    }

    function encodeDicomText(value, maximumLength, label) {
        const text = String(value ?? '');
        if (text.length > maximumLength) {
            throw new Error(`${label} 超過 DICOM 允許的 ${maximumLength} 字元`);
        }

        const bytes = [];
        for (let index = 0; index < text.length; index++) {
            const code = text.charCodeAt(index);
            if (code > 0x7f) throw new Error(`${label} 僅支援 ASCII 字元`);
            bytes.push(code);
        }
        if (bytes.length % 2 !== 0) bytes.push(0x20);
        return Uint8Array.from(bytes);
    }

    function writeUint16(byteArray, offset, value, littleEndian) {
        new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength)
            .setUint16(offset, value, littleEndian);
    }

    function writeUint32(byteArray, offset, value, littleEndian) {
        new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength)
            .setUint32(offset, value, littleEndian);
    }

    function readUint32(byteArray, offset, littleEndian) {
        return new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength)
            .getUint32(offset, littleEndian);
    }

    function rewriteDicomStrings(byteArray, dataSet, replacements, transferSyntaxUid) {
        if (!(byteArray instanceof Uint8Array)) throw new TypeError('byteArray 必須是 Uint8Array');
        if (!dataSet || !dataSet.elements) throw new TypeError('缺少 dicomParser DataSet');

        const syntax = getTransferSyntaxInfo(transferSyntaxUid);
        const definitions = {
            x00100020: { vr: 'LO', maximumLength: 64, label: 'PatientID', groupLengthTag: 'x00100000' },
            x00100010: { vr: 'PN', maximumLength: 64, label: 'PatientName', groupLengthTag: 'x00100000' },
            x00080050: { vr: 'SH', maximumLength: 16, label: 'AccessionNumber', groupLengthTag: 'x00080000' }
        };
        const operations = [];

        for (const [tag, value] of Object.entries(replacements || {})) {
            if (value === undefined || value === null) continue;
            const definition = definitions[tag];
            if (!definition) throw new Error(`不允許改寫標籤 ${tag}`);

            const element = dataSet.elements[tag];
            if (!element) continue;
            if (element.hadUndefinedLength) throw new Error(`${definition.label} 使用未定義長度，無法安全改寫`);
            if (!Number.isInteger(element.dataOffset) || !Number.isInteger(element.length)) {
                throw new Error(`${definition.label} 缺少有效的位元組位置`);
            }
            if (element.dataOffset < 8 || element.length < 0 || element.dataOffset + element.length > byteArray.length) {
                throw new Error(`${definition.label} 的位元組範圍無效`);
            }

            const encodedValue = encodeDicomText(value, definition.maximumLength, definition.label);
            const lengthFieldOffset = element.dataOffset - (syntax.explicitVr ? 2 : 4);

            if (syntax.explicitVr) {
                const vrOffset = element.dataOffset - 4;
                const actualVr = String.fromCharCode(byteArray[vrOffset], byteArray[vrOffset + 1]);
                if (actualVr !== definition.vr) {
                    throw new Error(`${definition.label} 的 VR 預期為 ${definition.vr}，實際為 ${actualVr}`);
                }
                if (encodedValue.length > 0xffff) throw new Error(`${definition.label} 長度超過 Explicit VR 上限`);
            }

            operations.push({
                tag,
                definition,
                dataOffset: element.dataOffset,
                oldLength: element.length,
                newBytes: encodedValue,
                lengthFieldOffset,
                delta: encodedValue.length - element.length
            });
        }

        operations.sort((left, right) => right.dataOffset - left.dataOffset);
        const groupDeltas = new Map();
        let result = new Uint8Array(byteArray);

        for (const operation of operations) {
            const oldEnd = operation.dataOffset + operation.oldLength;
            const expanded = new Uint8Array(result.length + operation.delta);
            expanded.set(result.subarray(0, operation.dataOffset), 0);
            expanded.set(operation.newBytes, operation.dataOffset);
            expanded.set(result.subarray(oldEnd), operation.dataOffset + operation.newBytes.length);

            if (syntax.explicitVr) {
                writeUint16(expanded, operation.lengthFieldOffset, operation.newBytes.length, syntax.littleEndian);
            } else {
                writeUint32(expanded, operation.lengthFieldOffset, operation.newBytes.length, syntax.littleEndian);
            }

            result = expanded;
            groupDeltas.set(
                operation.definition.groupLengthTag,
                (groupDeltas.get(operation.definition.groupLengthTag) || 0) + operation.delta
            );
        }

        for (const [groupLengthTag, delta] of groupDeltas.entries()) {
            if (delta === 0) continue;
            const groupLengthElement = dataSet.elements[groupLengthTag];
            if (!groupLengthElement || groupLengthElement.length !== 4) continue;

            const adjustedOffset = groupLengthElement.dataOffset + operations
                .filter(operation => operation.dataOffset < groupLengthElement.dataOffset)
                .reduce((sum, operation) => sum + operation.delta, 0);
            const originalValue = readUint32(byteArray, groupLengthElement.dataOffset, syntax.littleEndian);
            const updatedValue = originalValue + delta;
            if (updatedValue < 0 || updatedValue > 0xffffffff) {
                throw new Error(`${groupLengthTag} 更新後超出 UL 範圍`);
            }
            writeUint32(result, adjustedOffset, updatedValue, syntax.littleEndian);
        }

        return result;
    }

    return {
        CSV_HEADERS,
        MappingCsvError,
        SAFE_ALIAS_PATTERN,
        getTransferSyntaxInfo,
        parseCsvRows,
        parseMappingCsv,
        rewriteDicomStrings
    };
}));
