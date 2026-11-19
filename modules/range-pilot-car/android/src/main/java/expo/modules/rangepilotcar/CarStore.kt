package expo.modules.rangepilotcar

import android.content.Context
import org.json.JSONObject

/** What the phone app last told us about the car. */
class CarState(
  val battery: Double,
  /** battery above the reserve (ring colour) */
  val usable: Double,
  val rangeKm: Double,
  val consumption: Double,
  val capacityKwh: Double,
  val driving: Boolean,
  /** reserve in % (0 = off) */
  val reserve: Int,
  /** battery % is read live from the car (OBD) */
  val obd: Boolean,
  val lat: Double?,
  val lon: Double?,
  val fixTs: Long,
  val ts: Long,
  val ocmKey: String
)

object CarStore {
  private const val PREFS = "rangepilot_car"
  private const val KEY = "state"
  private const val KEY_RESERVE = "pending_reserve"

  fun write(context: Context, json: String) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, json)
      .apply()
  }

  /** Reserve chosen on the car screen that the app has not picked up yet; -1 = none. */
  fun pendingReserve(context: Context): Int {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(KEY_RESERVE, -1)
  }

  fun setPendingReserve(context: Context, value: Int) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putInt(KEY_RESERVE, value)
      .apply()
  }

  /** Returns the reserve chosen on the car screen and clears it; -1 = none. */
  fun takePendingReserve(context: Context): Int {
    val v = pendingReserve(context)
    if (v >= 0) setPendingReserve(context, -1)
    return v
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
        usable = o.optDouble("usable", battery),
        rangeKm = o.optDouble("rangeKm", 0.0),
        consumption = consumption,
        capacityKwh = capacity,
        driving = o.optBoolean("driving", false),
        reserve = o.optInt("reserve", 0),
        obd = o.optBoolean("obd", false),
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
