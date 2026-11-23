/* Flowing blue–lime light: one small WebGL fragment shader (no library), drawn at half resolution.
   The light bends gently toward the mouse. Without WebGL, or with "reduce motion", a still gradient is shown. */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "../ui";
import { useInView, usePointer } from "./useFx";

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";
const FRAG = `precision mediump float;
uniform vec2 r; uniform float t; uniform vec2 m;
void main(){
  vec2 uv = gl_FragCoord.xy / r;
  vec2 p = uv * 2.0 - 1.0; p.x *= r.x / r.y;
  vec2 mm = m * 2.0 - 1.0; mm.x *= r.x / r.y;
  float d = length(p - mm);
  p += 0.16 * vec2(sin(p.y * 2.6 + t * 0.5), cos(p.x * 2.4 - t * 0.4)) + (mm - p) * 0.12 * exp(-d * 1.8);
  float a = sin(p.x * 2.1 + t * 0.35) + sin(p.y * 2.7 - t * 0.3) + sin((p.x + p.y) * 1.7 + t * 0.25);
  float b = sin(p.x * 1.3 - t * 0.22) + cos(p.y * 1.9 + t * 0.31);
  vec3 navy = vec3(0.055, 0.047, 0.27), blue = vec3(0.157, 0.137, 0.937), lime = vec3(0.83, 0.96, 0.235);
  vec3 c = mix(navy, blue, smoothstep(-1.4, 1.9, a));
  c = mix(c, lime, smoothstep(1.3, 2.2, b + a * 0.35) * 0.4);
  c *= 0.85 + 0.15 * smoothstep(1.2, 0.0, d);
  gl_FragColor = vec4(c, 1.0);
}`;

export function FlowLight({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useReducedMotion();
  const visible = useInView(canvas, "100px");
  const pointer = usePointer(canvas);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const c = canvas.current; if (!c || still || !visible) return;
    const gl = c.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) { setFailed(true); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, "r"), uT = gl.getUniformLocation(prog, "t"), uM = gl.getUniformLocation(prog, "m");
    const mouse = { x: 0.5, y: 0.5 };
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const w = Math.max(1, Math.round(c.clientWidth * 0.5)), h = Math.max(1, Math.round(c.clientHeight * 0.5)); // half resolution: soft light needs no detail
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); }
      const pt = pointer.current;
      const tx = pt.active ? pt.x / c.clientWidth : 0.5 + Math.sin(now / 4000) * 0.25, ty = pt.active ? 1 - pt.y / c.clientHeight : 0.5;
      mouse.x += (tx - mouse.x) * 0.04; mouse.y += (ty - mouse.y) * 0.04;
      gl.uniform2f(uR, w, h); gl.uniform1f(uT, (now - t0) / 1000); gl.uniform2f(uM, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, visible, pointer]);

  return <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
    {/* still fallback underneath: also what shows before the first frame */}
    <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_20%,var(--color-brand),transparent),radial-gradient(50%_50%_at_85%_80%,color-mix(in_srgb,var(--color-lime)_30%,transparent),transparent),var(--color-navy)]" />
    {!failed && !still && <canvas ref={canvas} className="absolute inset-0 size-full" />}
    {still && <canvas ref={canvas} className="hidden" />}
  </div>;
}
