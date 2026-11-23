/* Glossy 3D stage for the sign-up section (three.js, loaded only when the visitor scrolls near it):
   a white 3D P'Pre in the middle, with a microphone, a camera and a stopwatch floating around in brand blue
   and lime. Everything turns gently toward the mouse. Built from simple shapes, lit by a local studio
   environment (no files downloaded). Drawing stops while it is off screen. */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const BLUE = "#2823ef", LIME = "#d4f53c", NAVY = "#0e0c45", WHITE = "#ffffff";

function buildScene() {
  const scene = new THREE.Scene();
  const glossy = (color: string, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
    new THREE.MeshPhysicalMaterial({ color, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, ...extra });
  const blue = glossy(BLUE), lime = glossy(LIME, { roughness: 0.3 }), white = glossy(WHITE, { roughness: 0.32 }), navy = glossy(NAVY, { roughness: 0.15 });
  const floaters: { obj: THREE.Object3D; base: THREE.Vector3; speed: number; phase: number; spin: number }[] = [];
  const add = (obj: THREE.Object3D, x: number, y: number, z: number, speed = 1, spin = 0.2) => {
    obj.position.set(x, y, z); scene.add(obj);
    floaters.push({ obj, base: new THREE.Vector3(x, y, z), speed, phase: Math.random() * 6.28, spin });
  };

  // P'Pre: a white rounded body, navy eyes and smile, little arms (one waves), blue feet
  const ppre = new THREE.Group();
  ppre.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 0.9, 16, 40), white));
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.16, 8, 16), navy); eye.position.set(sx * 0.27, 0.42, 0.8); ppre.add(eye);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), blue); foot.scale.set(1.2, 0.6, 1.4); foot.position.set(sx * 0.38, -1.25, 0.15); ppre.add(foot);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 32, Math.PI), navy); smile.rotation.z = Math.PI; smile.position.set(0, 0.2, 0.84); ppre.add(smile);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 8, 16), white); armL.position.set(-0.95, -0.15, 0.1); armL.rotation.z = -0.5; ppre.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.8, 0.15, 0.1);
  const armRMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 8, 16), white); armRMesh.position.set(0.2, 0.3, 0); armRMesh.rotation.z = -0.6; armR.add(armRMesh); ppre.add(armR);
  ppre.scale.setScalar(0.95);
  add(ppre, 0, -0.1, 0.6, 0.8, 0);

  // microphone
  const mic = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), blue); head.position.y = 0.55; mic.add(head);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.06, 12, 40), lime); band.position.y = 0.48; band.rotation.x = Math.PI / 2; mic.add(band);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 1.05, 24), navy); handle.position.y = -0.3; mic.add(handle);
  mic.rotation.z = 0.35;
  add(mic, -2.55, 1.05, -0.4, 1.1, 0.35);

  // camera
  const cam = new THREE.Group();
  cam.add(new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.85, 0.6, 4, 0.16), blue));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.34, 32), navy); lens.rotation.x = Math.PI / 2; lens.position.z = 0.42; cam.add(lens);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.05, 12, 40), lime); ring.position.z = 0.6; cam.add(ring);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), lime); dot.position.set(0.45, 0.28, 0.31); cam.add(dot);
  cam.rotation.set(0.15, -0.5, -0.12);
  add(cam, 2.45, 1.15, -0.3, 0.9, 0.25);

  // stopwatch
  const watch = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 48), white); face.rotation.x = Math.PI / 2; watch.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.08, 16, 48), lime); watch.add(rim);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 16), blue); knob.position.y = 0.72; watch.add(knob);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.04), navy); hand.position.set(0, 0.16, 0.13); watch.add(hand);
  watch.rotation.set(-0.2, 0.4, 0.15);
  add(watch, 2.25, -1.35, 0.2, 1.2, 0.3);

  // small accents
  add(new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 16, 40), lime), -2.25, -1.45, 0.3, 1.4, 0.6);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), blue), -1.25, 1.85, -0.8, 1.6, 0);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), lime), 1.2, 2.0, -0.6, 1.8, 0);

  const sun = new THREE.DirectionalLight(WHITE, 2.2); sun.position.set(3, 5, 6); scene.add(sun);
  scene.add(new THREE.HemisphereLight("#c9c7fc", NAVY, 0.6));
  return { scene, floaters, armR, watchHand: hand };
}

export default function Stage3D({ className, onReady }: { className?: string; onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady); ready.current = onReady;
  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { return; } // no WebGL: the 2D picture behind stays
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    el.appendChild(renderer.domElement);

    const { scene, floaters, armR, watchHand } = buildScene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50); camera.position.set(0, 0, 9);
    const rig = new THREE.Group(); scene.children.slice().forEach((o) => { if (!(o instanceof THREE.Light)) rig.add(o); }); scene.add(rig);

    const fit = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.zoom = w < 520 ? 0.75 : 1; camera.updateProjectionMatrix(); };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);

    const mouse = { x: 0, y: 0 }, aim = { x: 0, y: 0 };
    const move = (e: PointerEvent) => { mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = (e.clientY / window.innerHeight) * 2 - 1; };
    window.addEventListener("pointermove", move, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: "100px" }); io.observe(el);
    const t0 = performance.now();
    let shown = false;
    renderer.setAnimationLoop(() => {
      if (!visible || document.hidden) return;
      const t = (performance.now() - t0) / 1000;
      for (const f of floaters) {
        f.obj.position.y = f.base.y + Math.sin(t * f.speed + f.phase) * 0.14;
        f.obj.rotation.y += f.spin * 0.006;
      }
      armR.rotation.z = Math.sin(t * 3.2) * 0.35 - 0.1; // P'Pre waves
      watchHand.rotation.z = -t * 1.5; watchHand.position.set(Math.sin(t * 1.5) * 0.16, Math.cos(t * 1.5) * 0.16, 0.13);
      aim.x += (mouse.x * 0.35 - aim.x) * 0.05; aim.y += (mouse.y * 0.18 - aim.y) * 0.05;
      rig.rotation.y = aim.x; rig.rotation.x = aim.y;
      renderer.render(scene, camera);
      if (!shown) { shown = true; ready.current?.(); } // the 2D stand-in fades out after the first real frame
    });

    return () => {
      renderer.setAnimationLoop(null); ro.disconnect(); io.disconnect(); window.removeEventListener("pointermove", move);
      scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
      envTex.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, []);
  return <div ref={host} aria-hidden className={className} />;
}
