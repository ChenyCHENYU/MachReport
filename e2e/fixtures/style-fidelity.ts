import type { RenderPlan } from "../../packages/mach-report/src/schema/render-plan";
const noBorders = { borderTop: false, borderRight: false, borderBottom: false, borderLeft: false };
export const styleFidelityPlan: RenderPlan = { schemaVersion: "style-fidelity", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [
  { kind: "rect", leftMm: 10, topMm: 10, widthMm: 40, heightMm: 20, style: { ...noBorders, opacity: .5, backgroundColor: "#FF0000" }, grid: { paddingMm: 0, cells: [[{ children: [
    { kind: "rect", leftMm: 5, topMm: 5, widthMm: 20, heightMm: 10, style: { ...noBorders, backgroundColor: "#0000FF" } }
  ] }]] } },
  { kind: "text", leftMm: 70, topMm: 10, widthMm: 10, heightMm: 30, text: "Turn", style: { fontSize: 10, backgroundColor: "#00FF00", opacity: .5, rotateDeg: 90 } },
  { kind: "rect", leftMm: 10, topMm: 50, widthMm: 40, heightMm: 20, style: { backgroundColor: "#FFFF00" }, grid: { paddingMm: 2, cells: [[{
    text: "Cell", style: { opacity: .5, rotateDeg: 45, backgroundColor: "#0000FF", color: "#FFFFFF" }, children: [
      { kind: "rect", leftMm: 30, topMm: 2, widthMm: 20, heightMm: 8, style: { ...noBorders, backgroundColor: "#FF00FF" } }
    ]
  }]] } }
  , { kind: "rect", leftMm: -10, topMm: 80, widthMm: 20, heightMm: 10, style: { ...noBorders, backgroundColor: "#00FFFF", opacity: .5, rotateDeg: 90 } }
] }] };
