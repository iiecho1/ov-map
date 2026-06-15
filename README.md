# 网页版奥维地图

基于 Leaflet.js 的网页版地图应用，仿照奥维地图核心功能，支持多源底图、图层导入、绘图测量、搜索定位等。

## 功能特性

### 底图切换
- OpenStreetMap 矢量地图  （国外源）
- Esri 卫星影像
- OpenTopoMap 地形图
- 高德地图 / 高德卫星
- Bing 卫星地图

### 图层导入
- 支持 KML、GeoJSON、GPX 三种格式
- 自动解析 KML 样式（PolyStyle、LineStyle、IconStyle、LabelStyle）
- 扇区多边形按原始颜色渲染
- 纯标签点（如基站名称）只显示文字，不显示圆点
- 图层数据持久化存储（IndexedDB），刷新页面自动恢复

### 图层管理
- 图层显示/隐藏开关
- 图层排序（上移/下移按钮 + 拖拽排序）
- 图层重命名（双击名称编辑）
- 图层删除

### 搜索功能
- **地点搜索**：基于高德地图 POI 搜索 API（需配置免费 API Key）
- **图层搜索**：搜索已导入图层的要素名称和属性
- **坐标搜索**：输入经纬度跳转，支持多种格式
  - `116.6377, 36.4237`
  - `东经116°38′ 北纬36°25′`
  - 自动剔除汉字等无关字符

### 坐标工具
- 底部状态栏实时显示鼠标经纬度和缩放级别
- 右键菜单获取任意位置坐标
  - 复制坐标到剪贴板
  - 搜索附近 / 添加标记

### 绘图与测量
- 绘制点、线段、多边形、矩形、圆形
- 自动计算长度、面积、周长
- 线段测量显示方位角（正北为0°，顺时针递增，附带八方位中文方向）
- 支持编辑和删除

### 定位功能
- GPS 定位（HTTPS 环境）
- IP 定位降级（http 环境自动使用 ip-api.com）

### 标签显示
- 缩放 ≥ 14 级时在画布上渲染要素名称文字
- 使用 Canvas overlay 绘制，不影响地图性能

## 启动方式

```bash
cd ov-map

# 方式一：Python 启动脚本（自动打开浏览器）
python3 start.py

# 方式二：Python 原生命令
python3 -m http.server 8080 --bind 0.0.0.0

# 方式三：直接打开
# 浏览器打开 index.html（IP定位等部分功能受限）
```

### 部署到 Vercel

项目为纯静态站点，可直接部署：

1. 推送到 GitHub 仓库
2. 在 [vercel.com](https://vercel.com) 导入仓库
3. Framework Preset 选 **Other**，Build Command 和 Output Directory 留空
4. 点击 Deploy

`vercel.json` 和 `.gitignore` 已包含在项目中。

## 高德搜索 API 配置

地点搜索使用高德地图 Web 服务 API，需要免费 API Key：

1. 访问 [console.amap.com/dev/key/app](https://console.amap.com/dev/key/app)
2. 注册/登录后创建应用
3. 添加 Key，服务平台选 **Web 服务**
4. 在网页中点击搜索框右侧 ⚙ 图标，输入 Key 并保存

## 技术栈

| 组件 | 说明 |
|------|------|
| Leaflet.js | 地图引擎，Canvas 渲染模式 |
| Leaflet.draw | 绘图工具 |
| toGeoJSON | KML/GPX 转 GeoJSON |
| IndexedDB | 图层和状态持久化存储 |
| 高德 Web API | 地点搜索 |
| ip-api.com | IP 定位降级 |
| Canvas overlay | 标签文字渲染 |

## 项目结构

```
ov-map/
├── index.html        # 主页面（含 SVG favicon）
├── css/
│   └── style.css     # 样式（侧边栏、搜索、弹窗、加载动画等）
├── js/
│   └── app.js        # 主程序（底图、图层、搜索、定位、标签、持久化）
├── start.py          # Python 启动脚本（自动打开浏览器）
├── vercel.json       # Vercel 部署配置
├── .gitignore        # Git 忽略规则
└── README.md
```

## 坐标格式说明

坐标搜索统一按 **先经度后纬度** 输入，支持以下格式：

```
116.6377, 36.4237              # 十进制
经度116.6377 纬度36.4237       # 带汉字
东经116度38分 北纬36度25分     # 度分格式
116°38′12″ 36°25′25″          # 度分秒
E116 38.2 N36 25.4            # 带方向前缀
```
