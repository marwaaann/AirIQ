import { ImageResponse } from "next/og";

const SIZES = { "192": 192, "512": 512, maskable: 512 } as const;

/** PNG app icons for the manifest (192, 512 and a maskable 512 with safe-zone padding). */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!(size in SIZES)) return new Response("Not found", { status: 404 });
  const key = size as keyof typeof SIZES;
  const px = SIZES[key];
  const maskable = key === "maskable";
  // Maskable icons must keep content inside the central 80% circle.
  const inner = maskable ? px * 0.6 : px;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: maskable ? "#0f766e" : "transparent" }}>
        <div
          style={{
            width: inner,
            height: inner,
            borderRadius: maskable ? inner / 2 : px * 0.22,
            background: "#0f766e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: inner * 0.56,
            fontWeight: 800,
          }}
        >
          A
        </div>
      </div>
    ),
    { width: px, height: px, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
