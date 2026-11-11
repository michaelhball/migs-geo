import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { trackpadZoom } from "./trackpadZoom";
import { worldDetail } from "./worldDetail";
import { Plus, Minus, Maximize, LocateFixed } from "lucide-react";

type Props = {
  geometry?: any;
  center?: number[];
  point?: number[] | null;
  onSelect?: (point: number[]) => void;
  active?: boolean;
  explore?: boolean;
  name?: string;
  kind?: string;
  resetKey?: string;
  revealed?: boolean;
  correct?: boolean | null;
};
export type MapHandle = { home: () => void; focus: () => void };
const highlightStyles = {
  correct: { color: "#307058", fillColor: "#76a489", legend: "legend-answer" },
  incorrect: {
    color: "#bc4141",
    fillColor: "#df7771",
    legend: "legend-revealed",
  },
  neutral: { color: "#98763c", fillColor: "#d7bf8d", legend: "legend-neutral" },
};
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
  const tone =
    !props.revealed || props.correct === true
      ? "correct"
      : props.correct === false
        ? "incorrect"
        : "neutral";
  const home = () =>
    map.current?.fitBounds(
      [
        [-60, -180],
        [84, 180],
      ],
      { padding: [16, 16], animate: false },
    );
  const framePlace = (context = false) => {
    const m = map.current,
      g = latest.current.geometry;
    if (!m || !g) return;
    if (g.type === "Point") {
      m.setView([g.coordinates[1], g.coordinates[0]], context ? 3 : 4, {
        animate: false,
      });
      return;
    }
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const allBounds = L.latLngBounds(
      polys.flatMap((p: number[][][]) =>
        p[0].map((c) => [c[1], c[0]] as L.LatLngTuple),
      ),
    );
    // Pacific regions span the date-line edges of this world map. Show both
    // sides together instead of cropping away half of the highlighted region.
    if (
      latest.current.kind === "region" &&
      allBounds.getEast() - allBounds.getWest() > 180
    ) {
      m.fitBounds(allBounds, { padding: [32, 32], animate: false });
      return;
    }
    // Frame the largest component so overseas territories and the date line do not
    // force a distant world-wide view. Every component is still rendered.
    const ring = polys
      .map((p: any) => p[0])
      .sort((a: any, b: any) => polygonArea(b) - polygonArea(a))[0];
    const bounds = L.latLngBounds(ring.map((p: number[]) => [p[1], p[0]]));
    m.fitBounds(context ? bounds.pad(0.75) : bounds, {
      padding: [80, 80],
      maxZoom: context ? 4 : 7,
      animate: false,
    });
  };
  const focus = () => framePlace();
  useImperativeHandle(ref, () => ({ home, focus }));
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, {
      crs: L.CRS.EPSG4326,
      zoomControl: false,
      attributionControl: false,
      minZoom: 0.5,
      maxZoom: 12,
      zoomSnap: 0,
      zoomDelta: 0.5,
      zoomAnimation: false,
      preferCanvas: true,
      maxBounds: [
        [-90, -200],
        [90, 200],
      ],
      maxBoundsViscosity: 0.85,
      scrollWheelZoom: false,
      doubleClickZoom: false,
    });
    map.current = m;
    home();
    const removeTrackpadZoom = trackpadZoom(m);
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
        const details: (() => void)[] = [];
        // Update detail before the renderer projects the next settled view.
        m.on("zoomend", () => details.forEach((update) => update()));
        L.geoJSON(world, {
          style: {
            color: "#8d9a93",
            weight: 0.65,
            fillColor: "#faf9f2",
            fillOpacity: 1,
          },
          onEachFeature: (feature, layer) => {
            if (layer instanceof L.Polygon)
              details.push(worldDetail(m, layer, feature));
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
      removeTrackpadZoom();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const group = answer.current;
    if (!group) return;
    group.clearLayers();
    if (props.geometry) {
      const { color, fillColor } = highlightStyles[tone];
      const highlight = L.geoJSON(props.geometry, {
        pane: "answers",
        interactive: false,
        style: {
          color,
          weight: 2,
          fillColor,
          fillOpacity: 0.72,
        },
        pointToLayer: (_f, latlng) =>
          L.circleMarker(latlng, {
            pane: "answers",
            radius: 12,
            color,
            weight: 2,
            fillColor,
            fillOpacity: 0.7,
          }),
      }).addTo(group);
      // Keep tiny territories visible in the wider question view without
      // replacing their actual outline or forcing the map to zoom closer.
      const m = map.current;
      if (m && props.geometry.type !== "Point") {
        const bounds = highlight.getBounds();
        const halo = L.circleMarker(bounds.getCenter(), {
          pane: "answers",
          radius: 8,
          color,
          weight: 2,
          fill: false,
          interactive: false,
        });
        const updateHalo = () => {
          const size = m
            .latLngToContainerPoint(bounds.getNorthEast())
            .subtract(m.latLngToContainerPoint(bounds.getSouthWest()));
          if (Math.abs(size.x) < 12 && Math.abs(size.y) < 12)
            group.addLayer(halo);
          else group.removeLayer(halo);
        };
        updateHalo();
        m.on("zoomend", updateHalo);
        return () => {
          m.off("zoomend", updateHalo);
        };
      }
    }
  }, [props.geometry, tone]);
  useEffect(() => {
    // Reveal only adds the answer overlay. Preserve the user's exact viewport
    // and selection; the focus control remains available for deliberate zooming.
    if (props.revealed) return;
    if (props.geometry) framePlace(!props.explore);
    else home();
  }, [props.geometry, props.resetKey, props.revealed, props.explore, ready]);
  useEffect(() => {
    const group = pin.current,
      m = map.current;
    group?.clearLayers();
    if (props.point && group && m) {
      const ll: L.LatLngExpression = [props.point[1], props.point[0]];
      const marker = L.marker(ll, {
        pane: "pins",
        icon: L.divIcon({
          className: "selection-marker",
          html: '<span class="selection-marker-dot"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(group);
      // A separate DOM marker stays anchored and scales on every zoom frame
      // without redrawing the detailed map. Keep a small visible minimum.
      const resizePin = () => {
        const scale = Math.max(0.35, Math.min(1, 2 ** ((m.getZoom() - 7) / 3)));
        marker.getElement()?.style.setProperty("--pin-scale", String(scale));
      };
      resizePin();
      m.on("zoom", resizePin);
      return () => {
        m.off("zoom", resizePin);
      };
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
        <span
          className={
            props.geometry ? highlightStyles[tone].legend : "legend-land"
          }
        />
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
