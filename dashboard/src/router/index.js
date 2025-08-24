import { createRouter, createWebHistory } from 'vue-router'

const Overview = () => import('../pages/Overview.vue')
const Miners = () => import('../pages/Miners.vue')
const Sessions = () => import('../pages/Sessions.vue')
const Logs = () => import('../pages/Logs.vue')
const Config = () => import('../pages/Config.vue')
const Alerts = () => import('../pages/Alerts.vue')

const routes = [
  { path: '/', name: 'overview', component: Overview },
  { path: '/miners', name: 'miners', component: Miners },
  { path: '/sessions', name: 'sessions', component: Sessions },
  { path: '/logs', name: 'logs', component: Logs },
  { path: '/config', name: 'config', component: Config },
  { path: '/alerts', name: 'alerts', component: Alerts },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
