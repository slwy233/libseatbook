# 图书馆座位预约 App

天津商业大学图书馆座位预约系统移动端，基于 React Native (Expo) 构建。

## 功能

- ✅ **自动识别验证码登录** — 获取验证码图片，手动输入验证码即可登录
- ✅ **查看空闲座位** — 按楼栋、楼层筛选，查看各房间空闲座位数
- ✅ **座位可视化** — 网格化显示座位状态（空闲/已约）
- ✅ **预约座位** — 选择开始/结束时间，一键预约
- ✅ **查看预约信息** — 当前预约 + 历史记录
- ✅ **取消预约** — 支持取消未开始的预约
- ✅ **定时预约** — 创建定时任务，到期自动执行预约
- ✅ **偏好座位** — 定时预约时指定偏好座位号

## 安装运行

### 环境要求

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- 手机安装 Expo Go app (iOS/Android)

### 安装

```bash
cd SeatBooker
npm install
```

### 运行

```bash
npx expo start
```

然后用 Expo Go 扫码即可运行。

## API 说明

本系统对接天津商业大学图书馆座位预约系统 `libseat.tjcu.edu.cn`。

### 核心端点

| 接口 | 说明 |
|------|------|
| `POST /static/public/cg/getSysSet/PC` | 获取系统配置 (加密密钥等) |
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

### 加密方式

- 算法: AES-128-CBC, PKCS7 填充
- 密钥: `server_date_time` (16字节)
- IV: `client_date_time` (16字节)
- 库: crypto-js (与前端一致)

### 时间格式

系统使用分钟数表示时间: 480 = 08:00, 780 = 13:00, 1310 = 21:50

## 项目结构

```
SeatBooker/
├── App.js                      # 入口, 导航配置
├── package.json
├── app.json                    # Expo 配置
├── src/
│   ├── api/
│   │   └── client.js           # API 客户端 + 加密请求
│   ├── screens/
│   │   ├── LoginScreen.js      # 登录页
│   │   ├── HomeScreen.js       # 首页 (当前预约 + 楼栋列表)
│   │   ├── RoomListScreen.js   # 房间列表
│   │   ├── SeatMapScreen.js    # 座位地图 + 预约
│   │   ├── MyReservationsScreen.js  # 我的预约
│   │   └── ScheduledScreen.js  # 定时预约
│   └── utils/
│       ├── crypto.js           # AES 加密/解密
│       ├── storage.js          # AsyncStorage 封装
│       ├── time.js             # 时间工具函数
│       └── scheduler.js        # 定时任务执行器
```
