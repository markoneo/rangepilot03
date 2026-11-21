package expo.modules.rangepilotcar

import android.content.Intent
import android.net.Uri
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.ForegroundCarColorSpan
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import android.os.Handler
import android.os.Looper
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * "Can I make it?" — the answer for one destination: battery on arrival, the
 * route, and Navigate. The destination is also handed to the phone app, which
 * shows it on the running drive.
 */
class DestinationResultScreen(carContext: CarContext, private val place: CarPlace) :
  Screen(carContext), DefaultLifecycleObserver {
  private val main = Handler(Looper.getMainLooper())
  private val io: ExecutorService = Executors.newSingleThreadExecutor()
  private var loading = true
  private var error = ""
  private var route: CarRoute? = null
  private var hills: Hills? = null
  private var destroyed = false

  init {
    lifecycle.addObserver(this)
    load()
  }

  override fun onDestroy(owner: LifecycleOwner) {
    destroyed = true
    io.shutdownNow()
  }

  private fun load() {
    loading = true
    error = ""
    val state = CarStore.read(carContext)
    val sLat = state?.lat
    val sLon = state?.lon
    val fresh = state != null && sLat != null && sLon != null &&
      System.currentTimeMillis() - state.fixTs < 2 * 60_000L
    if (fresh && sLat != null && sLon != null) {
      calculate(sLat, sLon, state)
      return
    }
    PhoneLocation.current(carContext) { loc ->
      if (loc != null) {
        calculate(loc.latitude, loc.longitude, state)
      } else if (sLat != null && sLon != null) {
        calculate(sLat, sLon, state)
      } else {
        fail("Waiting for your location. Open Range Pilot on your phone and try again.")
      }
    }
  }

  private fun calculate(lat: Double, lon: Double, state: CarState?) {
    if (destroyed) return
    try {
      io.execute {
        var r: CarRoute? = null
        var h: Hills? = null
        try {
          r = CarMaps.route(lat, lon, place.lat, place.lon, state)
          if (r != null) h = CarMaps.hills(r.points)
        } catch (e: Exception) {
          // shown as "could not calculate" below
        }
        val foundRoute = r
        val foundHills = h
        main.post {
          if (!destroyed) {
            if (foundRoute == null) {
              fail("Could not calculate a route. Check the connection and try again.")
            } else {
              route = foundRoute
              hills = foundHills
              loading = false
              handOver(foundRoute, foundHills)
              invalidate()
            }
          }
        }
      }
    } catch (e: Exception) {
      fail("Could not calculate a route.")
    }
  }

  private fun fail(text: String) {
    if (destroyed) return
    error = text
    loading = false
    invalidate()
  }

  /** The phone app sets this as the destination of the running drive and remembers the place. */
  private fun handOver(r: CarRoute, h: Hills?) {
    try {
      val o = JSONObject()
        .put("name", place.name)
        .put("address", place.address)
        .put("lat", place.lat)
        .put("lon", place.lon)
        .put("routeKm", r.km)
        .put("minutes", r.minutes)
        .put("netM", h?.netM ?: 0)
        .put("climbM", h?.climbM ?: 0)
        .put("descentM", h?.descentM ?: 0)
      CarStore.setPendingDestination(carContext, o.toString())
    } catch (e: Exception) {
      // the answer is still shown on the car screen
    }
  }

  @Suppress("DEPRECATION")
  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
    val r = route
    val state = CarStore.read(carContext)
    var arrival: Arrival? = null

    if (loading) {
      pane.setLoading(true)
    } else if (r == null) {
      pane.addRow(Row.Builder().setTitle(if (error.isNotEmpty()) error else "Could not calculate a route.").build())
      pane.addAction(
        Action.Builder().setTitle("Try again").setOnClickListener {
          load()
          invalidate()
        }.build()
      )
    } else {
      if (state != null) {
        val pending = CarStore.pendingReserve(carContext)
        val reserve = if (pending >= 0) pending else state.reserve
        val est = CarMaps.estimate(
          state.capacityKwh, state.battery, state.planConsumption, reserve.toDouble(),
          r.km, (hills?.netM ?: 0).toDouble()
        )
        arrival = est
        val text: String
        val color: CarColor
        if (est.status == "ok") {
          text = String.format(Locale.US, "You'll make it with %d%%", Math.round(est.arrivalPct))
          color = CarColor.GREEN
        } else if (est.status == "tight") {
          text = String.format(Locale.US, "Tight: %d%% on arrival", Math.round(est.arrivalPct))
          color = CarColor.YELLOW
        } else if (est.arrivalPct < 0) {
          text = String.format(Locale.US, "Not enough: about %d km short", Math.max(1L, Math.round(est.shortKm)))
          color = CarColor.RED
        } else {
          text = String.format(
            Locale.US, "Below your %d%% reserve: %d%% on arrival", reserve, Math.round(est.arrivalPct)
          )
          color = CarColor.RED
        }
        val line = SpannableString(text)
        line.setSpan(ForegroundCarColorSpan.create(color), 0, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
        pane.addRow(Row.Builder().setTitle("Battery on arrival").addText(line).build())

        if (carContext.carAppApiLevel >= 4) {
          try {
            val bmp = RingImage.drawArrival(state.battery, est.arrivalPct, est.status)
            pane.setImage(CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build())
          } catch (e: Exception) {
            // no picture: the rows say the same
          }
        }
      } else {
        pane.addRow(
          Row.Builder()
            .setTitle("Battery on arrival")
            .addText("Open Range Pilot on your phone so the car knows your battery.")
            .build()
        )
      }
      pane.addRow(Row.Builder().setTitle("Route").addText(routeText(r)).build())

      pane.addAction(Action.Builder().setTitle("Navigate").setOnClickListener { navigate() }.build())
      if (arrival != null && arrival.status == "no") {
        // out of reach: the chargers nearby are the next thing to look at
        pane.addAction(
          Action.Builder().setTitle("Chargers").setOnClickListener {
            screenManager.push(ChargerListScreen(carContext))
          }.build()
        )
      } else {
        pane.addAction(
          Action.Builder().setTitle("Clear").setOnClickListener {
            CarStore.setPendingDestination(carContext, "{\"clear\":true}")
            screenManager.popToRoot()
          }.build()
        )
      }
    }

    return PaneTemplate.Builder(pane.build())
      .setTitle(place.name)
      .setHeaderAction(Action.BACK)
      .build()
  }

  private fun routeText(r: CarRoute): String {
    val km = if (r.km < 10) String.format(Locale.US, "%.1f km", r.km) else String.format(Locale.US, "%.0f km", r.km)
    val total = Math.round(r.minutes)
    val time = if (total >= 60) {
      String.format(Locale.US, "%d h %d min", total / 60, total % 60)
    } else {
      String.format(Locale.US, "%d min", total)
    }
    return "$km · $time"
  }

  private fun navigate() {
    val uri = Uri.parse(String.format(Locale.US, "geo:%.6f,%.6f", place.lat, place.lon))
    try {
      carContext.startCarApp(Intent(CarContext.ACTION_NAVIGATE, uri))
    } catch (e: Exception) {
      CarToast.makeText(carContext, "No navigation app available", CarToast.LENGTH_LONG).show()
    }
  }
}
