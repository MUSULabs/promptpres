/* Every in-app address in one place, so pages never spell out a path by hand. */
const enc = encodeURIComponent;

export const PATH = {
  home: "/",                 // the dashboard when signed in (the landing page for visitors when login is required)
  history: "/#history",
  login: "/login",
  register: "/login?tab=register",
  logout: "/logout",
  new: "/new",
  newDay: "/new#day",
  progress: "/progress",
  share: "/progress#share",
  recap: "/recap",
  settings: "/settings",
  help: "/help",
  faq: "/help#faq",
  film: "/help#film",
  contact: "/help#contact",
  how: "/how",
  about: "/about",
  privacy: "/privacy",
  tour: "/?tour=1",
  result: (id: string) => `/sessions/${enc(id)}`,
  video: (id: string) => `/sessions/${enc(id)}/video`,
  /** the next step for a round: send the video, or see the status / result */
  round: (id: string, status: string) => (status === "created" ? `/sessions/${enc(id)}/video` : `/sessions/${enc(id)}`),
  compare: (a?: string, b?: string) => (a && b ? `/compare?a=${enc(a)}&b=${enc(b)}` : "/compare"),
  criterion: (code: string) => `/how#${code}`,
} as const;

/** `?next=` after login: only a path on this site (no "//host", no backslash tricks). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}
