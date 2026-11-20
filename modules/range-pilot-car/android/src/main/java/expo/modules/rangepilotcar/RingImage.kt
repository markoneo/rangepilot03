package expo.modules.rangepilotcar

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface

/**
 * The range dial from the phone's drive screen as a picture for the car:
 * the arc is the battery left, the number is the range, green → amber → red.
 * (The car screen cannot be drawn on directly, only pictures can be shown.)
 */
object RingImage {
  private const val BG = 0xFF0B0E11.toInt()
  private const val TRACK = 0xFF1B2229.toInt()
  private const val CARD = 0xFF12161B.toInt()
  private const val TEXT = 0xFFF2F5F7.toInt()
  private const val DIM = 0xFF8B95A1.toInt()
  private const val GREEN = 0xFF34D17A.toInt()
  private const val AMBER = 0xFFF59E0B.toInt()
  private const val RED = 0xFFEF4444.toInt()

  private fun mix(a: Int, b: Int, t: Double): Int {
    val k = Math.max(0.0, Math.min(1.0, t))
    val r = Math.round(Color.red(a) + (Color.red(b) - Color.red(a)) * k).toInt()
    val g = Math.round(Color.green(a) + (Color.green(b) - Color.green(a)) * k).toInt()
    val bl = Math.round(Color.blue(a) + (Color.blue(b) - Color.blue(a)) * k).toInt()
    return Color.rgb(r, g, bl)
  }

  /** Same rule as utils/ringColor.ts. */
  fun ringColor(usablePct: Double): Int {
    if (usablePct >= 40) return GREEN
    if (usablePct >= 20) return mix(AMBER, GREEN, (usablePct - 20) / 20)
    if (usablePct >= 5) return mix(RED, AMBER, (usablePct - 5) / 15)
    return RED
  }

  /**
   * 600 x 580: the dial on top, below it two tiles — consumption and the km
   * one gets per 10 % of battery.
   */
  fun draw(rangeKm: Long, batteryPct: Long, usablePct: Double, consumption: Double, per10Km: Long): Bitmap {
    val w = 600f
    val h = 580f
    val bmp = Bitmap.createBitmap(w.toInt(), h.toInt(), Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    val color = ringColor(usablePct)
    val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    val normal = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)

    // dark tile, so the dial reads the same on a light (day) car theme
    p.style = Paint.Style.FILL
    p.color = BG
    c.drawRoundRect(RectF(0f, 0f, w, h), 52f, 52f, p)

    // dial
    val cx = w / 2
    val cy = 216f
    val r = 168f
    val oval = RectF(cx - r, cy - r, cx + r, cy + r)
    p.style = Paint.Style.STROKE
    p.strokeWidth = 30f
    p.color = TRACK
    c.drawArc(oval, 0f, 360f, false, p)
    val pct = Math.max(0L, Math.min(100L, batteryPct))
    if (pct > 0) {
      p.color = color
      p.strokeCap = Paint.Cap.ROUND
      c.drawArc(oval, -90f, 360f * pct / 100f, false, p)
    }

    p.style = Paint.Style.FILL
    p.textAlign = Paint.Align.CENTER
    p.typeface = bold
    p.color = TEXT
    val km = Math.max(0L, rangeKm).toString()
    p.textSize = if (km.length >= 4) 108f else 136f
    c.drawText(km, cx, cy + 24f, p)
    p.typeface = normal
    p.color = DIM
    p.textSize = 32f
    c.drawText("km range", cx, cy + 68f, p)
    p.typeface = bold
    p.color = color
    p.textSize = 38f
    c.drawText("$pct%", cx, cy + 120f, p)

    // tiles
    val top = 424f
    val bottom = 552f
    tile(c, p, 28f, top, 290f, bottom, String.format(java.util.Locale.US, "%.1f", consumption), "kWh/100 km", bold, normal)
    tile(c, p, 310f, top, 572f, bottom, "$per10Km km", "per 10% battery", bold, normal)
    return bmp
  }

  private fun tile(
    c: Canvas, p: Paint, l: Float, t: Float, r: Float, b: Float,
    value: String, label: String, bold: Typeface, normal: Typeface
  ) {
    p.style = Paint.Style.FILL
    p.color = CARD
    c.drawRoundRect(RectF(l, t, r, b), 24f, 24f, p)
    p.textAlign = Paint.Align.LEFT
    p.typeface = bold
    p.color = TEXT
    p.textSize = 48f
    c.drawText(value, l + 26f, t + 62f, p)
    p.typeface = normal
    p.color = GREEN
    p.textSize = 25f
    c.drawText(label, l + 26f, t + 102f, p)
  }

  /**
   * 420 x 420: the battery now (dim arc) and what is left on arrival (bright
   * arc) for "Can I make it?" — green when it reaches, amber when tight, red when not.
   */
  fun drawArrival(batteryPct: Double, arrivalPct: Double, status: String): Bitmap {
    val size = 420f
    val bmp = Bitmap.createBitmap(size.toInt(), size.toInt(), Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    val color = if (status == "ok") GREEN else if (status == "tight") AMBER else RED

    p.style = Paint.Style.FILL
    p.color = BG
    c.drawRoundRect(RectF(0f, 0f, size, size), 48f, 48f, p)

    val inset = 58f
    val oval = RectF(inset, inset, size - inset, size - inset)
    p.style = Paint.Style.STROKE
    p.strokeWidth = 28f
    p.color = TRACK
    c.drawArc(oval, 0f, 360f, false, p)
    p.strokeCap = Paint.Cap.ROUND
    val now = Math.max(0.0, Math.min(100.0, batteryPct)).toFloat()
    if (now > 0f) {
      p.color = mix(BG, color, 0.35)
      c.drawArc(oval, -90f, 360f * now / 100f, false, p)
    }
    val left = Math.max(0.0, Math.min(100.0, arrivalPct)).toFloat()
    if (left > 0f) {
      p.color = color
      c.drawArc(oval, -90f, 360f * left / 100f, false, p)
    }

    p.style = Paint.Style.FILL
    p.textAlign = Paint.Align.CENTER
    p.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    p.color = if (status == "no") RED else TEXT
    p.textSize = 104f
    c.drawText(Math.round(Math.max(0.0, arrivalPct)).toString() + "%", size / 2, size / 2 + 24f, p)
    p.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    p.color = DIM
    p.textSize = 30f
    c.drawText("on arrival", size / 2, size / 2 + 72f, p)
    return bmp
  }
}
