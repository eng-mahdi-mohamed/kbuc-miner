import axios from 'axios'
import { useSettings } from './settings'

export function apiClient() {
  const { apiBase, apiKey } = useSettings()
  const instance = axios.create({ baseURL: apiBase.value, timeout: 15000 })
  instance.interceptors.request.use((config) => {
    if (apiKey.value) config.headers['x-api-key'] = apiKey.value
    return config
  })
  return instance
}
