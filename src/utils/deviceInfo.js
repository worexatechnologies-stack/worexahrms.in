/**
 * Device / OS / Browser detection from a user-agent string.
 *
 * Deliberately conservative: we only report an exact physical model when the
 * user-agent genuinely exposes one (e.g. "iPhone15,2", "SM-S928B", "Pixel 8").
 * Otherwise we fall back to accurate generic labels ("Windows PC", "Mac",
 * "iPhone", "Android Phone", "iPad", "Android Tablet").
 */

const MATCH = (re, str) => { const m = str.match(re); return m ? m : null }

export function detectDeviceInfo(userAgent) {
  const ua = String(userAgent || '')

  const result = {
    device: 'Unknown device',
    os: '',
    browser: '',
    rawUA: ua,
  }
  if (!ua) return result

  /* ── Browser ── */
  let browser = ''
  if (/Edg\//.test(ua)) browser = 'Microsoft Edge'
  else if (/OPR\/|Opera\//.test(ua)) browser = 'Opera'
  else if (/Firefox\//.test(ua) && !/Seamonkey\//.test(ua)) browser = 'Firefox'
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet'
  else if (/(Trident|MSIE)/.test(ua)) browser = 'Internet Explorer'
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari'

  let browserVer = ''
  if (browser === 'Microsoft Edge') { const m = MATCH(/Edg\/([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }
  else if (browser === 'Firefox') { const m = MATCH(/Firefox\/([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }
  else if (browser === 'Samsung Internet') { const m = MATCH(/SamsungBrowser\/([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }
  else if (browser === 'Internet Explorer') { const m = MATCH(/MSIE\s([\d.]+)/, ua) || MATCH(/rv:([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }
  else if (browser === 'Opera') { const m = MATCH(/OPR\/([\d.]+)/, ua) || MATCH(/Opera[\/ ]([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }
  else if (browser === 'Chrome') { const m = MATCH(/Chrome\/([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }
  else if (browser === 'Safari') { const m = MATCH(/Version\/([\d.]+)/, ua); browserVer = m ? m[1].split('.')[0] : '' }

  if (browser) result.browser = browserVer ? `${browser} ${browserVer}` : browser

  /* ── OS ── */
  let os = ''
  let isMobile = /Mobi|Android/i.test(ua)
  if (/Windows NT 11/.test(ua)) os = 'Windows 11'
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10'
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1'
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/iPhone/.test(ua)) os = 'iOS'
  else if (/iPad/.test(ua)) os = 'iPadOS'
  else if (/iPod/.test(ua)) os = 'iOS'
  else if (/Mac OS X/.test(ua)) {
    const m = MATCH(/Mac OS X ([\d_]+)/, ua)
    os = m ? `macOS ${m[1].replace(/_/g, '.')}` : 'Mac'
  } else if (/Android/.test(ua)) {
    const m = MATCH(/Android ([\d.]+)/, ua)
    os = m ? `Android ${m[1]}` : 'Android'
  } else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  // iOS version from OS part (CPU iPhone OS 17_5 like Mac OS X)
  if (!/Mac OS X/.test(ua) && os === 'iOS') {
    const m = MATCH(/OS ([\d_]+) like Mac OS X/, ua)
    if (m) os = `iOS ${m[1].replace(/_/g, '.')}`
  }
  result.os = os

  /* ── Device type ── */
  let device = 'Unknown device'
  if (isMobile && /iPad/.test(ua)) device = 'iPad'
  else if (isMobile && /iPhone/.test(ua)) device = 'iPhone'
  else if (isMobile && /Android/.test(ua)) {
    device = /iPad|Tablet|SM-T|Tab/i.test(ua) ? 'Android Tablet' : 'Android Phone'
    // Reliable model tokens exposed by real Android UAs / Samsung / Pixel
    const m = MATCH(/\(([^;)]*[A-Za-z][^;)]*); Android/, ua)
    const model = m ? m[1].trim().replace(/\s+/g, ' ') : ''
    if (model && !/Build|Mozilla/i.test(model)) device = model
    else {
      const sm = MATCH(/SM-[A-Z0-9]+/i, ua)
      if (sm) device = sm[0]
    }
  } else if (/Windows NT|Windows/.test(ua)) device = 'Windows PC'
  else if (/Mac OS X/.test(ua)) device = 'Mac'
  else if (/CrOS/.test(ua)) device = 'Chromebook'
  else if (/Linux/.test(ua)) device = 'Linux PC'

  // Exact iPhone model if genuinely present (iPhone15,2 etc.)
  if (/iPhone/.test(ua)) {
    const im = MATCH(/iPhone[,\d]*/, ua)
    const valid = im && /iPhone1[3-9]|iPhone1[2,0-9]|\d,\d/.test(im[0])
    if (valid) device = im[0]
  }

  result.device = device
  return result
}

export function formatDeviceLines(info) {
  const lines = []
  if (info.device) lines.push(info.device)
  if (info.os) lines.push(info.os)
  if (info.browser) lines.push(info.browser)
  return lines.length ? lines : ['Unknown device']
}
