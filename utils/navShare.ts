/** Chargers the drive map is showing, handed to the navigation screen so it shows the same ones. */
export type NavCharger = { lat: number; lon: number; label: string };
let chargers: NavCharger[] = [];
export function setNavChargers(list: NavCharger[]) {
  chargers = list;
}
export function getNavChargers(): NavCharger[] {
  return chargers;
}
