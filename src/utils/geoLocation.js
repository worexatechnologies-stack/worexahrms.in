/**
 * geoLocation.js — robust, reusable geolocation capture.
 *
 * WHY THIS EXISTS:
 * The previous check-in flow called getCurrentPosition once with maximumAge: 0 and a
 * short timeout. On many devices that fails (permission not yet granted, slow GPS fix,
 * browser throttling, etc.), so check-in silently saved no location. This helper makes
 * location capture reliable by:
 *   1. Trying high-accuracy first.
 *   2. Retrying a few times on transient failures.
 *   3. Falling back to a *cached* position if a fresh high-accuracy fix times out.
 *   4. Falling back to default-accuracy (faster) if high-accuracy keeps failing.
 * It returns the best { lat, lng, accuracy } it can obtain, or null if geolocation
 * is unsupported/denied.
 */

function getPosition(options) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

/**
 * Attempts to capture the current position.
 * @returns {Promise<{lat:number,lng:number,accuracy:number}|null>}
 */
export async function requestCurrentLocation() {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return null
  }

  // 1) Fresh high-accuracy fix (long-ish timeout, retried).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pos = await getPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      })
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }
    } catch { /* transient — retry */ }
  }

  // 2) Fall back to any recent cached position (works when a fresh fix is slow).
  try {
    const pos = await getPosition({
      enableHighAccuracy: false,
      timeout: 4000,
      maximumAge: 60000, // up to 1 minute old
    })
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }
  } catch { /* fall through */ }

  // 3) Last resort: default accuracy, no cache constraint.
  try {
    const pos = await getPosition({
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: Infinity,
    })
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }
  } catch {
    return null
  }
}
