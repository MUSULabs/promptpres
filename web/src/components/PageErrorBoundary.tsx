import { Component, type ReactNode } from "react";
import { ErrorPanel } from "@/v2/states";
import { Logo } from "@/v2/ui";

/**
 * App pages load as separate files on first use (main.tsx `lazy`). If that file cannot be fetched
 * (connection dropped, or the site was updated and the old file is gone) or a page fails to render,
 * show a way back instead of an empty screen. Moving to another page clears the error.
 */
export class PageErrorBoundary extends Component<{ pathname: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { pathname: string }) {
    if (this.state.failed && previous.pathname !== this.props.pathname) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const btn = "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold";
    return <div className="grid min-h-dvh place-items-center bg-surface px-4" data-page-error>
      <div className="w-full max-w-md">
        <Logo className="mx-auto mb-6 h-7" />
        <h1 className="mb-3 text-center text-2xl font-bold">เปิดหน้านี้ไม่สำเร็จ</h1>
        <ErrorPanel what="โหลดส่วนของหน้านี้ไม่ได้" why="การเชื่อมต่อขาดหาย หรือเว็บเพิ่งอัปเดตเป็นรุ่นใหม่" todo="โหลดหน้าใหม่เพื่อลองอีกครั้ง"
          actions={<>
            <button type="button" className={`${btn} bg-brand text-white`} onClick={() => window.location.reload()}>โหลดหน้าใหม่</button>
            <a className={`${btn} bg-brand-50 text-brand`} href="/">กลับหน้าหลัก</a>
          </>} />
      </div>
    </div>;
  }
}
