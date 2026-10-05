// App entry. The trip tracker must be imported before expo-router so the
// background location task is registered at module scope — required for the
// OS to deliver locations while the app is backgrounded or killed.
import './utils/tripTracker';
import 'expo-router/entry';
