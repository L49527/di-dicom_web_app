# DICOM De-ID WebEngine v4.1

DICOM De-ID WebEngine 是一個純前端、逐檔串流的 DICOM 去識別化工具。影像與標籤都在瀏覽器本機處理，不會上傳到伺服器。

## 瀏覽器需求

- 桌面版 Google Chrome、Microsoft Edge 或 Opera
- 瀏覽器必須支援 File System Access API
- 頁面會從 CDN 載入 Tailwind CSS、Font Awesome 與 dicomParser，因此首次開啟時需要網路；DICOM 內容本身不會送往 CDN

直接開啟 `index.html` 即可使用，不需要安裝 Python 或啟動伺服器。

## 使用流程

1. 選擇包含 DICOM 的輸入資料夾。
2. 選擇不同的輸出資料夾並授權寫入。
3. 每次執行都必須選擇一種處理模式。
4. 視需要勾選要清空的其他敏感標籤。
5. 按下「開始串流轉換」。

輸出結構如下：

```text
Output/
├── New_Patient_ID/
│   └── New_AccessionNo/
│       ├── CT_000001.dcm
│       └── CT_000002.dcm
└── Mapping.csv
```

`Mapping.csv` 只記錄已成功寫出的對應，並包含 `Original_StudyDate`；不會把日期不符、略過或寫入失敗的檔案列為成功。

## 處理模式

### 自動編號

處理輸入資料夾中的全部 DICOM，依首次出現順序把 PatientID 編為 `1、2、3…`。既有 PatientName 會同步使用相同代號，AccessionNumber 另行依序編號。

### CSV 指定代號

新版 CSV 可同時用 PatientID 與 StudyDate `(0008,0020)` 篩選。只有兩者都相符的 DICOM 才會輸出；名單外或日期不符的檔案會略過，不列為 DICOM 錯誤。

CSV 必須是 UTF-8 或 UTF-8 BOM，且第一列正好為：

```csv
Original_PatientID,Original_StudyDate,New_PatientID
```

範例：

```csv
Original_PatientID,Original_StudyDate,New_PatientID
12345678,2025/12/29,CASE-A01
87654321,2025-12-30,CASE-A02
```

規則：

- Original_PatientID 去除前後空白後，採區分大小寫的完全比對。
- Original_StudyDate 接受 `YYYY/MM/DD`、`YYYY-MM-DD` 或 DICOM 原生的 `YYYYMMDD`，匯入後統一正規化為八碼日期。
- 每一列使用 `Original_PatientID + Original_StudyDate` 的組合作為白名單條件；例如同一 PatientID 的其他檢查日期不會輸出。
- New_PatientID 必須為 1–64 個 ASCII 英數、底線、連字號或句點，且第一字元必須是英數。
- 同一 PatientID＋StudyDate 重複相同對應時會自動去重；同一組合指定不同代號時會拒絕載入。
- 同一位病人的不同日期可使用相同或不同代號；不同 PatientID 不可共用同一代號。
- 支援 LF、CRLF、雙引號、逗號逸出與 UTF-8 BOM。
- 介面可直接下載只有標題列的 UTF-8 BOM 範本。
- 舊版 `Original_PatientID,New_PatientID` 兩欄 CSV 仍可匯入，但只會依 PatientID 比對，不會限制 StudyDate。

## DICOM 改寫方式

工具只改寫 top-level DICOM 標籤：

- PatientID `(0010,0020)`
- AccessionNumber `(0008,0050)`
- PatientName `(0010,0010)`（原本存在時）
- 使用者勾選的其他敏感文字標籤

PatientID、PatientName 與 AccessionNumber 使用目標式位元組重建，允許新值比原欄位長。處理時會：

- 依 Transfer Syntax 判斷 Explicit／Implicit VR 與大小端格式。
- 維持 DICOM 偶數長度填補規則。
- 更新元素長度與既有的 group-length 欄位。
- 保留像素資料、私有標籤及其他未指定內容的原始位元組。
- 寫檔前重新解析並核對三個必要識別欄位。

支援標準 Implicit VR Little Endian、Explicit VR Little Endian、Explicit VR Big Endian，以及使用 Explicit VR Little Endian dataset encoding 的標準壓縮影像 Transfer Syntax。Deflated Explicit VR Little Endian 不支援，遇到時該檔會報錯且不寫出。

缺少 PatientID、AccessionNumber、Transfer Syntax UID，或重寫後無法重新解析的檔案，會列為 DICOM 錯誤並略過。

## 完成摘要

執行結束後會分別顯示：

- 成功輸出檔案數
- CSV 名單外略過檔案數
- DICOM／寫檔錯誤數
- CSV 中沒有在輸入資料中找到的 Patient ID 數量

## 重要限制

- 本工具不是完整的 DICOM PS3.15 去識別化實作。
- 只處理 top-level 標籤，不遞迴處理 sequence 內的識別資訊。
- 不會偵測或移除影像像素中的 burned-in PHI。
- 單一 DICOM 檔案仍會完整載入瀏覽器記憶體，但整批資料採逐檔讀寫。
- 正式醫療、研究分享或資料釋出前，仍應使用合格流程抽驗輸出標籤與影像內容。

## 使用套件

- [dicomParser](https://github.com/cornerstonejs/dicomParser) — DICOM 解析
- [Tailwind CSS](https://tailwindcss.com/) — 介面樣式
- [Font Awesome](https://fontawesome.com/) — 圖示
