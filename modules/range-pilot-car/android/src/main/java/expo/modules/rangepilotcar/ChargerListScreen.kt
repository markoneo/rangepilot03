package expo.modules.rangepilotcar

import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ForegroundCarColorSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.Metadata
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Chargers nearby, next to the car's map: distance, power, plugs and the
 * battery % you would arrive with. Tap one for details and navigation.
 */
class ChargerListScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
  private val main = Handler(Looper.getMainLooper())
  private val io: ExecutorService = Executors.newSingleThreadExecutor()
  private var loading = true
  private var chargers: List<Charger> = emptyList()
  private var message = ""
  private var loadId = 0
  private var destroyed = false

  /** Battery and arrival % move while driving: redraw now and then. */
  private val tick = object : Runnable {
    override fun run() {
      if (!loading) invalidate()
      main.postDelayed(this, REDRAW_MS)
    }
  }

  init {
    lifecycle.addObserver(this)
    load()
  }

  override fun onStart(owner: LifecycleOwner) {
    main.removeCallbacks(tick)
    main.postDelayed(tick, REDRAW_MS)
  }

  override fun onStop(owner: LifecycleOwner) {
    main.removeCallbacks(tick)
  }

  override fun onDestroy(owner: LifecycleOwner) {
    destroyed = true
    main.removeCallbacks(tick)
    io.shutdownNow()
  }

  // ---- data ----

  private fun load() {
    val id = ++loadId
    loading = true
    invalidate()

    val state = CarStore.read(carContext)
    val now = System.currentTimeMillis()
    val sLat = state?.lat
    val sLon = state?.lon
    val stateAge = if (state != null && sLat != null && sLon != null) now - state.fixTs else Long.MAX_VALUE

    // A running drive already has a fresh GPS position.
    if (sLat != null && sLon != null && stateAge < DRIVE_FIX_MS) {
      fetch(id, sLat, sLon, state)
      return
    }
    PhoneLocation.current(carContext) { loc ->
      if (loc != null) {
        fetch(id, loc.latitude, loc.longitude, state)
      } else if (sLat != null && sLon != null && stateAge < OLD_FIX_MS) {
        fetch(id, sLat, sLon, state)
      } else if (!PhoneLocation.hasPermission(carContext)) {
        show(id, emptyList(), "Open Range Pilot on your phone and allow location access.")
      } else {
        show(id, emptyList(), "Waiting for your location. Try again in a moment.")
      }
    }
  }

  private fun fetch(id: Int, lat: Double, lon: Double, state: CarState?) {
    val fromApp = state?.ocmKey ?: ""
    val key = if (fromApp.isNotEmpty()) fromApp else BuildConfig.OCM_KEY
    if (key.isEmpty()) {
      show(id, emptyList(), "Open Range Pilot on your phone once to set up charger data.")
      return
    }
    if (destroyed) return
    try {
      io.execute {
        var found: List<Charger>? = null
        try {
          found = Chargers.fetch(lat, lon, key)
        } catch (e: Exception) {
          found = null
        }
        val result = found
        main.post {
          if (result == null) {
            show(id, emptyList(), "No connection. Try again.")
          } else if (result.isEmpty()) {
            show(id, emptyList(), "No chargers found nearby.")
          } else {
            show(id, result, "")
          }
        }
      }
    } catch (e: Exception) {
      show(id, emptyList(), "Could not load chargers. Try again.")
    }
  }

  private fun show(id: Int, list: List<Charger>, text: String) {
    if (destroyed || id != loadId) return
    chargers = pick(list, listLimit())
    message = text
    loading = false
    invalidate()
  }

  /** How many rows the car allows (usually 6). */
  private fun listLimit(): Int {
    return try {
      if (carContext.carAppApiLevel >= 2) {
        carContext.getCarService(ConstraintManager::class.java)
          .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST)
          .coerceIn(1, 24)
      } else {
        6
      }
    } catch (e: Exception) {
      6
    }
  }

  /**
   * The car shows only a few rows, and on the road fast chargers matter most:
   * keep the nearest fast (DC) ones for about two thirds of the rows, fill the
   * rest with the nearest others, nearest first.
   */
  private fun pick(all: List<Charger>, limit: Int): List<Charger> {
    if (all.size <= limit) return all
    val fastRows = Math.max(1, limit * 2 / 3)
    val fast = all.filter { it.dc }.take(fastRows)
    val rest = all.filter { c -> fast.none { it.id == c.id } }.take(limit - fast.size)
    return (fast + rest).sortedBy { it.distanceKm }
  }

  // ---- screen ----

  override fun onGetTemplate(): Template {
    val state = CarStore.read(carContext)
    val builder = PlaceListMapTemplate.Builder()
      .setTitle("Chargers nearby")
      .setHeaderAction(Action.APP_ICON)

    if (PhoneLocation.hasPermission(carContext)) {
      builder.setCurrentLocationEnabled(true)
    }
    if (carContext.carAppApiLevel >= 5) {
      builder.setOnContentRefreshListener { load() }
    }
    if (state != null) {
      val label = String.format(
        Locale.US, "%d%% · %d km", Math.round(state.battery), Math.round(Math.max(0.0, state.rangeKm))
      )
      val detail = String.format(
        Locale.US, "Battery %d%% · range %d km · %.1f kWh/100 km",
        Math.round(state.battery), Math.round(Math.max(0.0, state.rangeKm)), state.consumption
      )
      builder.setActionStrip(
        ActionStrip.Builder()
          .addAction(
            Action.Builder()
              .setTitle(label)
              .setOnClickListener { CarToast.makeText(carContext, detail, CarToast.LENGTH_LONG).show() }
              .build()
          )
          .build()
      )
    }

    if (loading) {
      builder.setLoading(true)
    } else {
      val items = ItemList.Builder()
      if (chargers.isEmpty()) {
        items.setNoItemsMessage(if (message.isNotEmpty()) message else "No chargers found nearby.")
      } else {
        for (c in chargers) items.addItem(row(c, state))
      }
      builder.setItemList(items.build())
    }
    return builder.build()
  }

  private fun row(c: Charger, state: CarState?): Row {
    // first line: distance · power · plugs  (the first character carries the distance)
    val line = SpannableString(" " + ChargerText.specs(c, " · "))
    val unit = if (c.distanceKm < 10) Distance.UNIT_KILOMETERS_P1 else Distance.UNIT_KILOMETERS
    line.setSpan(
      DistanceSpan.create(Distance.create(Math.max(0.1, c.distanceKm), unit)),
      0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE
    )
    val row = Row.Builder()
      .setTitle(c.name)
      .addText(line)
      .setMetadata(
        Metadata.Builder()
          .setPlace(
            Place.Builder(CarLocation.create(c.lat, c.lon))
              .setMarker(PlaceMarker.Builder().build())
              .build()
          )
          .build()
      )
      .setOnClickListener { screenManager.push(ChargerDetailScreen(carContext, c)) }
    val arrival = ChargerText.arrival(c, state)
    if (arrival != null) row.addText(arrival)
    return row.build()
  }

  companion object {
    private const val REDRAW_MS = 30_000L
    private const val DRIVE_FIX_MS = 2 * 60_000L
    private const val OLD_FIX_MS = 30 * 60_000L
  }
}

/** Texts shared by the list and the details screen. */
object ChargerText {
  /** " · 150 kW DC · CCS/CHAdeMO" — each part led by [sep]. */
  fun specs(c: Charger, sep: String): String {
    val sb = StringBuilder()
    val kw = c.powerKw
    if (kw != null) {
      sb.append(sep).append(Math.round(kw)).append(" kW").append(if (c.dc) " DC" else " AC")
    }
    if (c.plugs.isNotEmpty()) {
      sb.append(sep).append(c.plugs.joinToString("/"))
    }
    return sb.toString()
  }

  /** "48% on arrival" in green / yellow / red, or "Too far"; null when the battery is not known. */
  fun arrival(c: Charger, state: CarState?): CharSequence? {
    if (state == null) return null
    val pct = Chargers.arrivalPct(c.distanceKm, state.battery, state.capacityKwh, state.consumption)
    val text: String
    val color: CarColor
    if (pct < 0) {
      text = "Too far"
      color = CarColor.RED
    } else {
      text = String.format(Locale.US, "%d%% on arrival", Math.round(pct))
      color = if (pct >= 50) CarColor.GREEN else if (pct >= 20) CarColor.YELLOW else CarColor.RED
    }
    val s = SpannableString(text)
    s.setSpan(ForegroundCarColorSpan.create(color), 0, text.length, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
    return s
  }
}
