package expo.modules.rangepilotcar

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The app hands its latest battery, range and position to the car screen here.
 * The car screen (RangePilotCarService) can run while the app's JS is not
 * running, so the state is kept in SharedPreferences.
 */
class RangePilotCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RangePilotCar")

    Function("setState") { json: String ->
      val context = appContext.reactContext
      if (context != null) {
        CarStore.write(context, json)
      }
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
