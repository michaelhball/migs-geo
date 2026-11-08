import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Plus, Minus, Maximize, LocateFixed } from "lucide-react";

type Props = {
  geometry?: any;
  center?: number[];
  point?: number[] | null;
  onSelect?: (point: number[]) => void;
  active?: boolean;
  explore?: boolean;
  name?: string;
  resetKey?: string;
};
export type MapHandle = { home: () => void; focus: () => void };
let worldPromise: Promise<any> | undefined;
export const Atlas = forwardRef<MapHandle, Props>(function Atlas(props, ref) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    answer = useRef<L.LayerGroup | null>(null),
    pin = useRef<L.LayerGroup | null>(null),
    latest = useRef(props);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  latest.current = props;
  const home = () =>
    map.current?.fitBounds(
      [
        [-60, -180],
        [84, 180],
      ],
      { padding: [16, 16], animate: false },
    );
  const focus = () => {
    const m = map.current,
      g = latest.current.geometry;
    if (!m || !g) return;
    if (g.type === "Point") {
      m.setView([g.coordinates[1], g.coordinates[0]], 4, { animate: false });
      return;
    }
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    // Frame the largest component so overseas territories and the date line do not
    // force a distant world-wide view. Every component is still rendered.
    const ring = polys
      .map((p: any) => p[0])
      .sort((a: any, b: any) => polygonArea(b) - polygonArea(a))[0];
    const bounds = L.latLngBounds(ring.map((p: number[]) => [p[1], p[0]]));
    m.fitBounds(bounds, { padding: [80, 80], maxZoom: 7, animate: false });
  };
  useImperativeHandle(ref, () => ({ home, focus }));
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      crs: L.CRS.EPSG4326,
      zoomControl: false,
      attributionControl: false,
      minZoom: 0.5,
      maxZoom: 12,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      preferCanvas: true,
      maxBounds: [
        [-90, -200],
        [90, 200],
      ],
      maxBoundsViscosity: 0.85,
      scrollWheelZoom: true,
      // Trackpads need less movement than Leaflet's default 60 px per level.
      wheelPxPerZoomLevel: 20,
      wheelDebounceTime: 20,
      doubleClickZoom: false,
    });
    map.current = m;
    home();
    m.createPane("grid");
    m.getPane("grid")!.style.zIndex = "210";
    m.createPane("answers");
    m.getPane("answers")!.style.zIndex = "420";
    m.createPane("pins");
    m.getPane("pins")!.style.zIndex = "450";
    for (let lon = -180; lon <= 180; lon += 30)
      L.polyline(
        [
          [-90, lon],
          [90, lon],
        ],
        {
          pane: "grid",
          color: "#c5d8dc",
          weight: 0.7,
          opacity: 0.6,
          interactive: false,
        },
      ).addTo(m);
    for (let lat = -60; lat <= 60; lat += 30)
      L.polyline(
        [
          [lat, -180],
          [lat, 180],
        ],
        {
          pane: "grid",
          color: "#c5d8dc",
          weight: 0.7,
          opacity: 0.6,
          interactive: false,
        },
      ).addTo(m);
    answer.current = L.layerGroup().addTo(m);
    pin.current = L.layerGroup().addTo(m);
    let mounted = true;
    worldPromise ??= fetch("/data/world.json")
      .then((r) => {
        if (!r.ok) throw Error("Could not load the map. Reload to try again.");
        return r.json();
      })
      .catch((e) => {
        worldPromise = undefined;
        throw e;
      });
    worldPromise
      .then((world) => {
        if (!mounted) return;
        L.geoJSON(world, {
          style: {
            color: "#8d9a93",
            weight: 0.65,
            fillColor: "#faf9f2",
            fillOpacity: 1,
          },
          onEachFeature: (feature, layer) => {
            layer.on("mouseover", () => {
              if (latest.current.explore) {
                (layer as L.Path).setStyle({ fillColor: "#dce4d9" });
                layer
                  .bindTooltip(feature.properties.name, {
                    sticky: true,
                    className: "map-tooltip",
                  })
                  .openTooltip();
              }
            });
            layer.on("mouseout", () => {
              (layer as L.Path).setStyle({ fillColor: "#faf9f2" });
              layer.unbindTooltip();
            });
          },
        }).addTo(m);
        setReady(true);
      })
      .catch((e) => mounted && setError(e.message));
    m.on("click", (event: L.LeafletMouseEvent) => {
      if (latest.current.active)
        latest.current.onSelect?.([
          Math.max(-180, Math.min(180, event.latlng.lng)),
          event.latlng.lat,
        ]);
    });
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(element.current);
    return () => {
      mounted = false;
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const group = answer.current;
    if (!group) return;
    group.clearLayers();
    if (props.geometry) {
      L.geoJSON(props.geometry, {
        pane: "answers",
        interactive: false,
        style: {
          color: "#307058",
          weight: 2,
          fillColor: "#76a489",
          fillOpacity: 0.72,
        },
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, {
            pane: "answers",
            radius: 12,
            color: "#307058",
            weight: 2,
            fillColor: "#76a489",
            fillOpacity: 0.7,
          }),
      }).addTo(group);
      focus();
    } else home();
  }, [props.geometry, props.resetKey, ready]);
  useEffect(() => {
    pin.current?.clearLayers();
    if (props.point && pin.current) {
      const ll: L.LatLngExpression = [props.point[1], props.point[0]];
      L.circleMarker(ll, {
        pane: "pins",
        radius: 9,
        color: "#fff",
        weight: 3,
        fillColor: "#bd673f",
        fillOpacity: 1,
        interactive: false,
      }).addTo(pin.current);
      L.circleMarker(ll, {
        pane: "pins",
        radius: 11,
        color: "#bd673f",
        weight: 1,
        fillOpacity: 0,
        interactive: false,
      }).addTo(pin.current);
    }
  }, [props.point]);
  return (
    <div className={"atlas " + (props.active ? "selectable" : "")}>
      <div
        ref={element}
        className="map-canvas"
        aria-label="Interactive world map. Drag to pan; scroll or use plus and minus to zoom."
        tabIndex={0}
      />
      <div className="map-tools">
        <button
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={18} />
        </button>
        <span />
        <button aria-label="Show world" title="Show world" onClick={home}>
          <Maximize size={17} />
        </button>
        {props.geometry && (
          <button
            aria-label="Show highlighted place"
            title="Show highlighted place"
            onClick={focus}
          >
            <LocateFixed size={18} />
          </button>
        )}
      </div>
      {props.active && (
        <button
          className="center-select"
          onClick={() => {
            const c = map.current?.getCenter();
            if (c) props.onSelect?.([c.lng, c.lat]);
          }}
        >
          Select map center
        </button>
      )}
      {props.active && (
        <div className="map-crosshair" aria-hidden="true">
          +
        </div>
      )}
      <div className="map-legend">
        <span className={props.geometry ? "legend-answer" : "legend-land"} />
        {props.geometry ? props.name || "Highlighted place" : "Unlabeled map"}
        {props.point && (
          <>
            <span className="legend-pin" />
            Your selection
          </>
        )}
      </div>
      <div className="attribution">
        <a
          href="https://www.naturalearthdata.com/"
          target="_blank"
          rel="noreferrer"
        >
          Natural Earth
        </a>{" "}
        ·{" "}
        <a href="https://leafletjs.com" target="_blank" rel="noreferrer">
          Leaflet
        </a>
      </div>
      {!ready && !error && <div className="map-loading">Loading map…</div>}
      {error && <div className="map-loading error">{error}</div>}
    </div>
  );
});
function polygonArea(r: number[][]) {
  return Math.abs(
    r.reduce((a, p, i) => {
      const q = r[(i + 1) % r.length];
      return a + p[0] * q[1] - q[0] * p[1];
    }, 0) / 2,
  );
}
