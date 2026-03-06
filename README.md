# DICOM De-ID WebEngine v2

![Version](https://img.shields.io/badge/Version-2.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![PureFrontend](https://img.shields.io/badge/Architecture-100%25_Client_Side-orange)

DICOM De-ID WebEngine v2 是一個**極致注重隱私**的開源醫療影像去識別化工具。
採用 100% 純網頁前端架構 (Pure Client-Side Web Architecture)，您不需要安裝任何伺服器或 Python 環境，只需要一個瀏覽器即可運行。
所有的 DICOM 解析、敏感標籤修改、產生 `.csv` 對照表，以及最終的 `.zip` 壓縮打包，都在您電腦的**記憶體內高速完成**。**您的醫療影像資料（PHI）絕對不會上傳到任何網路伺服器。**

DICOM De-ID WebEngine v2 is a **privacy-first**, open-source medical image de-identification tool.
Built on a 100% Pure Client-Side Web Architecture, it requires no server or Python environment—just a web browser. All DICOM parsing, sensitive tag modification, `.csv` mapping generation, and final `.zip` compression are performed **high-speed entirely within your computer's memory**. **Your Protected Health Information (PHI) is never uploaded to any network server.**

---

## ✨ 核心特色 / Key Features

1. **零安裝、零配置 (Zero Setup)**
   - 點擊 `index.html` 或透過 GitHub Pages 開啟即可使用。
   - Simply open `index.html` or access via GitHub Pages to start.
2. **百分百隱私安全 (100% Privacy Secure)**
   - 所有的資料處理皆在瀏覽器本地端 (Localhost) 完成，網頁可完全離線運作 (除第一次載入 CDN)。
   - All data processing happens locally in the browser. The page works entirely offline (after initial CDN fetch).
3. **無縫拖曳體驗 (Seamless Drag & Drop)**
   - 支援將包含數千張 DICOM 的資料夾直接拖曳至網頁中，自動遞迴讀取檔案。
   - Supports dragging and dropping a folder containing thousands of DICOM files directly into the web page.
4. **一鍵打包匯出 (One-Click Export)**
   - 處理完成後，結合 `dciomParser` 與 `JSZip`，將乾淨的影像與新舊 ID 對照表 (`Deidentification_Mapping.csv`) 自動打包為單一 ZIP 壓縮檔供您下載。
   - After processing, clean images and the mapping table are automatically bundled into a single ZIP archive for download.
5. **現代化簡約介面 (Modern Minimalist UI)**
   - 採用 Tailwind CSS 打造如同現代化醫療與辦公軟體般明亮、俐落的高質感介面。
   - Features a bright, clean, premium interface built with Tailwind CSS, resembling modern medical and office software.

## 🚀 如何使用 / How to Use

### 本地端使用 (Local Usage)
1. 下載或 Clone 此專案資料夾。
   Download or Clone this repository.
2. 使用任何現代瀏覽器 (Chrome, Edge, Safari) 點擊兩下開啟 `index.html`。
   Double-click to open `index.html` with any modern browser.

### 線上使用 (Online Usage via GitHub Pages)
（若您已部署至 GitHub Pages，可將網址貼於此）
如果您將此專案 Push 至 GitHub，可以免費開啟 GitHub Pages 功能，直接擁有一個線上可訪問的去識別化工具網站！

---

## 🛠 操作流程 / Workflow

1. **匯入 (Import)**: 將包含 `.dcm` 的資料夾拖曳至左側的虛線區塊，或是點選「選擇資料夾」。
   Drag your folder containing `.dcm` files into the dashed area, or click "Select Folder".
2. **設定 (Settings)**: 在左下角的處理設定中，您可以選擇是否要順便移除額外的個人資訊標籤（例如地址、電話...等）。
   Choose whether to remove extra personal info tags (e.g., Address, Phone) in the settings.
3. **執行 (Execution)**: 點選右側的「開始去識別化」。此時您可以觀察下方的虛擬終端機 (Virtual Terminal) 顯示即時的轉換進度。
   Click "Start". You can monitor the real-time progress via the Virtual Terminal below.
4. **下載 (Download)**: 進度條達到 100% 後，點選跳出的「下載壓縮包 (ZIP)」按鈕，即可妥善保存您的去識別化影像庫與對照表。
   Once 100% complete, click "Download ZIP" to save your de-identified image repository and mapping table.

---

## ⚠️ 注意事項 / Important Notes

- **記憶體限制 (Memory Constraints)**: 由於純網頁版是在瀏覽器記憶體 (RAM) 中運作與壓縮 ZIP，如果您一次丟入 **數 GB** 的超大型檔案，可能會導致瀏覽器分頁當機。若處理大量龐大影像（如大範圍 CT），建議**分批次處理**。
  Since the app operates and zips files within browser memory (RAM), dropping **multiple GBs** of massive files at once might crash the browser tab. For enormous datasets (like extensive CT scans), **processing in smaller batches** is recommended.
- **DICOM 標準**: 網頁版採用覆寫 (In-place patching) 標籤的方式以保持極致的速度。新產生的 `Subject_XXX` 長度會被填充至與原本的 `PatientID` 等長以符合長度規範。
  The web app uses in-place byte patching for extreme speed. The newly generated `Subject_XXX` will be padded to match the length of the original `PatientID`.

## 📦 使用套件 / Libraries Used
- [Tailwind CSS](https://tailwindcss.com/) (Styling)
- [dicomParser](https://github.com/cornerstonejs/dicomParser) (DICOM tag manipulation)
- [JSZip](https://stuk.github.io/jszip/) (ZIP archive creation)
- [FileSaver.js](https://github.com/eligrey/FileSaver.js) (Download triggering)
- [FontAwesome](https://fontawesome.com/) (Icons)
