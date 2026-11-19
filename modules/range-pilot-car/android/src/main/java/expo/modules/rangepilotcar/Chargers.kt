package expo.modules.rangepilotcar

import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

class Charger(
  val id: String,
  val name: String,
  val operator: String?,
  val address: String,
  val lat: Double,
  val lon: Double,
  /** straight-line km from the search point */
  val distanceKm: Double,
  val powerKw: Double?,
  val dc: Boolean,
  val plugs: List<String>,
  val points: Int?
)

/**
 * Charging stations from Open Charge Map — the same source and the same rules
 * as utils/chargers.ts in the phone app.
 */
object Chargers {
  private val PLUG_BY_ID = mapOf(
    33 to "CCS",
    32 to "CCS",
    25 to "Type 2",
    1036 to "Type 2",
    2 to "CHAdeMO",
    27 to "Tesla",
    30 to "Tesla",
    8 to "Tesla",
    1 to "Type 1"
  )

  fun haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = 6371.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  /** Battery % on arrival (roads are about 25% longer than the straight line). */
  fun arrivalPct(distanceKm: Double, batteryPct: Double, capacityKwh: Double, consumption: Double): Double {
    val roadKm = distanceKm * 1.25
    val used = if (capacityKwh > 0) roadKm * consumption / 100.0 / capacityKwh * 100.0 else 0.0
    return batteryPct - used
  }

  /** Blocking — call from a background thread. Throws when there is no connection. */
  fun fetch(lat: Double, lon: Double, key: String, radiusKm: Int = 40, max: Int = 60): List<Charger> {
    val url = URL(
      "https://api.openchargemap.io/v3/poi/?output=json" +
        "&latitude=" + String.format(Locale.US, "%.5f", lat) +
        "&longitude=" + String.format(Locale.US, "%.5f", lon) +
        "&distance=" + radiusKm + "&distanceunit=KM&maxresults=" + max +
        "&compact=true&verbose=false&key=" + key
    )
    val conn = url.openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 10000
      conn.readTimeout = 10000
      conn.setRequestProperty("User-Agent", "RangePilot-AndroidAuto")
      conn.setRequestProperty("Accept", "application/json")
      val code = conn.responseCode
      if (code != 200) throw RuntimeException("HTTP $code")
      val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
      val arr = JSONArray(body)
      val out = ArrayList<Charger>()
      for (i in 0 until arr.length()) {
        val poi = arr.optJSONObject(i) ?: continue
        val c = map(poi, lat, lon) ?: continue
        out.add(c)
      }
      out.sortBy { it.distanceKm }
      return out
    } finally {
      conn.disconnect()
    }
  }

  private fun map(p: JSONObject, fromLat: Double, fromLon: Double): Charger? {
    val a = p.optJSONObject("AddressInfo") ?: return null
    val lat = a.optDouble("Latitude", Double.NaN)
    val lon = a.optDouble("Longitude", Double.NaN)
    if (lat.isNaN() || lon.isNaN()) return null

    // not working: leave it out
    val status = p.optJSONObject("StatusType")
    if (status != null && status.has("IsOperational") && !status.isNull("IsOperational") &&
      !status.optBoolean("IsOperational", true)
    ) {
      return null
    }

    val conns = p.optJSONArray("Connections")
    val plugs = LinkedHashSet<String>()
    var power: Double? = null
    var dcType = false
    if (conns != null) {
      for (i in 0 until conns.length()) {
        val c = conns.optJSONObject(i) ?: continue
        val plug = PLUG_BY_ID[c.optInt("ConnectionTypeID", -1)]
        if (plug != null) plugs.add(plug)
        val kw = c.optDouble("PowerKW", Double.NaN)
        if (!kw.isNaN() && kw > 0 && (power == null || kw > power)) power = kw
        if (c.optInt("CurrentTypeID", -1) == 30) dcType = true
      }
    }
    val best = power
    val dc = dcType || (best != null && best >= 50)
    val operator = p.optJSONObject("OperatorInfo")?.let { text(it, "Title") }
    val points = if (p.has("NumberOfPoints") && !p.isNull("NumberOfPoints")) p.optInt("NumberOfPoints", 0) else 0

    return Charger(
      id = p.optString("ID", ""),
      name = text(a, "Title") ?: "Charging station",
      operator = operator,
      address = listOfNotNull(text(a, "AddressLine1"), text(a, "Town")).joinToString(", "),
      lat = lat,
      lon = lon,
      distanceKm = haversineKm(fromLat, fromLon, lat, lon),
      powerKw = best,
      dc = dc,
      plugs = plugs.toList(),
      points = if (points > 0) points else null
    )
  }

  /** A non-empty string value, or null (JSON null included). */
  private fun text(o: JSONObject, key: String): String? {
    if (!o.has(key) || o.isNull(key)) return null
    val s = o.optString(key, "").trim()
    return if (s.isEmpty()) null else s
  }
}
