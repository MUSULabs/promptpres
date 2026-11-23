/* /lab/oops/:kind: 404, offline and maintenance pages. Each says what happened and offers a way back. */
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Home, RotateCcw } from "lucide-react";
import { Button, Logo } from "@/v2/ui";
import { PPre, type Pose } from "@/v2/PPre";
import { useHome } from "@/v2/ContentPage";

const KINDS: Record<string, { code: string; title: string; body: string; pose: Pose; retry?: boolean }> = {
  "404": { code: "404", title: "ไม่พบหน้านี้", body: "ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว รอบซ้อมของคุณยังอยู่ครบ", pose: "think" },
  offline: { code: "ออฟไลน์", title: "ไม่ได้เชื่อมต่ออินเทอร์เน็ต", body: "ตรวจ Wi-Fi หรือเน็ตมือถือ แล้วกดลองใหม่ ถ้ากำลังอัปโหลดอยู่ อย่าเพิ่งปิดหน้าเดิม", pose: "think", retry: true },
  maintenance: { code: "ปรับปรุง", title: "ระบบกำลังปรับปรุงชั่วคราว", body: "ทีมกำลังอัปเดตระบบ ใช้เวลาไม่นาน รอบซ้อมและผลที่มีอยู่ไม่หายไปไหน ลองกลับมาใหม่อีกสักครู่", pose: "nod", retry: true },
};

export default function StatusLab() {
  const { kind = "404" } = useParams();
  const k = KINDS[kind] ?? KINDS["404"];
  const home = useHome();
  return <main className="bg-navy-gradient relative grid min-h-dvh place-items-center overflow-hidden px-4 py-16 text-white">
    <p aria-hidden className="text-outline pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none whitespace-nowrap text-center text-[28vw] font-bold leading-none opacity-60 sm:text-[22vw]">{k.code}</p>
    <div className="relative max-w-lg text-center">
      <Link to={home.to} aria-label="PromptPre's หน้าแรก"><Logo dark className="mx-auto h-8" /></Link>
      <PPre pose={k.pose} size={140} color="white" className="mx-auto mt-10" />
      <h1 className="mt-6 text-3xl font-bold sm:text-4xl">{k.title}</h1>
      <p className="mt-3 text-white/70">{k.body}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {k.retry && <Button variant="lime" size="lg" onClick={() => window.location.reload()}><RotateCcw />ลองใหม่</Button>}
        <Button asChild variant={k.retry ? "outlineLight" : "lime"} size="lg"><Link to={home.to}><Home />{home.back}</Link></Button>
        {!k.retry && <Button variant="outlineLight" size="lg" onClick={() => window.history.back()}><ArrowLeft />ย้อนกลับ</Button>}
      </div>
      <p className="mt-8 text-sm text-white/50">ยังติดอยู่? <Link to="/lab/help#contact" className="font-semibold text-lime hover:underline">แจ้งปัญหาให้ทีม</Link></p>
    </div>
  </main>;
}
