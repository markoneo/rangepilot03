package expo.modules.rangepilotcar

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.Locale

/**
 * The main car screen: the range dial with battery, consumption and the km
 * you get per 10 % of battery, the reserve choice, and a way to the chargers.
 */
class RangeScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
  private val main = Handler(Looper.getMainLooper())
  private var shownKey = ""
  private var imageKey = ""
  private var image: CarIcon? = null

  /** Redraw when the numbers the phone app hands over have changed. */
  private val tick = object : Runnable {
    override fun run() {
      if (key(CarStore.read(carContext)) != shownKey) invalidate()
      main.postDelayed(this, CHECK_MS)
    }
  }

  init {
    lifecycle.addObserver(this)
  }

  override fun onStart(owner: LifecycleOwner) {
    main.removeCallbacks(tick)
    main.postDelayed(tick, CHECK_MS)
  }

  override fun onStop(owner: LifecycleOwner) {
    main.removeCallbacks(tick)
  }

  override fun onDestroy(owner: LifecycleOwner) {
    main.removeCallbacks(tick)
  }

  private fun key(s: CarState?): String {
    if (s == null) return "none"
    return Math.round(s.battery).toString() + "|" + Math.round(s.rangeKm) + "|" +
      String.format(Locale.US, "%.1f", s.consumption) + "|" + Math.round(s.usable) + "|" + s.driving +
      "|" + s.reserve + "|" + s.obd + "|" + CarStore.pendingReserve(carContext) +
      "|" + (s.dest?.place?.name ?: "") + "|" + Math.round(s.dest?.arrivalPct ?: 0.0) + "|" + (s.dest?.status ?: "") +
      "|" + CarStore.pendingDestination(carContext).length
  }

  @Suppress("DEPRECATION")
  override fun onGetTemplate(): Template {
    val state = CarStore.read(carContext)
    shownKey = key(state)
    val pane = Pane.Builder()

    if (state == null) {
      pane.addRow(
        Row.Builder()
          .setTitle("Open Range Pilot on your phone")
          .addText("Range and battery appear here once the app has run.")
          .build()
      )
    } else {
      val battery = Math.round(state.battery)
      val range = Math.round(Math.max(0.0, state.rangeKm))
      val per10 = Math.round(
        if (state.consumption > 0) state.capacityKwh * 0.1 / state.consumption * 100.0 else 0.0
      )
      val pending = CarStore.pendingReserve(carContext)
      val reserve = if (pending >= 0) pending else state.reserve

      // The dial picture carries range, battery, consumption and km per 10 %.
      // Where the car cannot show a picture, the same goes into the rows.
      val icon = if (carContext.carAppApiLevel >= 4) ring(range, battery, state.usable, state.consumption, per10) else null
      if (icon != null) {
        pane.setImage(icon)
      } else {
        pane.addRow(row("Range", String.format(Locale.US, "%d km \u00b7 %d%%", range, battery)))
        pane.addRow(
          row("Consumption", String.format(Locale.US, "%.1f kWh/100 km \u00b7 %d km per 10%%", state.consumption, per10))
        )
      }
      pane.addRow(row("Reserve", if (reserve > 0) "$reserve%" else "Off"))
      val to = state.dest
      val showTo = to != null && !CarStore.pendingDestination(carContext).contains("\"clear\"")
      // at most four rows fit: without the picture the arrival line takes this one's place
      if (icon != null || !showTo) {
        pane.addRow(
          row(
            "Battery reading",
            if (state.obd) "Live from the car (OBD)" else if (state.driving) "Estimated" else "No drive running"
          )
        )
      }
      if (to != null && showTo) {
        val pct = Math.round(to.arrivalPct)
        pane.addRow(
          row(
            "Arrival",
            if (to.status == "no" && to.arrivalPct < 0) {
              to.place.name + " \u00b7 not enough battery"
            } else {
              to.place.name + " \u00b7 " + pct + "% on arrival"
            }
          )
        )
      }

      // Off -> 10% -> 20% -> Off; the phone app picks it up within a few seconds
      val next = if (reserve <= 0) 10 else if (reserve < 20) 20 else 0
      pane.addAction(
        Action.Builder()
          .setTitle(if (reserve > 0) "Reserve: $reserve%" else "Reserve: Off")
          .setOnClickListener {
            CarStore.setPendingReserve(carContext, next)
            invalidate()
          }
          .build()
      )
    }

    // "Can I make it?": the answer for the destination already set, or the search for one
    val dest = state?.dest
    val pendingDest = CarStore.pendingDestination(carContext)
    pane.addAction(
      Action.Builder()
        .setTitle("Can I make it?")
        .setOnClickListener {
          if (dest != null && !pendingDest.contains("\"clear\"")) {
            screenManager.push(DestinationResultScreen(carContext, dest.place))
          } else {
            screenManager.push(DestinationSearchScreen(carContext))
          }
        }
        .build()
    )

    return PaneTemplate.Builder(pane.build())
      .setTitle("Range Pilot")
      .setHeaderAction(Action.APP_ICON)
      .build()
  }

  private fun row(title: String, value: String): Row {
    return Row.Builder().setTitle(title).addText(value).build()
  }

  /** The dial picture; drawn again only when what it shows has changed. */
  private fun ring(range: Long, battery: Long, usable: Double, consumption: Double, per10: Long): CarIcon? {
    val k = range.toString() + "|" + battery + "|" + RingImage.ringColor(usable) + "|" +
      String.format(Locale.US, "%.1f", consumption) + "|" + per10
    if (k == imageKey && image != null) return image
    return try {
      val bmp = RingImage.draw(range, battery, usable, consumption, per10)
      val icon = CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build()
      image = icon
      imageKey = k
      icon
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    private const val CHECK_MS = 5_000L
  }
}
