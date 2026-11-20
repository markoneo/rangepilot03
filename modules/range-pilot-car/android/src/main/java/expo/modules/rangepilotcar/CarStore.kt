package expo.modules.rangepilotcar

import android.content.Context
import org.json.JSONObject

/** The destination of the running drive, as the phone app sees it right now. */
class DestInfo(
  val place: CarPlace,
  val remainingKm: Double,
  val minutes: Double,
  val arrivalPct: Double,
  /** "ok" | "tight" | "no" */
  val status: String
)

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
  val ocmKey: String,
  /** consumption the "Can I make it?" estimate plans with (level-road figure with OBD) */
  val planConsumption: Double,
  val googleKey: String,
  /** destinations used before, newest first */
  val recents: List<CarPlace>,
  val dest: DestInfo?
)

object CarStore {
  private const val PREFS = "rangepilot_car"
  private const val KEY = "state"
  private const val KEY_RESERVE = "pending_reserve"
  private const val KEY_DEST = "pending_destination"

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
      val recents = ArrayList<CarPlace>()
      val list = o.optJSONArray("recents")
      if (list != null) {
        for (i in 0 until list.length()) {
          val place = place(list.optJSONObject(i))
          if (place != null) recents.add(place)
        }
      }
      val d = o.optJSONObject("dest")
      val destPlace = place(d)
      val dest = if (d != null && destPlace != null) {
        DestInfo(
          destPlace,
          d.optDouble("remainingKm", 0.0),
          d.optDouble("minutes", 0.0),
          d.optDouble("arrivalPct", 0.0),
          d.optString("status", "ok")
        )
      } else {
        null
      }
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
        ocmKey = o.optString("ocmKey", ""),
        planConsumption = o.optDouble("planConsumption", consumption),
        googleKey = o.optString("googleKey", ""),
        recents = recents,
        dest = dest
      )
    } catch (e: Exception) {
      null
    }
  }

  private fun place(o: JSONObject?): CarPlace? {
    if (o == null) return null
    val lat = o.optDouble("lat", Double.NaN)
    val lon = o.optDouble("lon", Double.NaN)
    val name = if (o.isNull("name")) "" else o.optString("name", "").trim()
    if (lat.isNaN() || lon.isNaN() || name.isEmpty()) return null
    return CarPlace(name, if (o.isNull("address")) "" else o.optString("address", "").trim(), lat, lon)
  }

  // ---- destination picked or cleared on the car screen, for the app to pick up ----

  fun pendingDestination(context: Context): String {
    return context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_DEST, "") ?: ""
  }

  fun setPendingDestination(context: Context, json: String) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_DEST, json)
      .apply()
  }

  fun takePendingDestination(context: Context): String {
    val v = pendingDestination(context)
    if (v.isNotEmpty()) setPendingDestination(context, "")
    return v
  }
}
