package expo.modules.rangepilotcar

import java.net.URLEncoder
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

class Suggestion(
  val id: String,
  val title: String,
  val subtitle: String,
  val google: Boolean,
  val lat: Double?,
  val lon: Double?
)

class CarPlace(val name: String, val address: String, val lat: Double, val lon: Double)

class CarRoute(val km: Double, val minutes: Double, val points: List<DoubleArray>)

class Hills(val climbM: Int, val descentM: Int, val netM: Int)

class Arrival(
  val arrivalPct: Double,
  /** "ok" | "tight" | "no" */
  val status: String,
  /** km missing when the battery does not reach (0 otherwise) */
  val shortKm: Double
)

/**
 * Address search, routing, elevation and the "Can I make it?" estimate for the
 * car screen. A port of utils/maps.ts and utils/elevation.ts — same services
 * (Google when the key is accepted, otherwise Photon / OSRM; Open-Meteo for
 * elevation) and the same formula, so the car and the phone give the same answer.
 * Everything here blocks: call from a background thread.
 */
object CarMaps {
  @Volatile private var googleBlocked = false

  private fun googleKey(state: CarState?): String {
    val fromApp = state?.googleKey ?: ""
    val key = if (fromApp.isNotEmpty()) fromApp else BuildConfig.GOOGLE_KEY
    return if (googleBlocked) "" else key
  }

  private fun google(result: Http.Result): JSONObject? {
    if (result.code == 401 || result.code == 403) {
      googleBlocked = true // key restricted / API not enabled: use the free maps
      return null
    }
    val body = result.body ?: return null
    return try {
      JSONObject(body)
    } catch (e: Exception) {
      null
    }
  }

  private fun text(o: JSONObject?, key: String): String {
    if (o == null || !o.has(key) || o.isNull(key)) return ""
    return o.optString(key, "").trim()
  }

  // ---- search ----

  fun search(query: String, nearLat: Double?, nearLon: Double?, token: String, state: CarState?): List<Suggestion> {
    val q = query.trim()
    if (q.length < 2) return emptyList()

    val key = googleKey(state)
    if (key.isNotEmpty()) {
      val body = JSONObject()
      body.put("input", q)
      body.put("sessionToken", token)
      if (nearLat != null && nearLon != null) {
        val center = JSONObject().put("latitude", nearLat).put("longitude", nearLon)
        val circle = JSONObject().put("center", center).put("radius", 50000)
        body.put("locationBias", JSONObject().put("circle", circle))
      }
      val g = google(
        Http.postJson(
          "https://places.googleapis.com/v1/places:autocomplete",
          mapOf("X-Goog-Api-Key" to key),
          body.toString()
        )
      )
      val list = g?.optJSONArray("suggestions")
      if (list != null) {
        val out = ArrayList<Suggestion>()
        for (i in 0 until list.length()) {
          val p = list.optJSONObject(i)?.optJSONObject("placePrediction") ?: continue
          val fmt = p.optJSONObject("structuredFormat")
          var title = text(fmt?.optJSONObject("mainText"), "text")
          if (title.isEmpty()) title = text(p.optJSONObject("text"), "text")
          val id = text(p, "placeId")
          if (title.isEmpty() || id.isEmpty()) continue
          out.add(Suggestion(id, title, text(fmt?.optJSONObject("secondaryText"), "text"), true, null, null))
          if (out.size >= 6) break
        }
        return out
      }
    }

    // free fallback: Photon (OpenStreetMap)
    val bias = if (nearLat != null && nearLon != null) {
      String.format(Locale.US, "&lat=%.5f&lon=%.5f", nearLat, nearLon)
    } else {
      ""
    }
    val res = Http.get("https://photon.komoot.io/api/?q=" + URLEncoder.encode(q, "UTF-8") + "&limit=6" + bias)
    val json = res.body ?: return emptyList()
    return try {
      val features = JSONObject(json).optJSONArray("features") ?: JSONArray()
      val out = ArrayList<Suggestion>()
      for (i in 0 until features.length()) {
        val f = features.optJSONObject(i) ?: continue
        val p = f.optJSONObject("properties") ?: JSONObject()
        val coords = f.optJSONObject("geometry")?.optJSONArray("coordinates")
        if (coords == null || coords.length() < 2) continue
        val name = text(p, "name")
        val street = text(p, "street")
        val house = text(p, "housenumber")
        val city = text(p, "city")
        val country = text(p, "country")
        var title = name
        if (title.isEmpty()) title = listOf(street, house).filter { it.isNotEmpty() }.joinToString(" ")
        if (title.isEmpty()) title = city
        if (title.isEmpty()) title = q
        val subtitle = listOf(if (street.isNotEmpty() && name.isNotEmpty()) street else "", city, country)
          .filter { it.isNotEmpty() }
          .joinToString(", ")
        out.add(Suggestion("osm-$i", title, subtitle, false, coords.optDouble(1), coords.optDouble(0)))
      }
      out
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun resolve(s: Suggestion, token: String, state: CarState?): CarPlace? {
    val lat = s.lat
    val lon = s.lon
    if (lat != null && lon != null && !lat.isNaN() && !lon.isNaN()) return CarPlace(s.title, s.subtitle, lat, lon)
    if (!s.google) return null
    val key = googleKey(state)
    if (key.isEmpty()) return null
    val j = google(
      Http.get(
        "https://places.googleapis.com/v1/places/" + URLEncoder.encode(s.id, "UTF-8") + "?sessionToken=" + token,
        mapOf("X-Goog-Api-Key" to key, "X-Goog-FieldMask" to "location,displayName,formattedAddress")
      )
    ) ?: return null
    val loc = j.optJSONObject("location") ?: return null
    val name = text(j.optJSONObject("displayName"), "text")
    val address = text(j, "formattedAddress")
    return CarPlace(
      if (name.isNotEmpty()) name else s.title,
      if (address.isNotEmpty()) address else s.subtitle,
      loc.optDouble("latitude"),
      loc.optDouble("longitude")
    )
  }

  // ---- route ----

  fun route(fromLat: Double, fromLon: Double, toLat: Double, toLon: Double, state: CarState?): CarRoute? {
    val key = googleKey(state)
    if (key.isNotEmpty()) {
      fun point(lat: Double, lon: Double): JSONObject {
        val latLng = JSONObject().put("latitude", lat).put("longitude", lon)
        return JSONObject().put("location", JSONObject().put("latLng", latLng))
      }
      val body = JSONObject()
        .put("origin", point(fromLat, fromLon))
        .put("destination", point(toLat, toLon))
        .put("travelMode", "DRIVE")
        .put("routingPreference", "TRAFFIC_AWARE")
      val g = google(
        Http.postJson(
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          mapOf(
            "X-Goog-Api-Key" to key,
            "X-Goog-FieldMask" to "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
          ),
          body.toString()
        )
      )
      val r = g?.optJSONArray("routes")?.optJSONObject(0)
      if (r != null && r.has("distanceMeters")) {
        val secs = text(r, "duration").replace("s", "").toDoubleOrNull() ?: 0.0
        val line = text(r.optJSONObject("polyline"), "encodedPolyline")
        return CarRoute(r.optDouble("distanceMeters") / 1000.0, secs / 60.0, decodePolyline(line))
      }
    }
    val res = Http.get(
      String.format(
        Locale.US,
        "https://router.project-osrm.org/route/v1/driving/%.6f,%.6f;%.6f,%.6f?overview=full&geometries=polyline",
        fromLon, fromLat, toLon, toLat
      )
    )
    val json = res.body ?: return null
    return try {
      val o = JSONObject(json).optJSONArray("routes")?.optJSONObject(0) ?: return null
      CarRoute(o.optDouble("distance") / 1000.0, o.optDouble("duration") / 60.0, decodePolyline(text(o, "geometry")))
    } catch (e: Exception) {
      null
    }
  }

  fun decodePolyline(str: String): List<DoubleArray> {
    val out = ArrayList<DoubleArray>()
    var index = 0
    var lat = 0
    var lng = 0
    try {
      while (index < str.length) {
        var b: Int
        var shift = 0
        var result = 0
        do {
          b = str[index++].code - 63
          result = result or ((b and 0x1f) shl shift)
          shift += 5
        } while (b >= 0x20)
        lat += if (result and 1 != 0) (result shr 1).inv() else result shr 1
        shift = 0
        result = 0
        do {
          b = str[index++].code - 63
          result = result or ((b and 0x1f) shl shift)
          shift += 5
        } while (b >= 0x20)
        lng += if (result and 1 != 0) (result shr 1).inv() else result shr 1
        out.add(doubleArrayOf(lat / 1e5, lng / 1e5))
      }
    } catch (e: Exception) {
      // cut-off line: keep what was read
    }
    return out
  }

  // ---- elevation ----

  /** Climb, descent and net height along the route (Open-Meteo), or null when not available. */
  fun hills(points: List<DoubleArray>): Hills? {
    if (points.size < 2) return null
    // sample evenly by distance, up to 300 points
    val cum = DoubleArray(points.size)
    for (i in 1 until points.size) {
      cum[i] = cum[i - 1] +
        Chargers.haversineKm(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    }
    val total = cum[cum.size - 1]
    val n = Math.max(2, Math.min(300, Math.round(total / 0.3).toInt()))
    val sample = ArrayList<DoubleArray>()
    var j = 0
    for (k in 0 until n) {
      val target = k * total / (n - 1)
      while (j < cum.size - 1 && cum[j + 1] < target) j++
      sample.add(points[Math.min(j + 1, points.size - 1)])
    }
    sample[0] = points[0]

    val el = ArrayList<Double>()
    var i = 0
    while (i < sample.size) {
      val batch = sample.subList(i, Math.min(sample.size, i + 100))
      val lat = batch.joinToString(",") { String.format(Locale.US, "%.5f", it[0]) }
      val lon = batch.joinToString(",") { String.format(Locale.US, "%.5f", it[1]) }
      val body = Http.get("https://api.open-meteo.com/v1/elevation?latitude=$lat&longitude=$lon").body ?: return null
      try {
        val arr = JSONObject(body).optJSONArray("elevation") ?: return null
        if (arr.length() != batch.size) return null
        for (x in 0 until arr.length()) {
          val v = arr.optDouble(x, Double.NaN)
          if (v.isNaN()) return null
          el.add(v)
        }
      } catch (e: Exception) {
        return null
      }
      i += 100
    }
    if (el.size < 2) return null

    // 3-point median against single spikes, 3 m hysteresis against flat-road wobble
    val sm = DoubleArray(el.size)
    for (x in el.indices) {
      sm[x] = if (x == 0 || x == el.size - 1) {
        el[x]
      } else {
        val w = doubleArrayOf(el[x - 1], el[x], el[x + 1])
        w.sort()
        w[1]
      }
    }
    var gain = 0.0
    var loss = 0.0
    var ref = sm[0]
    for (x in 1 until sm.size) {
      val d = sm[x] - ref
      if (d >= 3) {
        gain += d
        ref = sm[x]
      } else if (d <= -3) {
        loss -= d
        ref = sm[x]
      }
    }
    return Hills(
      Math.round(gain).toInt(),
      Math.round(loss).toInt(),
      Math.round(el[el.size - 1] - el[0]).toInt()
    )
  }

  // ---- estimate (same formula as estimateArrival in utils/maps.ts) ----

  private const val VEHICLE_MASS_KG = 2100.0

  fun elevationKwh(netM: Double): Double {
    val kwh = VEHICLE_MASS_KG * 9.81 * netM / 3.6e6
    return if (netM >= 0) kwh / 0.9 else kwh * 0.6
  }

  fun estimate(
    capacityKwh: Double, batteryPct: Double, consumption: Double, reservePct: Double, km: Double, netM: Double
  ): Arrival {
    val elevKwh = elevationKwh(netM)
    val needKwh = Math.max(0.0, km * consumption / 100.0 + elevKwh)
    val arrivalPct = if (capacityKwh > 0) batteryPct - needKwh / capacityKwh * 100.0 else batteryPct
    val status = if (arrivalPct >= reservePct + 5) {
      "ok"
    } else if (arrivalPct >= Math.max(0.0, reservePct)) {
      "tight"
    } else {
      "no"
    }
    var shortKm = 0.0
    if (arrivalPct < 0 && consumption > 0) {
      shortKm = -arrivalPct / 100.0 * capacityKwh / consumption * 100.0
    }
    return Arrival(arrivalPct, status, shortKm)
  }
}
