package expo.modules.rangepilotcar

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import java.util.Locale

/** One charger: battery on arrival, power and plugs, address — and Navigate. */
class ChargerDetailScreen(carContext: CarContext, private val charger: Charger) : Screen(carContext) {

  @Suppress("DEPRECATION")
  override fun onGetTemplate(): Template {
    val c = charger
    val state = CarStore.read(carContext)
    val pane = Pane.Builder()

    val km = String.format(Locale.US, if (c.distanceKm < 10) "%.1f km away" else "%.0f km away", c.distanceKm)
    val arrival = ChargerText.arrival(c, state)
    val first = Row.Builder().setTitle(km)
    if (arrival != null) first.addText(arrival)
    pane.addRow(first.build())

    val specs = ChargerText.specs(c, " · ").removePrefix(" · ")
    val points = c.points
    val charging = StringBuilder(specs)
    if (points != null) {
      if (charging.isNotEmpty()) charging.append(" · ")
      charging.append(points).append(if (points == 1) " point" else " points")
    }
    if (charging.isNotEmpty()) {
      pane.addRow(Row.Builder().setTitle("Charging").addText(charging.toString()).build())
    }

    val operator = c.operator
    if (operator != null && c.address.isNotEmpty()) {
      pane.addRow(Row.Builder().setTitle(operator).addText(c.address).build())
    } else if (operator != null) {
      pane.addRow(Row.Builder().setTitle(operator).build())
    } else if (c.address.isNotEmpty()) {
      pane.addRow(Row.Builder().setTitle(c.address).build())
    }

    pane.addAction(
      Action.Builder()
        .setTitle("Navigate")
        .setOnClickListener { navigate() }
        .build()
    )

    return PaneTemplate.Builder(pane.build())
      .setTitle(c.name)
      .setHeaderAction(Action.BACK)
      .build()
  }

  /** Hands the destination to the car's navigation app (Google Maps, Waze…). */
  private fun navigate() {
    val uri = Uri.parse(String.format(Locale.US, "geo:%.6f,%.6f", charger.lat, charger.lon))
    try {
      carContext.startCarApp(Intent(CarContext.ACTION_NAVIGATE, uri))
    } catch (e: Exception) {
      CarToast.makeText(carContext, "No navigation app available", CarToast.LENGTH_LONG).show()
    }
  }
}
