<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">城市供水厂制水运行与供水调度管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向水厂台账、取水泵组、混凝加药、沉淀池运行、滤池反冲洗、消毒加氯、清水池调蓄、出厂水质检测、供水调度指令、管网压力监测、二次供水泵房、水表抄见、爆管抢修、原水监测、阀门井巡检、药剂领用、设备维护与值班交接的一体化城市供水制水调度工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "水厂台账", path: "/plant" }, { label: "取水泵组", path: "/intakepump" }, { label: "混凝加药", path: "/dosing" }, { label: "沉淀池运行", path: "/sedimentation" }, { label: "滤池反冲洗", path: "/filter" }, { label: "消毒加氯", path: "/disinfection" }, { label: "清水池调蓄", path: "/clearwell" }, { label: "出厂水质检测", path: "/quality" }, { label: "供水调度指令", path: "/dispatch" }, { label: "管网压力监测", path: "/pressure" }, { label: "二次供水泵房", path: "/secondary" }, { label: "水表抄见", path: "/meterread" }, { label: "爆管抢修", path: "/burstrepair" }, { label: "原水监测", path: "/sourcewater" }, { label: "阀门井巡检", path: "/valve" }, { label: "药剂领用", path: "/chem" }, { label: "设备维护", path: "/equipmaint" }, { label: "值班交接班", path: "/shift" }, { label: "用水报装与接入", path: "/waterapply" }]
</script>
