package expo.modules.rangepilotcar

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/** The phone's position for the car screen, when the app has no running drive. */
object PhoneLocation {
  private const val FRESH_MS = 60_000L
  private const val WAIT_MS = 6_000L

  fun hasPermission(context: Context): Boolean {
    return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
  }

  /** Calls [done] once on the main thread with the best position found, or null. */
  fun current(context: Context, done: (Location?) -> Unit) {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (lm == null || !hasPermission(context)) {
      done(null)
      return
    }
    val last = lastKnown(lm)
    if (last != null && System.currentTimeMillis() - last.time < FRESH_MS) {
      done(last)
      return
    }
    OneShot(lm, last, done).start()
  }

  @SuppressLint("MissingPermission")
  private fun lastKnown(lm: LocationManager): Location? {
    var best: Location? = null
    val providers = try {
      lm.getProviders(true)
    } catch (e: Exception) {
      emptyList<String>()
    }
    for (p in providers) {
      try {
        val l = lm.getLastKnownLocation(p)
        val b = best
        if (l != null && (b == null || l.time > b.time)) best = l
      } catch (e: Exception) {
        // no permission for this provider
      }
    }
    return best
  }

  private class OneShot(
    private val lm: LocationManager,
    private val fallback: Location?,
    private val done: (Location?) -> Unit
  ) : LocationListener {
    private val main = Handler(Looper.getMainLooper())
    private var finished = false
    private val timeout = Runnable { finish(null) }

    @SuppressLint("MissingPermission")
    fun start() {
      var requested = false
      for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
        try {
          if (lm.isProviderEnabled(p)) {
            lm.requestLocationUpdates(p, 0L, 0f, this, Looper.getMainLooper())
            requested = true
          }
        } catch (e: Exception) {
          // provider missing or not allowed
        }
      }
      if (!requested) {
        finish(null)
        return
      }
      main.postDelayed(timeout, WAIT_MS)
    }

    private fun finish(location: Location?) {
      if (finished) return
      finished = true
      main.removeCallbacks(timeout)
      try {
        lm.removeUpdates(this)
      } catch (e: Exception) {
        // ignore
      }
      done(location ?: fallback)
    }

    override fun onLocationChanged(location: Location) {
      finish(location)
    }

    override fun onProviderEnabled(provider: String) {}

    override fun onProviderDisabled(provider: String) {}

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  }
}
