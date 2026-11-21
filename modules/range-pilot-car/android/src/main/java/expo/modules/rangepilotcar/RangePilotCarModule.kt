package expo.modules.rangepilotcar

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app hands its latest battery, range and position to the car screen and
 * to the floating bubble here. The car screen (RangePilotCarService) can run
 * while the app's JS is not running, so the state is kept in SharedPreferences.
 */
class RangePilotCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RangePilotCar")

    Function("setState") { json: String ->
      val context = appContext.reactContext
      if (context != null) {
        CarStore.write(context, json)
        Bubble.refresh()
      }
    }

    // ---- floating range bubble over other apps ----

    Function("bubbleAllowed") {
      val context = appContext.reactContext
      if (context != null) Bubble.allowed(context) else false
    }

    Function("openBubblePermission") {
      val context = appContext.reactContext
      if (context != null) Bubble.openPermission(context)
    }

    Function("showBubble") {
      val context = appContext.reactContext
      if (context != null) Bubble.show(context)
    }

    Function("hideBubble") {
      val context = appContext.reactContext
      if (context != null) Bubble.hide(context)
    }

    // Reserve picked on the car screen since the last call, or -1.
    Function("takeReserve") {
      val context = appContext.reactContext
      if (context != null) CarStore.takePendingReserve(context) else -1
    }

    // Destination picked (JSON) or cleared ({"clear":true}) on the car screen since the last call, or "".
    Function("takeDestination") {
      val context = appContext.reactContext
      if (context != null) CarStore.takePendingDestination(context) else ""
    }
  }
}
