import {
  lazy, Suspense, useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { trackpadZoom } from "./trackpadZoom";
import { countryFrame } from "./countryFrame";
import { indexCountryBoundaries, type CountryBoundary } from "./mapBoundaries";
import { worldDetail } from "./worldDetail";
import { Plus, Minus, Maximize, LocateFixed } from "lucide-react";

import type { TerrainView } from "./Terrain";
const Terrain = lazy(() => import("./Terrain"));

type Props = {
  geometry?: any;
  center?: number[];
  trace?: number[][];
  point?: number[] | null;
  onSelect?: (point: number[]) => void;
  active?: boolean;
  explore?: boolean;
  name?: string;
  kind?: string;
  usStateId?: string;
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
const worldOffsets = [-360, 0, 360];
const shiftCoordinates = (offset: number) => (c: number[]) =>
  L.latLng(c[1], c[0] + offset);

let worldPromise: Promise<any> | undefined;
export const Atlas = forwardRef<MapHandle, Props>(function Atlas(props, ref) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    countryBoundary = useRef<ReturnType<typeof indexCountryBoundaries> | null>(null),
    answer = useRef<L.LayerGroup | null>(null),
    pin = useRef<L.LayerGroup | null>(null),
    latest = useRef(props);
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  const [relief, setRelief] = useState(false);
  const [regionalZoom, setRegionalZoom] = useState(false);
  const [terrain, setTerrain] = useState<TerrainView | null>(null);
  useEffect(() => { setTerrain(null); }, [props.resetKey]);
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
    if (g.type === "MultiLineString") {
      const bounds = L.latLngBounds(g.coordinates.flat().map(([x,y]:number[]) => [y,x]));
      m.fitBounds(context ? bounds.pad(0.5) : bounds, {padding:[45,45],maxZoom:7});
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
      const pacific = L.latLngBounds(polys.flatMap((p: number[][][]) =>
        p[0].map(([lon, lat]) => [lat, lon < 0 ? lon + 360 : lon] as L.LatLngTuple),
      ));
      m.fitBounds(pacific.getEast() - pacific.getWest() < 180 ? pacific : allBounds,
        { padding: [48, 48], animate: false });
      return;
    }
    const frame = countryFrame(polys.map((p: number[][][]) => p[0]));
    const bounds = L.latLngBounds([frame.south, frame.west], [frame.north, frame.east]);
    m.fitBounds(context ? bounds.pad(0.75) : bounds, {
      padding: [80, 80],
      maxZoom: context ? 4 : 7,
      animate: false,
    });
  };
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !relief) return;
    const options: L.TileLayerOptions = {
      pane: "relief", tileSize: 256, maxZoom: 12, keepBuffer: 3,
      updateWhenIdle: false, updateWhenZooming: false,
    };
    const layers = [
      L.tileLayer("/data/terrain/world/{z}/{x}/{y}.webp", {
        ...options, maxNativeZoom: 4,
      }).addTo(m),
      L.tileLayer("/data/terrain/nz/{z}/{x}/{y}.webp", {
        ...options, minZoom: 5, minNativeZoom: 5, maxNativeZoom: 6,
        bounds: [[-48,165],[-33,179]],
      }).addTo(m),
    ];
    return () => { layers.forEach(layer => layer.remove()); };
  }, [ready, relief]);
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
        [-90, -360],
        [90, 360],
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
    m.on("zoomend", () => setRegionalZoom(m.getZoom() >= 3));
    m.createPane("relief");
    m.getPane("relief")!.style.zIndex = "410";
    m.getPane("relief")!.style.pointerEvents = "none";
    m.createPane("lakes");
    m.getPane("lakes")!.style.zIndex = "415";
    m.getPane("lakes")!.style.pointerEvents = "none";
    m.createPane("answers");
    m.getPane("answers")!.style.zIndex = "420";
    m.createPane("divisions");
    m.getPane("divisions")!.style.zIndex = "425";
    m.getPane("divisions")!.style.pointerEvents = "none";
    m.createPane("pins");
    m.getPane("pins")!.style.zIndex = "450";
    for (let lon = -540; lon <= 540; lon += 30)
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
          [lat, -540],
          [lat, 540],
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
        countryBoundary.current = indexCountryBoundaries(world);
        const groups: CountryBoundary[] = world.boundaries;
        const grouped = new Set(groups.flatMap(group => group.members.map(i => world.features[i])));
        const details: (() => void)[] = [];
        // Update detail before the renderer projects the next settled view.
        m.on("zoomend", () => details.forEach((update) => update()));
        for (const offset of worldOffsets) {
          L.geoJSON(world, {
            coordsToLatLng: shiftCoordinates(offset),
            style: feature => ({
              stroke: !grouped.has(feature),
              color: "#8d9a93",
              weight: 0.65,
              fillColor: "#faf9f2",
              fillOpacity: 1,
            }),
            onEachFeature: (feature, layer) => {
              if (layer instanceof L.Polygon)
                details.push(worldDetail(m, layer, offset === 0 ? feature : layer));
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
          for (const band of world.lakes) {
            const lakeLayer = L.geoJSON(band.geometry, {
              coordsToLatLng: shiftCoordinates(offset),
              pane: "lakes", interactive: false,
              style: { color: "#96abb0", weight: 0.65, fillColor: "#e5eff0", fillOpacity: 1 },
            });
            const updateLakes = () => {
              if (m.getZoom() >= band.minZoom) lakeLayer.addTo(m);
              else lakeLayer.remove();
            };
            details.push(updateLakes);
            updateLakes();
          }
          L.polyline(world.usStateBorders.map((line: number[][]) => line.map(shiftCoordinates(offset))), {
            pane: "divisions", interactive: false, color: "#78857c",
            weight: 0.9, opacity: 0.75, dashArray: "3 3",
          }).addTo(m);
          for (const boundary of groups) {
            const project = shiftCoordinates(offset);
            L.polyline(boundary.outer.map(line => line.map(project)), {
              interactive: false, color: "#8d9a93", weight: 0.85,
            }).addTo(m);
            L.polyline(boundary.inner.map(line => line.map(project)), {
              pane: "divisions", interactive: false, color: "#718078",
              weight: 1, opacity: 0.65, dashArray: "3 4",
            }).addTo(m);
          }
        }
        setReady(true);
      })
      .catch((e) => mounted && setError(e.message));
    m.on("click", (event: L.LeafletMouseEvent) => {
      if (latest.current.active)
        latest.current.onSelect?.([
          event.latlng.wrap().lng,
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
      const polygons: number[][][][] = props.geometry.type === "MultiPolygon"
        ? props.geometry.coordinates : [];
      const boundary = countryBoundary.current?.(polygons);
      const seam = (a: number[], b: number[]) =>
        Math.abs(a[0]) === 180 && a[0] === b[0];
      const split = [-180, 180].every(lon => polygons.some(poly =>
        poly[0].some((a, i, ring) => i > 0 && a[0] === lon && seam(a, ring[i - 1]))
      ));
      const highlights = worldOffsets.map(offset => L.geoJSON(props.geometry, {
        coordsToLatLng: shiftCoordinates(offset),
        pane: "answers",
        interactive: false,
        style: {
          color,
          stroke: !split && !boundary,
          weight: 2,
          fillColor,
          fillOpacity: relief ? 0.13 : 0.72,
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
      }).addTo(group));
      if (boundary) {
        for (const offset of worldOffsets) {
          L.polyline(boundary.outer.map(line => line.map(shiftCoordinates(offset))), {
            pane: "answers", interactive: false, color, weight: 2,
          }).addTo(group);
        }
      } else if (split) {
        for (const offset of worldOffsets) for (const polygon of polygons) for (const ring of polygon) {
          const lines: L.LatLng[][] = [[]];
          for (let i = 0; i < ring.length; i++) {
            if (i && seam(ring[i - 1], ring[i])) lines.push([]);
            lines[lines.length - 1].push(shiftCoordinates(offset)(ring[i]));
          }
          L.polyline(lines, { pane: "answers", interactive: false, color, weight: 2 }).addTo(group);
        }
      }
      // Keep tiny territories visible in the wider question view without
      // replacing their actual outline or forcing the map to zoom closer.
      const m = map.current;
      if (m && props.geometry.type !== "Point") {
        const bounds = highlights[1].getBounds();
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
  }, [props.geometry, tone, relief, ready]);
  useEffect(() => {
    // Reveal only adds the answer overlay. Preserve the user's exact viewport
    // and selection; the focus control remains available for deliberate zooming.
    if (props.revealed) return;
    if (props.usStateId) {
      const bounds: L.LatLngBoundsExpression = props.usStateId === "alaska" ? [[50,-190],[72,-129]]
        : props.usStateId === "hawaii" ? [[18.5,-161.5],[22.8,-154.3]]
        : [[24,-125],[50,-66]];
      map.current?.fitBounds(bounds, {padding:[22,22], animate:false});
    } else if (props.geometry) framePlace(!props.explore);
    else home();
  }, [props.geometry, props.resetKey, props.revealed, props.explore, props.usStateId, ready]);
  useEffect(() => {
    const group = pin.current,
      m = map.current;
    group?.clearLayers();
    if (props.trace?.length && group) {
      for (const offset of worldOffsets) {
        const path = props.trace.map(shiftCoordinates(offset));
        L.polyline(path,{pane:"pins",interactive:false,color:"#a45631",dashArray:"5 4"}).addTo(group);
        L.circleMarker(path[path.length-1],{pane:"pins",radius:4,color:"#a45631"}).addTo(group);
      }
    }
    if (props.point && group && m) {
      const [lon, lat] = props.point;
      const markers = worldOffsets.map(offset => L.marker([lat, lon + offset], {
        pane: "pins",
        icon: L.divIcon({
          className: "selection-marker",
          html: '<span class="selection-marker-dot"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(group));
      // A separate DOM marker stays anchored and scales on every zoom frame
      // without redrawing the detailed map. Keep a small visible minimum.
      const resizePin = () => {
        const scale = Math.max(0.35, Math.min(1, 2 ** ((m.getZoom() - 7) / 3)));
        for (const marker of markers) marker.getElement()?.style.setProperty("--pin-scale", String(scale));
      };
      resizePin();
      m.on("zoom", resizePin);
      return () => {
        m.off("zoom", resizePin);
      };
    }
  }, [props.point, props.trace]);
  return (
    <div className={"atlas " + (props.active ? "selectable" : "")}>
      <div
        ref={element}
        className="map-canvas"
        aria-label="Interactive world map. Drag to pan; scroll or use plus and minus to zoom."
        tabIndex={0}
      />
      {props.explore && <div className="terrain-controls">
        {relief && regionalZoom && <button aria-pressed={!!terrain} onClick={() => {
          const m = map.current;
          if (terrain || !m) { setTerrain(null); return; }
          const center = m.getCenter().wrap(), bounds = m.getBounds();
          setTerrain({lon:center.lng, lat:center.lat, width:bounds.getEast()-bounds.getWest()});
        }}>Tilt 3D</button>}
        <button aria-pressed={relief} onClick={() => {setTerrain(null); setRelief(!relief);}}>Terrain</button>
      </div>}
      {terrain && <Suspense fallback={<div className="terrain-panel">Loading terrain…</div>}><Terrain view={terrain} /></Suspense>}
      <div className="map-tools" style={terrain ? {display:"none"} : undefined}>
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
            if (c) props.onSelect?.([c.wrap().lng, c.lat]);
          }}
        >
          Select map center
        </button>
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
        {relief && <><a href="https://doi.org/10.25921/fd45-gt74" target="_blank" rel="noreferrer">NOAA ETOPO</a> · </>}
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
