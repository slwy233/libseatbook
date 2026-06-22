# 图书馆座位预约 App

天津商业大学图书馆座位预约系统 Android 客户端，基于 React Native (Expo) 构建。

## 功能

- ✅ **自动识别验证码登录** — 阿里云 ddddocr 服务，支持算式和字母数字两种验证码
- ✅ **首页个人信息** — 积分、违约次数、预约统计、当前预约状态
- ✅ **预约选座** — 场馆选择 → 房间列表 → 座位地图 → 选择时间段 → 一键预约
- ✅ **我的预约** — 查看预约历史记录
- ✅ **Token 过期自动重登** — API 检测到过期后静默重登（8次OCR重试），失败则弹窗提示

## 架构

```
App (React Native / Expo)
 ├── 原生 UI 层 (所有页面纯 React Native)
 ├── HMAC 签名层 (AES+HMAC-SHA256, 破解学校加密)
 ├── OCR 服务 (阿里云 ddddocr) ← 外部 HTTP API
 └── 学校 API (libseat.tjcu.edu.cn)
```

## 目录结构

```
SeatBooker/
├── App.js                          # 入口, 导航配置, token过期处理
├── app.json                        # Expo 配置
├── package.json
├── eas.json                        # EAS 构建配置
├── ocr_server/server.py            # ddddocr OCR 服务
└── src/
    ├── api/
    │   └── client.js               # API 客户端 (HMAC签名, token刷新)
    ├── screens/
    │   ├── LoginScreen.js          # 登录页 (OCR + 手动输入)
    │   ├── HomeScreen.js           # 首页 (个人信息 + 当前预约)
    │   ├── BuildingListScreen.js   # 场馆选择
    │   ├── RoomListScreen.js       # 房间列表 (按日期/楼层筛选)
    │   ├── SeatMapScreen.js        # 座位地图 + 预约弹窗
    │   └── MyReservationsScreen.js # 我的预约
    └── utils/
        ├── crypto.js               # AES加密 + HMAC签名
        ├── ocr.js                  # OCR 客户端 (调用阿里云ddddocr)
        ├── storage.js              # AsyncStorage 封装
        ├── authManager.js          # Token过期管理器
        └── time.js                 # 时间格式转换
```

## 环境要求

### App 构建
- Node.js 18+
- JDK 17+
- Android SDK (API 34+)
- Expo CLI

### OCR 服务（已在阿里云部署）
- 服务器: `39.106.98.187:8910`
- 基于 [ddddocr](https://github.com/sml2h3/ddddocr)

## 快速开始

```bash
cd SeatBooker
npm install
```

## 构建 APK

```bash
# 设置 JDK 17
export JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"

# 生成 Android 原生代码（首次）
npx expo prebuild

# 构建 release APK
cd android
echo "sdk.dir=/path/to/Android/Sdk" > local.properties
./gradlew assembleRelease

# APK 输出: android/app/build/outputs/apk/release/app-release.apk
```

## API

### 核心端点

| 接口 | 说明 |
|------|------|
| `POST /static/public/cg/getSysSet/PC` | 获取系统配置 (加密密钥) |
| `POST /static/public/cg/generateCaptcha/{username}` | 获取验证码 |
| `POST /static/public/auth/user` | 登录 |
| `POST /static/frontApi/user/getUserInfo` | 获取用户信息 |
| `POST /static/frontApi/user/currentUseMake` | 获取当前预约 |
| `POST /static/frontApi/user/lastMake` | 获取预约历史 |
| `POST /static/frontApi/res/buildingFloorDate` | 获取楼栋楼层 |
| `POST /static/frontApi/res/findRoomDuration/{buildingId}/{date}` | 获取房间列表 |
| `POST /static/frontApi/res/freeSeatIdsDuration/{roomId}/{date}` | 获取空闲座位 |
| `POST /static/frontApi/res/getStartTimes/{seatId}/{date}` | 获取可用开始时间 |
| `POST /static/frontApi/res/getEndTimes/{seatId}/{date}/{startMinute}` | 获取可用结束时间 |
| `POST /static/frontApi/make/freeBook/{seatId}/{date}/{start}/{end}?capToken=capToken` | 预约座位 |
| `POST /static/frontApi/make/cancel/{bookingId}` | 取消预约 |

### 加密

- **AES-128-CBC**: 密钥 `server_date_time`, IV `client_date_time`, PKCS7 填充
- **HMAC-SHA256**: hmacKey 先经 AES 解密，签名字符串 `seat::{uuid}::{timestamp}::{METHOD}`

### 时间格式

分钟数: `480 = 08:00`, `780 = 13:00`, `1310 = 21:50`

## License

MIT
