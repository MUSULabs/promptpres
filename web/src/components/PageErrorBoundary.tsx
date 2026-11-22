import { Component, type ReactNode } from "react";
import { Icon, Message } from "./ui";

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
    return <section className="panel empty-state page-error">
      <span className="state-icon"><Icon name="alert" /></span>
      <h1>เปิดหน้านี้ไม่สำเร็จ</h1>
      <Message kind="error">อาจเกิดจากการเชื่อมต่อขาดหายหรือเว็บเพิ่งอัปเดต โหลดหน้าใหม่เพื่อลองอีกครั้ง</Message>
      <div className="row">
        <button type="button" onClick={() => window.location.reload()}><Icon name="refresh" /> โหลดหน้าใหม่</button>
        <a className="button secondary" href="/"><Icon name="history" /> กลับหน้าประวัติ</a>
      </div>
    </section>;
  }
}
