# 天商书座

天津商业大学图书馆座位预约客户端，使用 React Native 0.76 / Expo SDK 52。

## 功能

- 登录：自动识别验证码，支持直接切换手动输入；自动流程最长 25 秒。
- 首页：刷新个人信息与当前预约，展示今日定时任务结果。
- 选座：场馆 → 日期和楼层 → 分页房间列表 → 编号座位列表 → 可用时段 → 预约。
- 定时：三步创建任务，查看执行结果、启用、暂停和删除；实际任务由服务器执行。
- 我的预约：当前预约和历史记录分组，支持取消与下拉刷新。
- 登录过期：合并并发重登，兼容数字/字符串 20003；失败统一回到登录页。

详细分析、修改依据和验证范围见 [功能结构与实现优化报告](docs/功能结构与实现优化报告.md)。

## 开发与验证

在本目录使用 Node.js 18+，建议先用锁文件安装：

```powershell
npm ci
npm run check:source
npm run check:android
npm test
python -m unittest discover -s tests -p "test_*.py"
npm start
```

JavaScript 测试依赖本地 Babel 和 react-test-renderer；Python 测试使用 Crypto/OCR mocks，无需安装生产 OCR 环境，也不会发出真实预约请求。

```powershell
npm run export:web
npm run export:android
```

上述命令导出 Web 资源或 Android Hermes 字节码，不生成 APK。受限 Windows 环境若 Hermes 临时目录不可写，可仅在当前终端将 TEMP/TMP 指到本项目 outputs/build-temp 后重试。

## 离线界面预览

```powershell
npm run export:web
npm run demo:prepare
npm run demo:serve
```

浏览器打开 http://127.0.0.1:8788。所有业务请求均由预览页本地模拟，不会连接学校、OCR 或定时服务。不要将 outputs/demo 用作生产发布文件。

## 目录

```text
App.js                      根导航、会话过期监听、安全区域
src/components/             标题、状态提示、预约卡片
src/hooks/                  共享取消预约流程
src/screens/                七个业务页面
src/api/client.js           学校接口、HMAC、过期后单次重试
src/api/scheduleApi.js      定时服务接口
src/api/http.js             超时与结构化 HTTP/网络/JSON 错误
src/utils/                  存储、会话恢复、OCR、时间、输入校验
src/theme.js                公共颜色
plugins/withAndroidNetwork.js  Android HTTP Manifest 配置
ocr_server/                 OCR 和定时服务源码
tests/                      离线回归与回环 HTTP 测试
scripts/                    源码校验、离线预览生成
outputs/                    导出资源、截图、验证日志（忽略提交）
```

## Android

需要 JDK 17 和 Android SDK。使用 Expo prebuild 生成原生工程后构建；Windows 长路径下建议另建短路径构建副本，并仅同步本次需要的文件。若存在旧 C:\\lsb 构建副本，先核实内容再同步，避免覆盖其他版本。APK 打包默认保持 arm64-v8a。

OCR/定时服务使用既有 HTTP 地址 39.106.98.187:8910 / :8911。withAndroidNetwork 插件负责将 usesCleartextTraffic 写入生成的 Manifest；已移除未实现功能对应的通知、精确闹钟、开机、自带存储和震动权限。本次 1.0.1 APK 已确认最终 Manifest 配置和权限；真机网络行为仍需验证。

后端启动参数、学校限流处理和验证范围见 [后端优化说明](docs/后端优化说明.md)。

## 服务与边界

- 服务器使用 Python、pycryptodome、ddddocr；定时服务默认任务文件为脚本目录中的 schedule_tasks.json，可通过 --task-file 或环境变量指定。
- 定时按北京时间每日 05:00 后每分钟检查；单任务每日最多 3 次尝试，间隔至少 5 分钟；单次登录最多 5 次。
- 已有预约会保留；根据任务目标时段查询空闲座位，再按偏好顺序选择。
- 文件读改写、原子替换和执行互斥适用于单进程；多个进程共享 JSON 文件不受支持。
- 当前定时 API 未实现认证及任务归属权限，客户端密码保存在 AsyncStorage，服务通信仍使用 HTTP。生产发布前应处理这些问题。
- 用户退出只清本机会话和凭据，服务器定时任务仍会执行；需在定时页面暂停或删除。
- 2026-10-07 已更新线上两个后端服务，并验证公网健康检查、真实模型初始化和学校未登录签名请求；部署记录见后端优化说明。已登录学校接口、识别准确率、真实预约和真机网络仍需另行验证。

安装包、签名、服务器部署和验证边界见 [1.0.1 发布记录](docs/发布记录-1.0.1.md)。

## License

MIT

