/** Keep ordinary wheel gestures available to the page or scroll container. */
export function isWheelZoomGesture(event: {ctrlKey:boolean;deltaY:number}):boolean {
  return event.ctrlKey && event.deltaY !== 0;
}
