"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Fades its children up the first time they scroll into view. */
export default function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
  direction,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** Render as a list item when used inside <ol>/<ul>. */
  as?: "div" | "li";
  /** Slide direction: "left" or "right". Defaults to fade-up. */
  direction?: "left" | "right";
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement & HTMLLIElement>}
      className={`${direction ? `reveal-${direction}` : "reveal"} ${visible ? "is-visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
