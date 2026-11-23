# DICOM 研究代號轉換 v4.2

使用桌面版 Chrome、Edge 或 Opera 開啟解壓縮後的 `index.html`。網頁、樣式及 DICOM 解析器隨包提供，可離線使用。瀏覽器需要支援資料夾選取、寫入與 Web Locks。

## 執行一批影像

1. 選取三個彼此獨立的資料夾。原始 DICOM 供讀取，研究影像存放改寫後的檔案，院內紀錄存放原始病歷號、檢查日期與研究代號對照。三者可放在同一個上層目錄之下。
2. 選擇全部病人自動編號，或匯入 CSV 指定研究代號。CSV 模式可先預檢，確認指定日期命中的列數，以及放寬日期後額外納入的病人與日期。預檢只讀取標頭。
3. 選擇要額外清除的欄位。按「開始轉換」後，程式逐檔驗證及寫入。結果分列成功寫出、既有內容相同、名單略過與失敗。可展開失敗清單查看來源相對路徑、分類與原因。
4. 研究影像位於 `研究影像/研究代號/新檢查單號/CT_000001.dcm` 等路徑。院內紀錄包含 `Mapping.csv`、`StudyIndex.json`、`Unmatched_Report.csv`、`Failure_Report.csv`。後兩份報表反映最近一次執行，下載的明細可能含原始識別資料。

## 續跑與舊版資料

續跑時選取相同的研究影像與院內紀錄資料夾。兩邊的隱藏檔 `.dicom-batch-id` 用來核對配對。新檢查會先把編號保存在院內的 `StudyIndex.json`，第一個影像寫入失敗時仍可找回這個編號。請將它與歷史對照表一起保存。

每次開始時會讀取既有輸出標頭。轉換時按 Study Instance UID 辨識檢查、按 SOP Instance UID 辨識物件。相同 SOP 的預期輸出和既有檔案逐位元組相同才計為已存在；不同則列為衝突。新 series、先前未成功的影像或已刪除的檔案可補寫。若要使用不同清除設定重新產出整批影像，請使用一組新的空資料夾。`Mapping.csv` 保留歷史成功對應，單筆對應並不代表整個檢查的所有檔案都已齊全。

**接續 v4.1** 時，將舊輸出根目錄中的 `Mapping.csv` 與既有的 `Unmatched_Report.csv` 移到獨立的院內紀錄資料夾，保留原有影像子目錄。選取原輸出作為研究影像資料夾。若既有影像與舊表無法核對，程式會提示問題；也可從原始輸入重新產出到一組新的空資料夾。

## 處理模式

### 自動編號

處理輸入資料夾中的全部 DICOM，依首次出現順序把 PatientID 編為 `1、2、3…`。既有 PatientName 會同步使用相同代號，AccessionNumber 另行依序編號。

### CSV 指定代號

新版 CSV 可同時用 PatientID 與 StudyDate `(0008,0020)` 篩選。只有兩者都相符的 DICOM 才會輸出；名單外或日期不符的檔案預設略過。勾選放寬日期時，只有該病人在名單中對應單一研究代號才可依 ID 輸出。預檢及完成頁會另外列出僅 ID 相符的病人＋日期組數。

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
- 同一位病人的不同日期可使用相同或不同代號；不同 PatientID 不可共用同一代號。匯出前會同時核對歷史對應、保留編號及本批 CSV，並檢查大小寫相撞和 Windows 保留檔名。
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

缺少 PatientID、AccessionNumber、有效的 Study／SOP Instance UID 或 Transfer Syntax UID，或重寫後無法重新解析的檔案，會列為 DICOM 錯誤並略過。

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

## 執行測試

在專案目錄執行 `node --test tests/batch.test.cjs`。測試使用合成的 DICOM Part 10 資料與暫存目錄。涵蓋逐檔補轉、不同 Study 共用檢查單號、代號撞號、舊版遷移、日期預檢、像素位元組保留、例外報表及重設。

## 使用套件

本離線版內含 dicomParser（檔頭版號 1.8.12）。授權文件位於 `vendor/LICENSE.txt`。
