/**
 * Client-side PNG / PDF export of a rendered report node (html-to-image +
 * jsPDF, both already dependencies). Loaded lazily from the report page.
 */

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function rgbOf(css: string): [number, number, number] {
  const m = css.match(/\d+(\.\d+)?/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
}

async function renderPng(node: HTMLElement): Promise<{ dataUrl: string; width: number; height: number; bg: string }> {
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const width = node.scrollWidth;
  const height = node.scrollHeight;
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: bg,
    width,
    height,
    cacheBust: true,
    // Buttons and other screen-only controls are not part of the export.
    filter: (el) => !(el instanceof HTMLElement && el.dataset.exportIgnore === "true"),
  });
  return { dataUrl, width, height, bg };
}

export async function exportReportPng(node: HTMLElement, filename: string): Promise<void> {
  const { dataUrl } = await renderPng(node);
  download(dataUrl, filename);
}

/** A4 portrait PDF; tall reports are split across pages. */
export async function exportReportPdf(node: HTMLElement, filename: string): Promise<void> {
  const [{ dataUrl, width, height, bg }, { jsPDF }] = await Promise.all([renderPng(node), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const imgW = pageW - margin * 2;
  const imgH = (height / width) * imgW;
  const usable = pageH - margin * 2;
  const [r, g, b] = rgbOf(bg);
  let offset = 0;
  let page = 0;
  while (offset < imgH) {
    if (page > 0) pdf.addPage();
    pdf.setFillColor(r, g, b);
    pdf.rect(0, 0, pageW, pageH, "F");
    // Draw the whole image shifted up; the page clips it to this slice.
    pdf.addImage(dataUrl, "PNG", margin, margin - offset, imgW, imgH, undefined, "FAST");
    // Page-colored strips over the margins so slices don't bleed into them.
    pdf.setFillColor(r, g, b);
    pdf.rect(0, 0, pageW, margin, "F");
    pdf.rect(0, pageH - margin, pageW, margin, "F");
    offset += usable;
    page++;
  }
  pdf.save(filename);
}
