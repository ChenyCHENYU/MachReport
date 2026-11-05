import { computed, type ComputedRef } from "vue";
import { resolveGridLayout, type GridCellBox } from "../render/grid-geometry";
import type { TemplateComponent } from "../layout/paginate";

interface CanvasGridLayout { cells: GridCellBox[]; limited: boolean }

/** Component-local reactive geometry survives selection/zoom renders. Weak keys
 * release replaced pages, and in-place dimensions, spans and grid edits invalidate it. */
export function createCanvasGridLayouts() {
  const entries = new WeakMap<TemplateComponent, ComputedRef<CanvasGridLayout>>();
  function read(component: TemplateComponent): CanvasGridLayout {
    let entry = entries.get(component);
    if (!entry) {
      entry = computed(() => {
        const grid = component.kind === "list" ? component.headerGrid : component.grid;
        if (!grid) return { cells: [], limited: false };
        const height = component.kind === "list"
          ? grid.rowHeightsMm?.reduce((sum, value) => sum + value, 0) ?? grid.cells.length * 8
          : component.heightMm;
        const cells = resolveGridLayout(grid, component.widthMm, height).cells;
        return component.kind === "list" ? { cells, limited: false } : {
          cells: cells.slice(0, 2000),
          limited: grid.cells.reduce((sum, row) => sum + row.length, 0) > 2000,
        };
      });
      entries.set(component, entry);
    }
    return entry.value;
  }
  return { read };
}
