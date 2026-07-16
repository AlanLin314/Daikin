# 大金冷氣內網 Web 控制台

在區域網路用手機瀏覽器控制大金（Daikin）Wi‑Fi 冷氣。協定與 [homebridge-daikin-local-platform](https://github.com/tasict/homebridge-daikin-local-platform) 相同：本機 `POST /dsiot/multireq`。

**範圍：僅內網。** 跑容器的主機（例如 iStoreOS 路由器）必須能直接連到冷氣 IP。

## 功能

| 功能 | 說明 |
|------|------|
| 電源開關 | 開 / 關 |
| 模式 | 冷氣 / 暖氣 / 自動 / 除濕 / 送風 / 加濕 |
| 設定溫度 | ±0.5°C（冷／暖／自動），可直接輸入 |
| 風量 | 自動按鈕 + 滑桿（靜音～5） |
| 感測器 | 室內溫度、濕度、室外溫度 |
| 人體感應 | 開關 |
| 顯示 SSID | 顯示 / 隱藏模組 SSID |
| 裝置資訊 | IP、MAC、SSID、型號、韌體、區域 |

---

## Docker（推薦 · iStoreOS）

映像（push 到 `main` 後由 GitHub Actions 自動建置，含 `amd64` / `arm64`）：

```text
ghcr.io/alanlin314/daikin:latest
```

### 方式 A：直接 `docker pull` 跑（最簡單）

在 iStoreOS **終端機 / SSH**（已安裝 Docker）：

```bash
# 1) 拉映像
docker pull ghcr.io/alanlin314/daikin:latest

# 2) 啟動（請改成你的冷氣 IP）
docker run -d \
  --name daikin-web \
  --restart unless-stopped \
  -p 3080:3080 \
  -e DAIKIN_IP=192.168.1.100 \
  -e DAIKIN_NAME=客廳 \
  ghcr.io/alanlin314/daikin:latest
```

手機連同一 Wi‑Fi，瀏覽器開啟：

```text
http://<路由器IP>:3080
```

停止 / 刪除：

```bash
docker stop daikin-web
docker rm daikin-web
```

更新到新版：

```bash
docker pull ghcr.io/alanlin314/daikin:latest
docker stop daikin-web && docker rm daikin-web
# 再執行上面的 docker run …
```

### 方式 B：`docker compose`（方便改設定）

1. 在路由器建目錄，例如 `/mnt/data/daikin`：

```bash
mkdir -p /mnt/data/daikin
cd /mnt/data/daikin
```

2. 建立 `docker-compose.yml`：

```yaml
services:
  daikin-web:
    image: ghcr.io/alanlin314/daikin:latest
    container_name: daikin-web
    restart: unless-stopped
    ports:
      - "3080:3080"
    environment:
      DAIKIN_IP: "192.168.1.100"   # 改成你的冷氣 IP
      DAIKIN_NAME: "客廳"
```

3. 啟動：

```bash
docker compose pull
docker compose up -d
```

### 方式 C：iStoreOS 圖形介面

1. 開啟 **Docker → 映像**，拉取：`ghcr.io/alanlin314/daikin:latest`  
   - 若提示登入：公開映像一般可不登入；若失敗可在 GitHub 帳號把 package 設成 public。
2. **容器 → 建立**
   - 映像：剛拉取的 `daikin`
   - 網路：橋接即可
   - 端口：主機 `3080` → 容器 `3080`
   - 環境變數：
     - `DAIKIN_IP` = 冷氣 IP
     - `DAIKIN_NAME` = 顯示名稱（可選）
   - 重啟策略：除非停止
3. 啟動後手機開 `http://路由器IP:3080`

### 多台冷氣

用 JSON 環境變數（注意引號）：

```bash
docker run -d \
  --name daikin-web \
  --restart unless-stopped \
  -p 3080:3080 \
  -e 'DAIKIN_DEVICES=[{"id":"living","name":"客廳","ip":"192.168.1.100"},{"id":"room","name":"臥室","ip":"192.168.1.101"}]' \
  ghcr.io/alanlin314/daikin:latest
```

或掛載設定檔：

```bash
# 先準備 config.json（參考 repo 的 config.example.json）
docker run -d \
  --name daikin-web \
  --restart unless-stopped \
  -p 3080:3080 \
  -v /mnt/data/daikin/config.json:/app/config.json:ro \
  ghcr.io/alanlin314/daikin:latest
```

### 若 `docker pull` 失敗（映像尚未公開）

第一次 push 後 GitHub Actions 會建映像；若 package 是 private：

1. GitHub → 你的 package `daikin` → Package settings → **Change visibility → Public**  
或本機/路由器上自己 build：

```bash
git clone https://github.com/AlanLin314/Daikin.git
cd Daikin
docker compose build
DAIKIN_IP=192.168.1.100 docker compose up -d
```

（compose 檔預設 image 名稱為 `ghcr.io/alanlin314/daikin:latest`，本地 build 也會打上此 tag。）

---

## 本機開發（不用 Docker）

```bash
cp config.example.json config.json   # Windows: copy config.example.json config.json
# 編輯 config.json 填入冷氣 IP
npm install
npm run dev
```

開啟 `http://localhost:3080`。

正式啟動：

```bash
npm run build
npm start
```

## 環境變數

| 變數 | 說明 |
|------|------|
| `DAIKIN_IP` | 單台冷氣 IP |
| `DAIKIN_NAME` | 顯示名稱（預設「冷氣」） |
| `DAIKIN_ID` | 裝置 id（預設 `ac-1`） |
| `DAIKIN_DEVICES` | JSON 陣列，多台裝置 |
| `PORT` | 服務埠（預設 3080） |
| `HOST` | 綁定位址（預設 0.0.0.0） |
| `CONFIG_PATH` | 自訂 config.json 路徑 |

## API 一覽

| 方法 | 路徑 | Body |
|------|------|------|
| GET | `/api/health` | — |
| GET | `/api/devices` | — |
| GET | `/api/devices/:id/status?force=1` | — |
| POST | `/api/devices/:id/power` | `{ "on": true }` |
| POST | `/api/devices/:id/mode` | `{ "mode": "cool" }` |
| POST | `/api/devices/:id/temperature` | `{ "celsius": 26 }` |
| POST | `/api/devices/:id/fan` | `{ "speed": "auto" }` |
| POST | `/api/devices/:id/motion` | `{ "enabled": true }` |
| POST | `/api/devices/:id/show-ssid` | `{ "show": false }` |

## 相容性與注意

- 僅適用 **dsiot** 本機 API 機種。
- 冷氣模組回應較慢，服務有限流。
- 網路關機不會觸發遙控器製黴循環。
- 不要把埠直接映射到公網。
