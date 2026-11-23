# DICOM De-ID WebEngine v4.3（研究代號轉換）

使用桌面版 Chrome、Edge 或 Opera 開啟解壓縮後的 `index.html`。網頁、樣式及 DICOM 解析器隨包提供，可離線使用。瀏覽器需要支援資料夾選取、寫入與 Web Locks。

## 執行一批影像（v4.3 雙資料夾操作）

1. **選擇輸入資料夾**：放置原始 DICOM，可包含子目錄；原始檔只讀取、不覆蓋。
2. **選擇輸出資料夾**：選擇**輸出主目錄**，可與輸入資料夾相同、位於輸入之內，或包含輸入資料夾。執行正式轉換時會自動建立以下子目錄，不必再選第三個目錄：

   ```text
   輸出主目錄/
   ├── 研究影像/
   │   └── 研究代號/新檢查單號/CT_000001.dcm
   └── 院內對照表_不可對外提供/
       ├── Mapping.csv
       ├── StudyIndex.json
       ├── Failure_Report.csv
       └── Unmatched_Report.csv
   ```

   **相同／重疊資料夾注意事項**：若輸入與輸出選在同一目錄，系統會掃描原始檔案，但跳過輸出主目錄中的 `研究影像/` 與 `院內對照表_不可對外提供/`。若輸出位於輸入的子目錄，會排除整個輸出目錄，避免下次執行時把已處理影像再次當作輸入。若輸入位於輸出主目錄，原始資料夾不得位於這兩個系統管理的子目錄內。**原始檔不會被覆蓋**，但請勿分享整個含有原始資料的目錄。既有根層舊版 Mapping.csv 或其他歷史報表仍會被拒絕，需先備份並整理。

   **請勿分享整個輸出主目錄**：`院內對照表_不可對外提供` 包含原始病歷號等敏感識別資料。兩個子目錄各自另有隱藏 `.dicom-batch-id` 用於核對配對。
3. **每次選擇處理模式**：選擇「自動編號」或「CSV 指定代號」。CSV 的匯入與範本下載位於處理模式下方；CSV 模式可先按「預檢比對」，只讀取資料、不建立輸出目錄，也不會寫入 DICOM。
4. **敏感標籤**：必要標籤固定改寫；額外的 11 個欄位預設收合，按需勾選。
5. **開始轉換**：同一頁面顯示進度、成功寫出、已存在相同內容（跳過）、名單略過、失敗／衝突及報表。執行紀錄預設收合，發生錯誤時自動展開。

## 已輸出檢查、斷點續跑與舊版資料

同一批下次再次執行時，選擇**相同的輸出主目錄**。程式讀取既有 `Mapping.csv`、`StudyIndex.json` 及影像內容，以 Study Instance UID 辨識檢查，以 SOP Instance UID 辨識檔案。**只有相同 SOP 的預期輸出與既有檔案逐位元組一致才跳過**；若內容或清除設定不同，列為衝突，**不覆蓋**。上次中斷、新增 series、手動刪除的影像可補寫。程式仍須逐檔讀取、驗證與比較，並非不讀檔的快速跳過。

`StudyIndex.json` 會先保留新檢查編號，以免首次寫入失敗時重跑取得另一個編號。請勿隨意刪除 Mapping、Index 或配對檔；**原始對照資料與研究影像必須保持同一批次**。

**從 v4.2（三資料夾）接續**：先備份，再將舊的「研究影像」資料夾與「院內紀錄」資料夾放到同一個新的輸出主目錄下；舊「院內紀錄」資料夾須命名為 `院內對照表_不可對外提供`，舊影像資料夾須命名為 `研究影像`。保留子資料夾內容及各自的 `.dicom-batch-id`，**不要把 Mapping.csv 放進研究影像中**。整理完成後，v4.3 選取新的輸出主目錄即可繼續核對。請勿將舊影像目錄或院內紀錄目錄直接當成新的輸出主目錄。

**從 v4.1（單資料夾）接續**：請先備份舊輸出，再把影像患者目錄移入新輸出主目錄的 `研究影像/`，把原先根目錄中的 `Mapping.csv` 與其他報表移入 `院內對照表_不可對外提供/`。如需沿用舊版編號，先以小批資料核對；若資料無法一致比對，使用新的空輸出主目錄重新轉換，不要覆蓋舊資料。

v4.3 偵測輸出主目錄根層仍有舊版 `Mapping.csv`、索引、報表或配對檔時會**拒絕直接執行**，避免默默搬移敏感資料或建立錯誤配對。若已有研究影像，但院內對照子目錄遺失，也會拒絕重新編號。程式**不會自動遷移舊版檔案**。

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

在專案目錄執行 `node --test tests/batch.test.cjs`。測試使用合成的 DICOM Part 10 資料與暫存目錄。涵蓋逐檔補轉、不同 Study 共用檢查單號、代號撞號、歷史配對核對、日期預檢、像素位元組保留、例外報表、重設、雙資料夾建立與舊版目錄防呆。

## 使用套件

本離線版內含 dicomParser（檔頭版號 1.8.12）。授權文件位於 `vendor/LICENSE.txt`。
