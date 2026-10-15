type Point = { x: number; y: number };

// Keep the same world point underneath the moving pinch midpoint.
export function zoomMoment(
  camera: Point & { zoom: number },
  requestedZoom: number,
  anchor: Point,
  destination = anchor,
) {
  const zoom = Math.max(0.45, Math.min(2.5, requestedZoom));
  const ratio = zoom / camera.zoom;
  return {
    x: destination.x - (anchor.x - camera.x) * ratio,
    y: destination.y - (anchor.y - camera.y) * ratio,
    zoom,
  };
}
