import L from "leaflet";

// Leaflet 1.9.4 has no public continuous-zoom method. Use the same two internal
// methods as its touch-pinch handler: transform on each frame, project the
// detailed polygons only at the end (or to fill newly exposed areas on zoom-out).
type GestureMap = L.Map & {
  _move(center: L.LatLng, zoom: number, data: { pinch: boolean }): L.Map;
  _limitCenter(
    center: L.LatLng,
    zoom: number,
    bounds?: L.LatLngBoundsExpression,
  ): L.LatLng;
};

export function trackpadZoom(map: L.Map) {
  const m = map as GestureMap,
    container = m.getContainer();
  let frame = 0,
    timer = 0,
    delta = 0,
    moving = false;
  let point = L.point(0, 0),
    anchor = m.getCenter();
  let renderedZoom = m.getZoom(),
    lastRender = 0;

  const redraw = () => {
    renderedZoom = m.getZoom();
    lastRender = performance.now();
    m.fire("zoomend").fire("moveend");
  };
  const draw = () => {
    frame = 0;
    const zoom = Math.max(
      m.getMinZoom(),
      Math.min(m.getMaxZoom(), m.getZoom() + delta),
    );
    delta = 0;
    if (zoom === m.getZoom()) return;
    const offset = point.subtract(m.getSize().divideBy(2));
    const center = m.unproject(m.project(anchor, zoom).subtract(offset), zoom);
    m._move(m._limitCenter(center, zoom, m.options.maxBounds), zoom, {
      pinch: true,
    });
    // A long zoom-out exposes land beyond the old canvas; refresh it periodically.
    if (zoom < renderedZoom - 0.25 && performance.now() - lastRender >= 100)
      redraw();
  };
  const finish = () => {
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    if (!moving) return;
    draw();
    moving = false;
    redraw();
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY || !Number.isFinite(event.deltaY)) return;
    const cursor = m.mouseEventToContainerPoint(event);
    if (!moving) {
      m.stop();
      m.fire("zoomstart").fire("movestart");
      moving = true;
      renderedZoom = m.getZoom();
      lastRender = performance.now();
      anchor = m.containerPointToLatLng(cursor);
    } else if (!cursor.equals(point)) {
      anchor = m.containerPointToLatLng(cursor);
    }
    point = cursor;
    // Use CSS pixels directly: Leaflet otherwise divides Mac trackpad input by
    // 3 × pixel density. Pinch arrives as ctrl+wheel with smaller deltas.
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? container.clientHeight
          : 1;
    delta -= (event.deltaY * unit) / (event.ctrlKey ? 20 : 80);
    if (!frame) frame = requestAnimationFrame(draw);
    window.clearTimeout(timer);
    timer = window.setTimeout(finish, 100);
  };

  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("pointerdown", finish, true);
  container.addEventListener("keydown", finish, true);
  m.on("viewprereset", finish);
  return () => {
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("pointerdown", finish, true);
    container.removeEventListener("keydown", finish, true);
    m.off("viewprereset", finish);
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}
