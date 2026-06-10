import type { SourceManifest, TwinProject } from "../types/twin";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

export function generateStaticPreviewHtml(twin: TwinProject, manifest: SourceManifest): string {
  const title = `${twin.addresses.parcel_address} 프리뷰 디지털 트윈`;
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
    }
  }
  </script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #d8d4cb; color: #f7f3e8; }
    #app { position: relative; width: 100vw; height: 100vh; }
    canvas { display: block; }
    .panel { position: absolute; top: 16px; left: 16px; width: min(380px, calc(100vw - 32px)); padding: 16px; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; background: rgba(17,17,15,0.82); backdrop-filter: blur(14px); box-shadow: 0 18px 50px rgba(0,0,0,0.36); z-index: 5; }
    .title { font-size: 17px; font-weight: 800; margin-bottom: 6px; }
    .sub { color: #cfc6b2; font-size: 12px; line-height: 1.5; margin-bottom: 12px; }
    .inline-notice { display: none; margin: 10px 0 12px; padding: 9px 10px; border-radius: 8px; background: rgba(255, 197, 66, 0.16); color: #ffe1a1; border: 1px solid rgba(255, 197, 66, 0.35); font-size: 12px; line-height: 1.45; }
    .meta { display: grid; grid-template-columns: 82px 1fr; gap: 6px 10px; font-size: 12px; margin: 10px 0 14px; }
    .meta span:nth-child(odd) { color: #a99f8d; }
    .controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    button { border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; background: rgba(255,255,255,0.08); color: #f7f3e8; padding: 9px 10px; font-weight: 750; cursor: pointer; }
    button.active { background: #4dd8c1; color: #081311; }
    .slider { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.12); }
    .slider-row { display: grid; grid-template-columns: 76px 1fr 44px; gap: 8px; align-items: center; margin: 8px 0; font-size: 12px; color: #ded5c1; }
    input[type="range"] { width: 100%; accent-color: #4dd8c1; }
    .legend { position: absolute; right: 16px; bottom: 16px; width: min(320px, calc(100vw - 32px)); padding: 13px; border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; background: rgba(17,17,15,0.78); backdrop-filter: blur(14px); z-index: 5; font-size: 12px; color: #ded5c1; }
    .legend-row { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
    .chip { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.18); flex: 0 0 auto; }
    .notice { position: absolute; left: 16px; bottom: 16px; max-width: min(680px, calc(100vw - 32px)); padding: 11px 13px; border-radius: 8px; background: rgba(255, 197, 66, 0.16); color: #ffe1a1; border: 1px solid rgba(255, 197, 66, 0.35); font-size: 12px; line-height: 1.45; z-index: 5; }
    .attr { position: absolute; right: 16px; top: 16px; max-width: 360px; padding: 8px 10px; border-radius: 8px; background: rgba(17,17,15,0.72); border: 1px solid rgba(255,255,255,0.14); color: #cfc6b2; font-size: 11px; z-index: 5; }
    .label { position: absolute; transform: translate(-50%, -50%); pointer-events: none; z-index: 4; padding: 4px 7px; border-radius: 999px; background: rgba(16,16,14,0.82); border: 1px solid rgba(255,255,255,0.16); color: #fff7de; font-size: 11px; white-space: nowrap; }
    .manifest { position: absolute; left: 16px; top: auto; bottom: 76px; z-index: 5; font-size: 11px; color: #d9d0bd; background: rgba(17,17,15,0.68); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 8px 10px; }
    .manifest code { color: #4dd8c1; }
    @media (max-width: 780px), (max-height: 680px) { .legend { display: none; } .notice { display: none; } .inline-notice { display: block; } .panel { top: 10px; left: 10px; width: calc(100vw - 20px); max-height: calc(100vh - 20px); overflow: auto; } .attr { display: none; } .manifest { display: none; } }
  </style>
</head>
<body>
  <div id="app">
    <section class="panel">
      <div class="title">주소 기반 3D 프리뷰</div>
      <div class="sub">대상 건물과 주변 맥락을 빠르게 검토하기 위한 저정밀 프리뷰입니다. 공식 필지·건물 데이터로 교체해야 정식 geometry가 됩니다.</div>
      <div class="inline-notice">${escapeHtml(twin.viewer.warning)}</div>
      <div class="meta">
        <span>지번</span><span>${escapeHtml(twin.addresses.parcel_address)}</span>
        <span>도로명</span><span>${escapeHtml(twin.addresses.road_address_candidate)}</span>
        <span>건물명</span><span>${escapeHtml(twin.addresses.building_name_candidate)}</span>
        <span>좌표</span><span>${twin.center.lat.toFixed(5)}, ${twin.center.lon.toFixed(5)}</span>
        <span>신뢰도</span><span>${escapeHtml(twin.geocoding.confidence)}</span>
      </div>
      <div class="controls">
        <button id="orbit" class="active">궤도 보기</button>
        <button id="top">상단 보기</button>
        <button id="sat">위성</button>
        <button id="mass" class="active">3D 매스</button>
        <button id="xray">X-Ray</button>
        <button id="shadow" class="active">그림자</button>
      </div>
      <div class="slider">
        <div class="slider-row"><span>동/서</span><input id="offsetX" type="range" min="-12" max="12" value="0" step="0.5"><b id="xVal">0m</b></div>
        <div class="slider-row"><span>남/북</span><input id="offsetZ" type="range" min="-12" max="12" value="0" step="0.5"><b id="zVal">0m</b></div>
      </div>
    </section>

    <aside class="attr">Basemap: offline procedural grid fallback. Optional ArcGIS World Imagery preview tiles are loaded live only and not cached. Attribution: Esri, Maxar, Earthstar Geographics, and the GIS User Community.</aside>
    <aside class="legend">
      <strong>Layer Legend</strong>
      <div class="legend-row"><span class="chip" style="background:#4dd8c1"></span> 대상 건물 / target mass</div>
      <div class="legend-row"><span class="chip" style="background:#a3a39d"></span> 주변 건물 / context mass</div>
      <div class="legend-row"><span class="chip" style="background:#ff5bd8"></span> 필지 경계 추정</div>
      <div class="legend-row"><span class="chip" style="background:#70a7ff"></span> 도로 힌트</div>
    </aside>
    <div class="manifest">Manifest: <code>source_manifest.json</code> / QA: <code>qa_report.html</code></div>
    <div class="notice">${escapeHtml(twin.viewer.warning)}</div>
  </div>

  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    const twin = ${safeJson(twin)};
    const manifest = ${safeJson(manifest)};
    const app = document.getElementById('app');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd8d4cb);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1600);
    camera.position.set(...twin.viewer.initial_camera.position);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    app.prepend(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 520;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(...twin.viewer.initial_camera.target);

    const hemi = new THREE.HemisphereLight(0xf8f2e6, 0x2b2b2b, 1.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3d0, 2.4);
    sun.position.set(-42, 78, 36);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const root = new THREE.Group();
    const targetRoot = new THREE.Group();
    const buildingsGroup = new THREE.Group();
    const surroundingGroup = new THREE.Group();
    const groundGroup = new THREE.Group();
    const satelliteGroup = new THREE.Group();
    scene.add(groundGroup, satelliteGroup, root);
    root.add(buildingsGroup, surroundingGroup, targetRoot);

    const matTarget = new THREE.MeshStandardMaterial({ color: 0x4dd8c1, roughness: 0.62, metalness: 0.05 });
    const matContext = new THREE.MeshStandardMaterial({ color: 0xa3a39d, roughness: 0.72, transparent: true, opacity: 0.68 });
    const matParcel = new THREE.LineBasicMaterial({ color: 0xff5bd8, linewidth: 2 });
    const matRoad = new THREE.MeshBasicMaterial({ color: 0x70a7ff, transparent: true, opacity: 0.24, depthWrite: false });

    function makeGroundTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#cfc8b7';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 80; i++) {
        ctx.strokeStyle = i % 5 === 0 ? 'rgba(83,78,67,0.26)' : 'rgba(83,78,67,0.09)';
        ctx.lineWidth = i % 5 === 0 ? 1.4 : 0.8;
        const p = i * (canvas.width / 80);
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, canvas.height);
        ctx.moveTo(0, p);
        ctx.lineTo(canvas.width, p);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(77,216,193,0.14)';
      ctx.fillRect(450, 470, 120, 90);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    }

    const baseGround = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1800),
      new THREE.MeshBasicMaterial({ color: 0xd0cabd })
    );
    baseGround.rotation.x = -Math.PI / 2;
    baseGround.position.y = -0.06;
    groundGroup.add(baseGround);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.9, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    groundGroup.add(ground);

    function lonToTileFloat(lon, zoom) { return (lon + 180) / 360 * Math.pow(2, zoom); }
    function latToTileFloat(lat, zoom) {
      const rad = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom);
    }
    function tileSizeMeters(lat, zoom) {
      return 156543.03392804097 / Math.pow(2, zoom) * Math.cos(lat * Math.PI / 180) * 256;
    }

    let satelliteLoaded = false;
    satelliteGroup.visible = false;

    function addSatelliteTiles() {
      if (satelliteLoaded) return;
      satelliteLoaded = true;
      const z = 19;
      const cx = lonToTileFloat(twin.center.lon, z);
      const cy = latToTileFloat(twin.center.lat, z);
      const centerTileX = Math.floor(cx);
      const centerTileY = Math.floor(cy);
      const tileSize = tileSizeMeters(twin.center.lat, z);
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      const tileRadius = 3;
      for (let dx = -tileRadius; dx <= tileRadius; dx++) {
        for (let dy = -tileRadius; dy <= tileRadius; dy++) {
          const x = centerTileX + dx;
          const y = centerTileY + dy;
          const url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
          const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98 });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(tileSize, tileSize), mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set((x + 0.5 - cx) * tileSize, 0.035, (cy - (y + 0.5)) * tileSize);
          satelliteGroup.add(mesh);
          loader.load(url, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 8;
            mat.map = texture;
            mat.needsUpdate = true;
          }, undefined, () => { mesh.visible = false; });
        }
      }
    }
    function extrudeFootprint(points, height, material) {
      const shape = new THREE.Shape();
      points.forEach((point, index) => {
        if (index === 0) shape.moveTo(point.x, -point.z);
        else shape.lineTo(point.x, -point.z);
      });
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    function addBuilding(building) {
      const mesh = extrudeFootprint(building.footprint, building.height_m, building.role === 'target' ? matTarget : matContext);
      mesh.name = building.name;
      if (building.role === 'target') targetRoot.add(mesh);
      else surroundingGroup.add(mesh);
    }
    twin.buildings.forEach(addBuilding);
    buildingsGroup.add(targetRoot, surroundingGroup);

    function roadMesh(road) {
      road.centerline.slice(0, -1).forEach((a, index) => {
        const b = road.centerline[index + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(road.width_m, length), matRoad);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = -Math.atan2(dx, dz);
        mesh.position.set((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2);
        root.add(mesh);
      });
    }
    twin.roads.forEach(roadMesh);

    const parcelPoints = twin.parcel.boundary.map((point) => new THREE.Vector3(point.x, 0.28, point.z));
    const parcelLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(parcelPoints), matParcel);
    targetRoot.add(parcelLine);

    const labels = [];
    function makeLabel(text, position) {
      const el = document.createElement('div');
      el.className = 'label';
      el.textContent = text;
      app.appendChild(el);
      labels.push({ el, position: position.clone() });
    }
    makeLabel(twin.addresses.building_name_candidate + ' / 사당동 317-6', new THREE.Vector3(0, 23.5, 0));

    function updateLabels() {
      const offset = targetRoot.position;
      labels.forEach((label) => {
        const projected = label.position.clone().add(offset).project(camera);
        label.el.style.left = ((projected.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        label.el.style.top = ((-projected.y * 0.5 + 0.5) * window.innerHeight) + 'px';
        label.el.style.display = projected.z < 1 ? 'block' : 'none';
      });
    }

    const buttons = {
      orbit: document.getElementById('orbit'),
      top: document.getElementById('top'),
      sat: document.getElementById('sat'),
      mass: document.getElementById('mass'),
      xray: document.getElementById('xray'),
      shadow: document.getElementById('shadow')
    };
    const offsetX = document.getElementById('offsetX');
    const offsetZ = document.getElementById('offsetZ');
    const xVal = document.getElementById('xVal');
    const zVal = document.getElementById('zVal');

    function activate(button, active) { button.classList.toggle('active', active); }
    buttons.orbit.addEventListener('click', () => {
      camera.position.set(58, 58, 74);
      controls.target.set(0, 7, 0);
      activate(buttons.orbit, true);
      activate(buttons.top, false);
    });
    buttons.top.addEventListener('click', () => {
      camera.position.set(0, 135, 0.1);
      controls.target.set(0, 0, 0);
      activate(buttons.top, true);
      activate(buttons.orbit, false);
    });
    buttons.sat.addEventListener('click', () => {
      const nextVisible = !satelliteGroup.visible;
      if (nextVisible) addSatelliteTiles();
      satelliteGroup.visible = nextVisible;
      activate(buttons.sat, satelliteGroup.visible);
    });
    buttons.mass.addEventListener('click', () => {
      buildingsGroup.visible = !buildingsGroup.visible;
      activate(buttons.mass, buildingsGroup.visible);
    });
    buttons.xray.addEventListener('click', () => {
      const active = !buttons.xray.classList.contains('active');
      activate(buttons.xray, active);
      matTarget.transparent = active;
      matTarget.opacity = active ? 0.52 : 1;
      matContext.opacity = active ? 0.28 : 0.68;
    });
    buttons.shadow.addEventListener('click', () => {
      renderer.shadowMap.enabled = !renderer.shadowMap.enabled;
      activate(buttons.shadow, renderer.shadowMap.enabled);
    });
    function applyOffset() {
      const x = Number(offsetX.value);
      const z = Number(offsetZ.value);
      targetRoot.position.set(x, 0, z);
      xVal.textContent = x.toFixed(1) + 'm';
      zVal.textContent = z.toFixed(1) + 'm';
    }
    offsetX.addEventListener('input', applyOffset);
    offsetZ.addEventListener('input', applyOffset);
    addSatelliteTiles();
    satelliteGroup.visible = true;
    activate(buttons.sat, true);

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
      controls.update();
      updateLabels();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();
  </script>
</body>
</html>`;
}
