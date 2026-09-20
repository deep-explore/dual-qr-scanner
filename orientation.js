// Which way is world-up in the camera frame?
//
// Mobile browsers hand back frames already rotated to the interface
// orientation, so while the phone is held upright, world-up is image-up and a
// standing bottle or can has a vertical axis. Tilt the phone flat over a table
// and that stops being true, so the hint goes quiet rather than guessing.
//
// This only ever narrows the search order — it never removes candidates, so a
// pipe lying on its side is still found, just a little later. On the reference
// photographs every successful candidate was a vertical-axis one, which is the
// case this skips straight to.
//
// iOS requires an explicit permission prompt for motion events. We never ask:
// where permission has not been granted no events arrive, the hint stays null
// and the sweep keeps its default order.

const UPRIGHT_MIN_DEG = 30;
const UPRIGHT_MAX_DEG = 150;

export function createAxisHint() {
  let axis = null;

  const onOrientation = (event) => {
    const beta = event.beta; // front-to-back tilt in degrees
    if (typeof beta !== "number" || Number.isNaN(beta)) return;
    const tilt = Math.abs(beta);
    axis = tilt > UPRIGHT_MIN_DEG && tilt < UPRIGHT_MAX_DEG ? "v" : null;
  };

  const supported = typeof window !== "undefined" && "ondeviceorientation" in window;
  if (supported) window.addEventListener("deviceorientation", onOrientation);

  return {
    get: () => axis,
    stop: () => {
      if (supported) window.removeEventListener("deviceorientation", onOrientation);
    },
  };
}
