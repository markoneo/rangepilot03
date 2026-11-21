package expo.modules.rangepilotcar

import java.net.HttpURLConnection
import java.net.URL

/** Small blocking HTTP helper — call from a background thread. Returns null on any failure. */
object Http {
  class Result(val code: Int, val body: String?)

  fun get(url: String, headers: Map<String, String> = emptyMap()): Result {
    return request("GET", url, headers, null)
  }

  fun postJson(url: String, headers: Map<String, String>, json: String): Result {
    return request("POST", url, headers + mapOf("Content-Type" to "application/json"), json)
  }

  private fun request(method: String, url: String, headers: Map<String, String>, body: String?): Result {
    var conn: HttpURLConnection? = null
    try {
      conn = URL(url).openConnection() as HttpURLConnection
      conn.requestMethod = method
      conn.connectTimeout = 10000
      conn.readTimeout = 12000
      conn.setRequestProperty("User-Agent", "RangePilot-AndroidAuto")
      conn.setRequestProperty("Accept", "application/json")
      for ((k, v) in headers) conn.setRequestProperty(k, v)
      if (body != null) {
        conn.doOutput = true
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val code = conn.responseCode
      if (code !in 200..299) return Result(code, null)
      val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
      return Result(code, text)
    } catch (e: Exception) {
      return Result(0, null)
    } finally {
      try {
        conn?.disconnect()
      } catch (e: Exception) {
        // ignore
      }
    }
  }
}
