# 城市供水厂制水运行与供水调度管理平台

面向水厂台账、取水泵组、混凝加药、沉淀池运行、滤池反冲洗、消毒加氯、清水池调蓄、出厂水质检测、供水调度指令、管网压力监测、二次供水泵房、水表抄见、爆管抢修、原水监测、阀门井巡检、药剂领用、设备维护与值班交接的一体化城市供水制水调度工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 水厂台账 | `plant` | 水厂基础档案 | 水厂编号、水厂名称、设计供水规模 |
| 取水泵组 | `intakepump` | 取水泵组记录 | 泵组编号、所属水厂、泵组型号 |
| 混凝加药 | `dosing` | 混凝加药记录 | 加药编号、加药药剂、投加浓度 |
| 沉淀池运行 | `sedimentation` | 沉淀池运行记录 | 池体编号、进水流量、出水浊度 |
| 滤池反冲洗 | `filter` | 滤池反冲洗记录 | 滤池编号、滤料类型、运行水头损失 |
| 消毒加氯 | `disinfection` | 消毒加氯记录 | 加氯编号、消毒方式、投加量 |
| 清水池调蓄 | `clearwell` | 清水池调蓄记录 | 池体编号、有效容积、当前水位 |
| 出厂水质检测 | `quality` | 出厂水质检测记录 | 检测编号、检测项目、实测值 |
| 供水调度指令 | `dispatch` | 供水调度指令 | 调度编号、调度时段、目标供水量 |
| 管网压力监测 | `pressure` | 管网压力监测点 | 测点编号、所属片区、安装位置 |
| 二次供水泵房 | `secondary` | 二次供水泵房记录 | 泵房编号、所在小区、加压方式 |
| 水表抄见 | `meterread` | 水表抄见记录 | 抄见编号、用户编号、水表口径 |
| 爆管抢修 | `burstrepair` | 爆管抢修记录 | 抢修编号、爆管位置、管道口径 |
| 原水监测 | `sourcewater` | 原水监测记录 | 监测编号、取水口位置、水温 |
| 阀门井巡检 | `valve` | 阀门井台账 | 阀门井编号、所在道路、阀门口径 |
| 药剂领用 | `chem` | 药剂领用记录 | 领用编号、药剂名称、领用数量 |
| 设备维护 | `equipmaint` | 设备维护记录 | 维护编号、维护设备、维护类别 |
| 值班交接班 | `shift` | 交接班记录 | 交接编号、值班班组、班次 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `waterworks-ops:entries` 这一项，或调用 `resetModule(模块)`。
