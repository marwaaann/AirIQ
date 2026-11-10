import type { ReactNode } from "react";

/**
 * Safe, minimal markdown: **bold**, "- " / "* " / "1. " lists, paragraphs and
 * line breaks. Everything is rendered as React text nodes; no raw HTML is
 * ever injected.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyBase}-b${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] } | { kind: "ol"; items: string[] };

export function Markdown({ text }: { text: string }) {
  const blocks: Block[] = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (ul) {
      if (last?.kind === "ul") last.items.push(ul[1]);
      else blocks.push({ kind: "ul", items: [ul[1]] });
    } else if (ol) {
      if (last?.kind === "ol") last.items.push(ol[1]);
      else blocks.push({ kind: "ol", items: [ol[1]] });
    } else if (line.trim() === "") {
      blocks.push({ kind: "p", lines: [] });
    } else if (last?.kind === "p") {
      last.lines.push(line.replace(/^#+\s*/, ""));
    } else {
      blocks.push({ kind: "p", lines: [line.replace(/^#+\s*/, "")] });
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, bi) => {
        if (b.kind === "ul")
          return (
            <ul key={bi} className="list-disc pl-5">
              {b.items.map((it, ii) => (
                <li key={ii}>{inline(it, `${bi}-${ii}`)}</li>
              ))}
            </ul>
          );
        if (b.kind === "ol")
          return (
            <ol key={bi} className="list-decimal pl-5">
              {b.items.map((it, ii) => (
                <li key={ii}>{inline(it, `${bi}-${ii}`)}</li>
              ))}
            </ol>
          );
        if (b.lines.length === 0) return null;
        return (
          <p key={bi}>
            {b.lines.map((l, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                {inline(l, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
