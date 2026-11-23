/* Share card: a 1080×1920 (IG Story) picture drawn on a canvas in the browser. Nothing is uploaded.
   By default it shows practice effort only (rounds, minutes, stage lights). The user may add their name
   and the 8-criterion radar; there is never video, a face or a total score. */
import { useEffect, useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import type { CriterionCode } from "@/contract";
import logoWhite from "@/assets/brand/horizontal-white.svg";
import { Button, SHORT_NAME, cn } from "./ui";
import { PPRE_SHAPES } from "./PPre";
import { MAX_LIGHTS } from "./streak";

export interface ShareData {
  title: string;            // e.g. "พฤศจิกายน 2569"
  name: string;
  rounds: number;
  minutes: number;
  lights: number;
  streak: number;
  levels: Partial<Record<CriterionCode, number | null>> | null; // latest round, for the optional radar
}

export interface ShareOptions { name: boolean; radar: boolean }

const W = 1080, H = 1920;
const NAVY = "#0e0c45", NAVY_DEEP = "#08072b", LIME = "#d4f53c";
const CODES: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
const FONT = (w: number, px: number) => `${w} ${px}px Prompt, system-ui, sans-serif`;

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

function drawPPre(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, bg: string) {
  const s = size / 408;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = "#ffffff";
  for (const d of [PPRE_SHAPES.TORSO, PPRE_SHAPES.FEET, PPRE_SHAPES.LEFT_ARM, PPRE_SHAPES.POINT_ARM]) ctx.fill(new Path2D(d));
  ctx.fillStyle = bg;
  ctx.fill(new Path2D(PPRE_SHAPES.FEET_GAP)); ctx.fill(new Path2D(PPRE_SHAPES.SMILE));
  for (const [cx, cy, rx, ry] of PPRE_SHAPES.EYES) { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

export async function drawShareCard(canvas: HTMLCanvasElement, d: ShareData, o: ShareOptions) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  try { await Promise.all([700, 600, 500].map((w) => document.fonts.load(FONT(w, 40)))); } catch { /* system font fallback */ }
  const logo = await loadImage(logoWhite);

  // background
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, NAVY); g.addColorStop(1, NAVY_DEEP);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 900); glow.addColorStop(0, "rgba(40,35,239,0.55)"); glow.addColorStop(1, "rgba(40,35,239,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // header
  if (logo) { const h = 62, w = h * ((logo.naturalWidth || 1504) / (logo.naturalHeight || 246)); ctx.drawImage(logo, 80, 100, w, h); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = LIME; ctx.font = FONT(600, 44); ctx.fillText("สรุปการซ้อมของฉัน", 80, 290);
  ctx.fillStyle = "#ffffff"; ctx.font = FONT(700, 100); ctx.fillText(d.title, 80, 400);
  if (o.name && d.name.trim()) { ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = FONT(500, 42); ctx.fillText(`โดย ${d.name.trim().slice(0, 40)}`, 80, 468); }

  // stage
  const sx = 80, sy = 520, sw = 920, sh = 440;
  roundRect(ctx, sx, sy, sw, sh, 44); ctx.fillStyle = "rgba(8,7,43,0.85)"; ctx.fill();
  ctx.save(); roundRect(ctx, sx, sy, sw, sh, 44); ctx.clip();
  const floorY = sy + sh - 60;
  const pool = ctx.createRadialGradient(W / 2, floorY, 0, W / 2, floorY, 380);
  pool.addColorStop(0, `rgba(212,245,60,${0.45 * (d.lights / MAX_LIGHTS)})`); pool.addColorStop(1, "rgba(212,245,60,0)");
  ctx.fillStyle = pool; ctx.beginPath(); ctx.ellipse(W / 2, floorY, 380, 60, 0, 0, Math.PI * 2); ctx.fill();
  const xs = [52, 126, 200, 274, 348].map((x) => sx + (x / 400) * sw);
  xs.forEach((x, i) => {
    const on = i < d.lights, fx = W / 2 + (x - W / 2) * 0.3;
    if (on) {
      const beam = ctx.createLinearGradient(0, sy + 70, 0, floorY); beam.addColorStop(0, "rgba(212,245,60,0.5)"); beam.addColorStop(1, "rgba(212,245,60,0)");
      ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(x - 20, sy + 72); ctx.lineTo(x + 20, sy + 72); ctx.lineTo(fx + 90, floorY); ctx.lineTo(fx - 90, floorY); ctx.closePath(); ctx.fill();
    }
  });
  xs.forEach((x, i) => {
    const on = i < d.lights;
    ctx.beginPath(); ctx.arc(x, sy + 66, 22, 0, Math.PI * 2);
    if (on) { ctx.shadowColor = LIME; ctx.shadowBlur = 40; ctx.fillStyle = LIME; ctx.fill(); ctx.shadowBlur = 0; }
    else { ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 4; ctx.stroke(); }
  });
  drawPPre(ctx, W / 2 - 100, floorY - 202, 200, "#0a0935");
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff"; ctx.font = FONT(700, 54);
  ctx.fillText(`ไฟเวที ${d.lights}/${MAX_LIGHTS}${d.streak > 1 ? `  ·  ติดต่อกัน ${d.streak} สัปดาห์` : ""}`, W / 2, 1040);

  // stats
  const stats: [string, string][] = [[String(d.rounds), "รอบที่ซ้อม"], [String(d.minutes), "นาทีที่ซ้อม"], [String(d.streak), "สัปดาห์ติด"]];
  const tw = (920 - 2 * 28) / 3;
  stats.forEach(([n, l], i) => {
    const x = 80 + i * (tw + 28);
    roundRect(ctx, x, 1085, tw, 200, 36); ctx.fillStyle = i === 0 ? LIME : "rgba(255,255,255,0.08)"; ctx.fill();
    ctx.fillStyle = i === 0 ? NAVY : "#ffffff"; ctx.font = FONT(700, 104); ctx.fillText(n, x + tw / 2, 1200);
    ctx.fillStyle = i === 0 ? "rgba(14,12,69,0.75)" : "rgba(255,255,255,0.7)"; ctx.font = FONT(500, 36); ctx.fillText(l, x + tw / 2, 1255);
  });

  // optional radar
  if (o.radar && d.levels) {
    const cx = W / 2, cy = 1585, R = 130;
    ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 2;
    for (let k = 1; k <= 4; k++) { ctx.beginPath(); CODES.forEach((_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 8; const r = (R * k) / 4; const p = [cx + r * Math.cos(a), cy + r * Math.sin(a)]; if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.stroke(); }
    // unanalysable axes are skipped (never drawn as 0); their label shows "?"
    ctx.beginPath();
    CODES.filter((c) => d.levels![c] != null).forEach((c, j) => { const i = CODES.indexOf(c); const a = -Math.PI / 2 + (i * 2 * Math.PI) / 8; const r = (R * d.levels![c]!) / 4; const p = [cx + r * Math.cos(a), cy + r * Math.sin(a)]; if (j) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.fillStyle = "rgba(212,245,60,0.3)"; ctx.fill(); ctx.strokeStyle = LIME; ctx.lineWidth = 5; ctx.stroke();
    ctx.font = FONT(500, 28); ctx.fillStyle = "rgba(255,255,255,0.75)";
    CODES.forEach((c, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 8, cos = Math.cos(a), side = Math.abs(cos) > 0.3;
      ctx.textAlign = !side ? "center" : cos > 0 ? "left" : "right";
      const r = side ? R + 18 : R + 44;
      ctx.fillText(`${SHORT_NAME[c]} ${d.levels![c] ?? "?"}`, cx + r * cos, cy + r * Math.sin(a) + 10);
    });
    ctx.textAlign = "center";
    ctx.font = FONT(500, 28); ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillText("ระดับที่ระบบวัดได้ รอบล่าสุด (ไม่ใช่คะแนนรวม)", W / 2, 1355);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = FONT(500, 44);
    ctx.fillText("ซ้อมสม่ำเสมอ เวทีก็สว่างขึ้นทุกสัปดาห์", W / 2, 1500);
    ctx.fillStyle = LIME; ctx.font = FONT(700, 60); ctx.fillText("ซ้อมต่อเนื่องก่อนวันจริง", W / 2, 1600);
  }

  // footer
  ctx.font = FONT(600, 34); const tag = "ซ้อมพรีเซนต์ให้พร้อมกับ PromptPre's";
  const fw = ctx.measureText(tag).width + 80;
  roundRect(ctx, W / 2 - fw / 2, 1790, fw, 74, 37); ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fillText(tag, W / 2, 1839);
}

export function ShareCardMaker({ data, className }: { data: ShareData; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [opt, setOpt] = useState<ShareOptions>({ name: false, radar: false });
  const [busy, setBusy] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator;

  useEffect(() => { if (ref.current) void drawShareCard(ref.current, data, opt); }, [data, opt]);

  const blob = () => new Promise<Blob | null>((ok) => ref.current ? ref.current.toBlob(ok, "image/png") : ok(null));
  const download = async () => {
    setBusy(true);
    const b = await blob(); setBusy(false); if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = url; a.download = "promptpres-summary.png"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const share = async () => {
    const b = await blob(); if (!b) return;
    const file = new File([b], "promptpres-summary.png", { type: "image/png" });
    try { if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "สรุปการซ้อมของฉัน" }); else await download(); } catch { /* user closed the share sheet */ }
  };

  return <div className={cn("grid items-start gap-6 md:grid-cols-[minmax(0,280px)_1fr]", className)}>
    <canvas ref={ref} width={W} height={H} className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-2xl bg-navy shadow-lift" aria-label="ภาพตัวอย่างการ์ดสรุป" />
    <div>
      <p className="font-bold">เลือกสิ่งที่จะแสดง</p>
      <p className="mt-1 text-sm text-muted">เริ่มต้นแสดงแค่ความพยายามในการซ้อม ไม่มีวิดีโอ ใบหน้า หรือคะแนนรวม</p>
      <div className="mt-4 space-y-2">
        {[["stats", "รอบ นาที และไฟเวที", "แสดงเสมอ", true, true], ["name", "ชื่อของฉัน", d(data.name), opt.name, false], ["radar", "กราฟ 8 เกณฑ์รอบล่าสุด", "ระดับที่ระบบวัดได้", opt.radar, false]].map(([k, l, note, on, fixed]) =>
          <label key={k as string} className={cn("flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3", fixed ? "opacity-70" : "cursor-pointer")}>
            <span><b className="block text-sm">{l as string}</b><span className="text-xs text-muted">{note as string}</span></span>
            <input type="checkbox" className="size-5 accent-brand" checked={on as boolean} disabled={fixed as boolean}
              onChange={(e) => setOpt({ ...opt, [k as string]: e.target.checked })} />
          </label>)}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={download} disabled={busy}><Download />บันทึกรูป</Button>
        {canShare && <Button variant="soft" onClick={share}><Share2 />แชร์</Button>}
      </div>
      <p className="mt-3 text-xs text-faint">รูปสร้างในเครื่องของคุณ ไม่ได้ส่งไปที่ไหน ขนาด 1080×1920 สำหรับ IG Story</p>
    </div>
  </div>;
}

const d = (name: string) => (name.trim() ? `"${name.trim()}"` : "ยังไม่ได้ตั้งชื่อ");
