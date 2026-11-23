/* /lab/login: sign in, register or try as Guest. */
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Logo } from "@/v2/ui";
import { PPre } from "@/v2/PPre";
import { AuthCard } from "@/v2/AuthCard";

const POINTS = ["ผล 8 เกณฑ์ใน 4 ทักษะ ไม่มีคะแนนรวม ไม่มีเกรด", "ทุกระดับมีหลักฐาน กดแล้ววิดีโอเล่นตรงจุดนั้น", "ไฟเวทีติดทุกสัปดาห์ที่คุณซ้อม"];

export default function LoginLab() {
  const [p] = useSearchParams();
  return <div className="bg-navy-gradient relative min-h-dvh overflow-hidden text-white">
    <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(ellipse_at_30%_40%,black_10%,transparent_70%)]" />
    <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
      <Link to="/lab/landing"><Logo dark className="h-7" /></Link>
      <Link to="/lab/landing" className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white"><ArrowLeft className="size-4" />หน้าแรก</Link>
    </header>
    <main className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-24 pt-6 sm:px-6 md:grid-cols-2 md:pt-12">
      <div>
        <h1 className="text-4xl font-bold leading-tight sm:text-5xl">ยินดีต้อนรับสู่<br /><span className="mt-2 inline-block -rotate-2 rounded-full bg-lime px-5 py-1 text-navy">เวทีซ้อม</span> ของคุณ</h1>
        <ul className="mt-8 space-y-3">{POINTS.map((t) => <li key={t} className="flex items-start gap-3 text-white/80"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-lime" />{t}</li>)}</ul>
        <PPre pose="wave" color="white" size={140} className="mt-10 hidden md:block" say="สวัสดี! เริ่มแบบ Guest ก่อนก็ได้นะ" />
      </div>
      <AuthCard hideLogo className="mx-auto" initialTab={p.get("tab") === "register" ? "register" : "login"} />
    </main>
  </div>;
}
