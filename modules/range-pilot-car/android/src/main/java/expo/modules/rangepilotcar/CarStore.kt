package expo.modules.rangepilotcar

import android.content.Context
import org.json.JSONObject

/** What the phone app last told us about the car. */
class CarState(
  val battery: Double,
  val rangeKm: Double,
  val consumption: Double,
  val capacityKwh: Double,
  val driving: Boolean,
  val lat: Double?,
  val lon: Double?,
  val fixTs: Long,
  val ts: Long,
  val ocmKey: String
)

object CarStore {
  private const val PREFS = "rangepilot_car"
  private const val KEY = "state"

  fun write(context: Context, json: String) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, json)
      .apply()
  }

  fun read(context: Context): CarState? {
    return try {
      val raw = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY, null) ?: return null
      val o = JSONObject(raw)
      val battery = o.optDouble("battery", Double.NaN)
      val consumption = o.optDouble("consumption", Double.NaN)
      val capacity = o.optDouble("capacityKwh", Double.NaN)
      if (battery.isNaN() || consumption.isNaN() || capacity.isNaN()) return null
      val lat = o.optDouble("lat", Double.NaN)
      val lon = o.optDouble("lon", Double.NaN)
      val hasPos = !lat.isNaN() && !lon.isNaN()
      CarState(
        battery = battery,
        rangeKm = o.optDouble("rangeKm", 0.0),
        consumption = consumption,
        capacityKwh = capacity,
        driving = o.optBoolean("driving", false),
        lat = if (hasPos) lat else null,
        lon = if (hasPos) lon else null,
        fixTs = o.optLong("fixTs", 0L),
        ts = o.optLong("ts", 0L),
        ocmKey = o.optString("ocmKey", "")
      )
    } catch (e: Exception) {
      null
    }
  }
}
