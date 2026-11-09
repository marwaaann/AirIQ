import type { AqiCategory } from "@/lib/aqi-categories";

/**
 * Category color swatch with its pattern, plus the text label.
 * Color, pattern and text together mean the category never relies on color alone.
 */
export function CategorySwatch({ category, className = "h-4 w-4" }: { category: AqiCategory; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-[4px] ring-1 ring-black/15 aqi-pattern-${category.pattern} ${className}`}
      style={{ backgroundColor: category.color }}
    />
  );
}

export function CategoryBadge({ category, size = "md" }: { category: AqiCategory; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}
      style={{ backgroundColor: category.color, color: category.textColor }}
    >
      <span
        aria-hidden
        className={`inline-block rounded-full ring-1 ring-black/20 aqi-pattern-${category.pattern} ${size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"}`}
        style={{ backgroundColor: category.color }}
      />
      {category.label}
    </span>
  );
}
