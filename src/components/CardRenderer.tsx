import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { collection } from "@/data/collection";
import { cn } from "@/lib/utils";

interface CardRendererProps {
  html: string;
  css: string;
  className?: string;
}

const scopeCss = (css: string, scope: string): string => css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, close: string, selectors: string) => `${close} ${selectors.split(",").map((s) => `${scope} ${s.trim()}`).join(", ")} {`);

/**
 * Renders note HTML safely. Media references (`<img src="name.png">`, `[sound:name.mp3]`) are resolved
 * against the local media store and swapped for object URLs after mount.
 */
export const CardRenderer = ({ html, css, className }: CardRendererProps): JSX.Element => {
  const ref = useRef<HTMLDivElement>(null);
  const scopeId = useMemo(() => `card-${Math.random().toString(36).slice(2, 8)}`, []);
  const safe = useMemo(() => {
    const withSound = html.replace(/\[sound:([^\]]+)\]/g, (_m, name: string) => `<audio controls data-media="${name}" class="mx-auto my-2"></audio>`);
    return DOMPurify.sanitize(withSound, { ADD_TAGS: ["audio", "source", "video", "details", "summary", "kbd"], ADD_ATTR: ["controls", "data-media", "data-answer", "autoplay", "open"] });
  }, [html]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const urls: string[] = [];
    let cancelled = false;
    const resolve = async (): Promise<void> => {
      const media = root.querySelectorAll<HTMLElement>("img[src], audio[data-media], video[src], source[src]");
      for (const el of Array.from(media)) {
        const name = el.getAttribute("data-media") ?? el.getAttribute("src") ?? "";
        if (!name || /^(https?:|data:|blob:|\/)/.test(name)) continue;
        const blob = await collection.getMedia(decodeURIComponent(name));
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        el.setAttribute("src", url);
      }
    };
    void resolve();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [safe]);

  return (
    <div className={cn("card-content", className)}>
      <style>{scopeCss(css, `#${scopeId}`)}</style>
      <div id={scopeId}>
        <div ref={ref} className="card" dangerouslySetInnerHTML={{ __html: safe }} />
      </div>
    </div>
  );
};
