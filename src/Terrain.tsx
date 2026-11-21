import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type TerrainView = { lon: number; lat: number; width: number };
let heights: Promise<Int16Array> | undefined;
function grid() {
  return heights ??= fetch("/data/relief.i16.gz").then(async response => {
    if (!response.ok || !response.body) throw Error();
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const values = new Int16Array(await new Response(stream).arrayBuffer());
    if (values.length !== 2160 * 1080) throw Error();
    return values;
  }).catch(error => { heights = undefined; throw error; });
}

function surface(values: Int16Array, view: TerrainView) {
  const cosine = Math.max(0.14, Math.cos(view.lat * Math.PI / 180));
  const width = Math.min(150, Math.max(7 / cosine, view.width));
  const depth = Math.min(90, width * cosine * 0.8);
  const north = Math.min(90, Math.max(-90 + depth, view.lat + depth / 2));
  const km = width * cosine * 111;
  const geometry = new THREE.PlaneGeometry(2, 2 * depth / (width * cosine), 240, 180);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const stops = [
    [-8000, "#527d9b"], [-100, "#9bc7d1"], [-1, "#b0d3d8"],
    [0, "#98b380"], [900, "#abb581"], [2300, "#aa916c"],
    [4000, "#aa9b86"], [5500, "#f1eee6"],
  ] as const;
  const palette = stops.map(([, hex]) => new THREE.Color(hex));
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const lon = view.lon + position.getX(i) * width / 2;
    const lat = north - depth * Math.floor(i / 241) / 180;
    const x = ((lon + 180) * 6 - 0.5 + 4320) % 2160;
    const y = Math.max(0, Math.min(1079, (90 - lat) * 6 - 0.5));
    const col = Math.floor(x), row = Math.floor(y);
    const sample = (r: number) => THREE.MathUtils.lerp(values[r * 2160 + col],
      values[r * 2160 + (col + 1) % 2160], x - col);
    const h = THREE.MathUtils.lerp(sample(row), sample(Math.min(1079, row + 1)), y - row);
    position.setY(i, Math.max(0, h) * 2 / (1000 * km) * Math.min(30, km / 55));
    let band = 1;
    while (band < stops.length - 1 && h > stops[band][0]) band++;
    const low = stops[band - 1][0], high = stops[band][0];
    color.copy(palette[band - 1]).lerp(palette[band], THREE.MathUtils.clamp((h-low)/(high-low), 0, 1));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export default function Terrain({view}: {view: TerrainView}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading terrain…");
  useEffect(() => {
    const el = host.current!;
    let active = true;
    let dispose = () => {};
    setStatus("Loading terrain…");
    grid().then(values => {
      if (!active) return;
      const renderer = new THREE.WebGLRenderer({antialias: true});
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      el.append(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#e5eff0");
      const geometry = surface(values, view);
      const material = new THREE.MeshLambertMaterial({vertexColors: true, side: THREE.DoubleSide});
      scene.add(new THREE.Mesh(geometry, material));
      scene.add(new THREE.AmbientLight(0xffffff, 1.35));
      const sun = new THREE.DirectionalLight(0xfff7e5, 2);
      sun.position.set(-3, 4, -2);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 30);
      camera.position.set(0, 1.8, 1.3);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 0.25;
      controls.maxDistance = 5;
      controls.maxPolarAngle = Math.PI * 0.47;
      controls.update();
      const draw = () => renderer.render(scene, camera);
      controls.addEventListener("change", draw);
      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        draw();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      setStatus("");
      dispose = () => {
        observer.disconnect();
        controls.dispose();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }).catch(() => { if (active) setStatus("Terrain unavailable. Use the map or try a browser with WebGL enabled."); });
    return () => { active = false; dispose(); };
  }, [view]);
  return <div className="terrain-panel">
    <div className="terrain-scene" ref={host} aria-label="Interactive 3D terrain" />
    {status && <p role="status">{status}</p>}
    <small>Drag to rotate · Scroll to zoom · Heights exaggerated · <a href="https://doi.org/10.1029/2019EA000658" target="_blank" rel="noreferrer">SRTM15+ / GMT</a></small>
  </div>;
}
