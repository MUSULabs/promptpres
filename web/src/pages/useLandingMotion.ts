import { useLayoutEffect, type RefObject } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function useLandingMotion(landing: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const content = landing.current;
    const shell = content?.closest<HTMLElement>(".pp-v1");
    const hero = content?.querySelector<SVGSVGElement>(".landing-art");
    const start = content?.querySelector<HTMLAnchorElement>(".landing-start");
    const story = content?.querySelector<HTMLElement>(".landing-how");
    const stage = story?.querySelector<HTMLElement>(".landing-story-stage");
    if (!shell || !hero || !start || !story || !stage || typeof IntersectionObserver !== "function") return;

    const chapters = [...story.querySelectorAll<HTMLElement>("[data-landing-chapter]")];
    const inlineArts = [...story.querySelectorAll<HTMLElement>(".landing-story-inline")];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const wide = matchMedia("(min-width: 1024px) and (min-height: 720px)");
    const mouse = matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    let visible = false;
    let greeted = false;
    let frame = 0;
    let pointer: { target: Element; x: number; y: number } | undefined;

    function clearPointer(target: Element) {
      if (pointer?.target === target) pointer = undefined;
      const style = (target as HTMLElement | SVGElement).style;
      style.removeProperty("--pointer-x");
      style.removeProperty("--pointer-y");
    }

    const update = () => {
      frame = 0;
      const position = pointer;
      pointer = undefined;
      const bounds = position?.target.getBoundingClientRect();
      const midpoint = window.innerHeight / 2;
      const storyBounds = visible && wide.matches ? chapters.map(chapter => chapter.getBoundingClientRect()) : [];
      if (position && bounds?.width && bounds.height) {
        const style = (position.target as HTMLElement | SVGElement).style;
        const limit = position.target === start ? 2.8 : 6.75;
        const x = clamp(2 * (position.x - bounds.left) / bounds.width - 1, -1, 1);
        const y = clamp(2 * (position.y - bounds.top) / bounds.height - 1, -1, 1);
        style.setProperty("--pointer-x", `${x * limit}px`);
        style.setProperty("--pointer-y", `${y * limit}px`);
      }
      if (storyBounds.length) {
        const index = storyBounds.reduce((active, chapter, i) => chapter.top <= midpoint ? i : active, 0);
        const chapter = storyBounds[index];
        const progress = clamp((midpoint - chapter.top) / chapter.height, 0, 1);
        const key = chapters[index].dataset.landingChapter;
        if (stage.dataset.chapter !== key) stage.dataset.chapter = key;
        stage.style.setProperty("--chapter-shift", `${(0.5 - progress) * 32}px`);
        stage.style.setProperty("--story-progress", String((index + progress) / chapters.length));
      }
    };

    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    function onScroll() {
      if (visible && wide.matches && !reduced.matches) schedule();
    }

    function trackPointer(event: Event) {
      const { pointerType, clientX, clientY, currentTarget } = event as PointerEvent;
      if (!mouse.matches || reduced.matches || pointerType !== "mouse") return;
      pointer = { target: currentTarget as Element, x: clientX, y: clientY };
      schedule();
    }

    function stopPointer(event: Event) {
      clearPointer(event.currentTarget as Element);
    }

    const greet = (event: PointerEvent) => {
      if (!greeted && mouse.matches && !reduced.matches && event.pointerType === "mouse") {
        greeted = true;
        hero.dataset.greet = "";
      }
    };

    const observer = new IntersectionObserver(entries => {
      if (reduced.matches) return;
      for (const { target, isIntersecting } of entries) {
        if (target === story) {
          visible = isIntersecting;
          onScroll();
        } else if (isIntersecting) {
          (target as HTMLElement).dataset.entered = "";
          observer.unobserve(target);
        }
      }
    }, { threshold: 0.12 });

    const configure = () => {
      observer.disconnect();
      visible = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearPointer(hero);
      clearPointer(start);
      shell.toggleAttribute("data-landing-motion", !reduced.matches);
      story.toggleAttribute("data-story-motion", !reduced.matches && wide.matches);
      if (reduced.matches) {
        delete hero.dataset.greet;
        return;
      }
      if (wide.matches) observer.observe(story);
      else inlineArts.filter(art => !art.hasAttribute("data-entered")).forEach(art => observer.observe(art));
    };

    reduced.addEventListener("change", configure);
    wide.addEventListener("change", configure);
    mouse.addEventListener("change", configure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    for (const target of [hero, start]) {
      target.addEventListener("pointermove", trackPointer, { passive: true });
      target.addEventListener("pointerleave", stopPointer);
      target.addEventListener("pointercancel", stopPointer);
    }
    hero.addEventListener("pointerenter", greet);
    configure();

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      reduced.removeEventListener("change", configure);
      wide.removeEventListener("change", configure);
      mouse.removeEventListener("change", configure);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const target of [hero, start]) {
        target.removeEventListener("pointermove", trackPointer);
        target.removeEventListener("pointerleave", stopPointer);
        target.removeEventListener("pointercancel", stopPointer);
        clearPointer(target);
      }
      hero.removeEventListener("pointerenter", greet);
      delete hero.dataset.greet;
      delete shell.dataset.landingMotion;
      delete story.dataset.storyMotion;
    };
  }, [landing]);
}
