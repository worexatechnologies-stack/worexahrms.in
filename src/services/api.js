import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
const API_MAX_CONCURRENT = Number(import.meta.env.VITE_API_MAX_CONCURRENT || 2)
const DEFAULT_BUSY_RETRIES = Number(import.meta.env.VITE_API_BUSY_RETRIES || 2)

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  // Give the DB a moment to respond without leaving users waiting too long.
  timeout: 15000,
})

const GET_CACHE_TTL = 5 * 1000 // 5 seconds (short cache to avoid duplicate in-flight, but allow polling)
const NOCACHE_URLS = ['/notifications.php', '/attendance.php', '/team-chat.php'] // always fetch fresh
const getCache = new Map()
const inFlightGets = new Map()
let activeRequests = 0
let visibleApiRequests = 0
const requestQueue = []

function emitApiLoadingChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('hrms-api-loading', {
    detail: { loading: visibleApiRequests > 0, count: visibleApiRequests },
  }))
}

function beginApiLoading(config) {
  if (config?.skipLoadingCursor) return
  visibleApiRequests += 1
  config.hrmsLoadingTracked = true
  emitApiLoadingChange()
}

function endApiLoading(config) {
  if (!config?.hrmsLoadingTracked) return
  config.hrmsLoadingTracked = false
  visibleApiRequests = Math.max(0, visibleApiRequests - 1)
  emitApiLoadingChange()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function acquireRequestSlot() {
  if (!Number.isFinite(API_MAX_CONCURRENT) || API_MAX_CONCURRENT < 1) {
    return Promise.resolve(() => {})
  }

  return new Promise(resolve => {
    const enter = () => {
      activeRequests += 1
      let released = false
      resolve(() => {
        if (released) return
        released = true
        activeRequests = Math.max(0, activeRequests - 1)
        const next = requestQueue.shift()
        if (next) next()
      })
    }

    if (activeRequests < API_MAX_CONCURRENT) enter()
    else requestQueue.push(enter)
  })
}

function isDatabaseBusyError(err) {
  const status = err.response?.status
  const message = (err.response?.data?.message || '').toLowerCase()
  return (
    status === 503 ||
    (status >= 500 && (
      message.includes('connection') ||
      message.includes('database') ||
      message.includes('too many')
    ))
  )
}

function retryDelay(err, attempt) {
  const retryAfter = Number(err.response?.headers?.['retry-after'])
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000
  }
  return Math.min(4000, 700 * (2 ** Math.max(0, attempt - 1)))
}

function getCacheKey(config) {
  const params = config.params ? JSON.stringify(config.params) : ''
  return `${config.baseURL || ''}${config.url || ''}?${params}`
}

export function clearApiCache() {
  getCache.clear()
  inFlightGets.clear()
}

api.interceptors.request.use(async (config) => {
  config.releaseApiSlot = await acquireRequestSlot()
  beginApiLoading(config)

  // When sending FormData, Axios must set the boundary automatically.
  // Deleting Content-Type at every level forces Axios to do this correctly.
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
    delete config.headers.common?.['Content-Type']
    delete config.headers.post?.['Content-Type']
    // Axios merges headers in layers — nuke all of them
    if (config.headers.common) delete config.headers.common['Content-Type']
    if (config.headers.post)   delete config.headers.post['Content-Type']
    if (config.headers.put)    delete config.headers.put['Content-Type']
    if (config.headers.patch)  delete config.headers.patch['Content-Type']
  }

  if ((config.method || 'get').toLowerCase() !== 'get') clearApiCache()
  return config
})

const originalGet = api.get.bind(api)
api.get = (url, config = {}) => {
  const merged = { ...config, method: 'get', url, baseURL: config.baseURL || api.defaults.baseURL }
  const key = getCacheKey(merged)
  const now = Date.now()
  const hasAbortSignal = !!config.signal

  // Bypass cache for real-time endpoints
  const isNoCache = NOCACHE_URLS.some(u => url.includes(u))

  if (!isNoCache && !hasAbortSignal) {
    const cached = getCache.get(key)
    if (cached && now - cached.time < GET_CACHE_TTL) {
      return Promise.resolve(cached.response)
    }
  }

  if (!hasAbortSignal && inFlightGets.has(key)) {
    return inFlightGets.get(key)
  }

  const request = originalGet(url, config)
    .then((response) => {
      if (!isNoCache && !hasAbortSignal) getCache.set(key, { time: Date.now(), response })
      return response
    })
    .finally(() => inFlightGets.delete(key))

  if (!hasAbortSignal) inFlightGets.set(key, request)
  return request
}

api.interceptors.response.use(
  res => {
    res.config?.releaseApiSlot?.()
    endApiLoading(res.config)
    return res
  },
  async err => {
    err.config?.releaseApiSlot?.()
    endApiLoading(err.config)
    if (err.config) delete err.config.releaseApiSlot

    if (err.response?.status === 401) {
      if (window.location.pathname !== '/login') {
        localStorage.setItem('hrms_session_expired', 'true')
        window.location.assign('/login')
      }
      return Promise.reject(err)
    }

    if (isDatabaseBusyError(err)) {
      err.isDatabaseBusy = true
    }

    const config = err.config || {}
    const method = (config.method || 'get').toLowerCase()
    const defaultRetries = ['get', 'head', 'options'].includes(method) ? DEFAULT_BUSY_RETRIES : 0
    const maxRetries = Number(config.dbBusyRetries ?? defaultRetries)
    const attempt = Number(config.dbBusyRetryAttempt || 0) + 1

    if (err.isDatabaseBusy && attempt <= maxRetries) {
      config.dbBusyRetryAttempt = attempt
      await sleep(retryDelay(err, attempt))
      return api.request(config)
    }

    return Promise.reject(err)
  }
)

export default api
