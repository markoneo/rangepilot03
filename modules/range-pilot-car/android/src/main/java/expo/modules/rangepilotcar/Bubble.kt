package expo.modules.rangepilotcar

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager

/**
 * The floating range bubble: a small dial (range, battery %) that stays on top
 * of other apps — Google Maps, Waze — while a drive is running and Range Pilot
 * is in the background. Drag it anywhere; a tap opens Range Pilot.
 * Needs the "display over other apps" permission, which the user grants once.
 */
object Bubble {
  private const val PREFS = "rangepilot_bubble"
  private val main = Handler(Looper.getMainLooper())
  private var view: BubbleView? = null

  fun allowed(context: Context): Boolean {
    return try {
      Settings.canDrawOverlays(context)
    } catch (e: Exception) {
      false
    }
  }

  /** Opens the system screen where the user allows the bubble. */
  fun openPermission(context: Context) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + context.packageName)
      )
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    } catch (e: Exception) {
      // no such screen on this phone
    }
  }

  fun show(context: Context) {
    val app = context.applicationContext
    main.post {
      if (view != null || !allowed(app)) return@post
      try {
        val wm = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val density = app.resources.displayMetrics.density
        val size = (84 * density).toInt()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
          @Suppress("DEPRECATION")
          WindowManager.LayoutParams.TYPE_PHONE
        }
        val params = WindowManager.LayoutParams(
          size, size, type,
          WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
          PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val screenW = app.resources.displayMetrics.widthPixels
        params.x = prefs.getInt("x", screenW - size - (12 * density).toInt())
        params.y = prefs.getInt("y", (120 * density).toInt())
        val v = BubbleView(app, wm, params)
        wm.addView(v, params)
        view = v
      } catch (e: Exception) {
        view = null
      }
    }
  }

  fun hide(context: Context) {
    val app = context.applicationContext
    main.post {
      val v = view ?: return@post
      view = null
      try {
        (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v)
      } catch (e: Exception) {
        // already gone
      }
    }
  }

  /** New numbers from the app: redraw. */
  fun refresh() {
    main.post { view?.invalidate() }
  }

  internal fun savePosition(context: Context, x: Int, y: Int) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("x", x).putInt("y", y).apply()
  }
}

@SuppressLint("ViewConstructor")
internal class BubbleView(
  context: Context,
  private val wm: WindowManager,
  private val params: WindowManager.LayoutParams
) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val oval = RectF()
  private var downX = 0f
  private var downY = 0f
  private var startX = 0
  private var startY = 0
  private var dragged = false

  override fun onDraw(canvas: Canvas) {
    val w = width.toFloat()
    val h = height.toFloat()
    val r = Math.min(w, h) / 2f
    val state = CarStore.read(context)

    paint.style = Paint.Style.FILL
    paint.color = 0xF00B0E11.toInt()
    canvas.drawCircle(w / 2, h / 2, r, paint)

    val stroke = r * 0.13f
    val inset = stroke / 2 + r * 0.06f
    oval.set(inset, inset, w - inset, h - inset)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = stroke
    paint.strokeCap = Paint.Cap.ROUND
    paint.color = 0xFF1B2229.toInt()
    canvas.drawArc(oval, 0f, 360f, false, paint)

    paint.style = Paint.Style.FILL
    paint.textAlign = Paint.Align.CENTER
    if (state == null) {
      paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      paint.color = 0xFFF2F5F7.toInt()
      paint.textSize = r * 0.5f
      canvas.drawText("RP", w / 2, h / 2 + r * 0.18f, paint)
      return
    }
    val color = RingImage.ringColor(state.usable)
    val pct = Math.max(0.0, Math.min(100.0, state.battery)).toFloat()
    if (pct > 0f) {
      paint.style = Paint.Style.STROKE
      paint.color = color
      canvas.drawArc(oval, -90f, 360f * pct / 100f, false, paint)
      paint.style = Paint.Style.FILL
    }
    val km = Math.round(Math.max(0.0, state.rangeKm)).toString()
    paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    paint.color = 0xFFF2F5F7.toInt()
    paint.textSize = if (km.length >= 4) r * 0.5f else r * 0.62f
    canvas.drawText(km, w / 2, h / 2 + r * 0.06f, paint)
    paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    paint.color = 0xFF8B95A1.toInt()
    paint.textSize = r * 0.24f
    canvas.drawText("km", w / 2, h / 2 + r * 0.32f, paint)
    paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    paint.color = color
    paint.textSize = r * 0.27f
    canvas.drawText(Math.round(state.battery).toString() + "%", w / 2, h / 2 + r * 0.62f, paint)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.rawX
        downY = event.rawY
        startX = params.x
        startY = params.y
        dragged = false
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - downX
        val dy = event.rawY - downY
        val slop = 8 * resources.displayMetrics.density
        if (!dragged && (Math.abs(dx) > slop || Math.abs(dy) > slop)) dragged = true
        if (dragged) {
          params.x = startX + dx.toInt()
          params.y = startY + dy.toInt()
          try {
            wm.updateViewLayout(this, params)
          } catch (e: Exception) {
            // view was removed meanwhile
          }
        }
      }
      MotionEvent.ACTION_UP -> {
        if (dragged) {
          Bubble.savePosition(context, params.x, params.y)
        } else {
          // tap: back to Range Pilot
          try {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (intent != null) {
              intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
              context.startActivity(intent)
            }
          } catch (e: Exception) {
            // nothing to open
          }
        }
      }
    }
    return true
  }
}
