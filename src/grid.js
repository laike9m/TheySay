const { MAX_SLOTS } = require('./constants');
const { showToast } = require('./utils');
const { saveGridLayout } = require('./storage');
const { updateSlotSizeUI, slotHasContent } = require('./slot');

function calculateCellHeight(rows) {
  const availableHeight = window.innerHeight - 70; // top nav + padding
  const margin = 8;
  const totalMargin = (rows - 1) * margin;
  return Math.max(160, Math.floor((availableHeight - totalMargin) / rows));
}

function parsePreset(presetStr) {
  const [r, c] = presetStr.split('x').map(Number);
  return { rows: r || 2, cols: c || 2 };
}

function applyGridLayout({ grid, gridContainer, slots, rows, cols, resetPositions = false, maxSlots = MAX_SLOTS }) {
  if (!grid || !gridContainer || !Array.isArray(slots)) return;

  grid.column(cols);
  grid.cellHeight(calculateCellHeight(rows));

  const totalSlots = rows * cols;

  // 1. Remove widgets beyond totalSlots from GridStack and DOM
  for (let i = totalSlots; i < maxSlots; i++) {
    const slot = slots[i];
    if (slot && slot.element.parentElement) {
      try {
        grid.removeWidget(slot.element, true, false);
      } catch (e) {}
      if (slot.element.parentElement) {
        slot.element.remove();
      }
    }
    if (slot) {
      updateSlotSizeUI(slot, 1, 1);
    }
  }

  // 2. Attach and position active slots
  for (let i = 0; i < totalSlots; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const isAttached = !!slot.element.parentElement;
    const col = i % cols;
    const row = Math.floor(i / cols);

    if (!isAttached) {
      gridContainer.appendChild(slot.element);
      grid.makeWidget(slot.element);
      grid.update(slot.element, { x: col, y: row, w: 1, h: 1 });
      updateSlotSizeUI(slot, 1, 1);
    } else if (resetPositions || !slot.element.gridstackNode) {
      grid.update(slot.element, { x: col, y: row, w: 1, h: 1 });
      updateSlotSizeUI(slot, 1, 1);
    }
  }

  // 3. Purge any orphan elements that do not belong to active slots
  const activeElements = new Set(slots.slice(0, totalSlots).map(s => s.element));
  Array.from(gridContainer.children).forEach(child => {
    if (!activeElements.has(child)) {
      try {
        grid.removeWidget(child, true, false);
      } catch (e) {}
      if (child.parentElement) {
        child.remove();
      }
    }
  });

  saveGridLayout(grid);
}

function requestSlotResize({ grid, slot, targetW, targetH, currentRows, currentCols, slots }) {
  if (!grid || !slot) return;
  const node = slot.element.gridstackNode;
  if (!node) return;

  // Already at target size
  if (node.w === targetW && node.h === targetH) {
    return;
  }

  // Restoring to 1x1 is always allowed
  if (targetW === 1 && targetH === 1) {
    grid.update(slot.element, { w: 1, h: 1 });
    updateSlotSizeUI(slot, 1, 1);
    saveGridLayout(grid);
    return;
  }

  // Check if grid capacity is sufficient (targetH is rows, targetW is cols)
  if (targetW > currentCols) {
    showToast(`当前网格仅有 ${currentCols} 列，无法容纳 ${targetW} 列宽度的卡片。请先在顶部切换更大列数的网格布局。`, 'warning', 4500);
    return;
  }
  if (targetH > currentRows) {
    showToast(`当前网格仅有 ${currentRows} 行，无法容纳 ${targetH} 行高度的卡片。请先在顶部切换更多行的网格布局。`, 'warning', 4500);
    return;
  }

  // Determine target coordinates in the grid (stay in bounds)
  let targetX = node.x;
  let targetY = node.y;

  if (targetX + targetW > currentCols) {
    targetX = Math.max(0, currentCols - targetW);
  }
  if (targetY + targetH > currentRows) {
    targetY = Math.max(0, currentRows - targetH);
  }

  // Collision detection: Check if any other slots inside target rectangle have content
  const conflicts = [];
  const totalSlots = currentRows * currentCols;

  for (let i = 0; i < totalSlots; i++) {
    const otherSlot = slots[i];
    if (!otherSlot || otherSlot.index === slot.index) continue;
    if (!otherSlot.element.parentElement) continue;
    const otherNode = otherSlot.element.gridstackNode;
    if (!otherNode) continue;

    // Check if otherNode intersects with [targetX, targetX + targetW) x [targetY, targetY + targetH)
    const overlaps = (
      otherNode.x < targetX + targetW &&
      otherNode.x + otherNode.w > targetX &&
      otherNode.y < targetY + targetH &&
      otherNode.y + otherNode.h > targetY
    );

    if (overlaps && slotHasContent(otherSlot)) {
      conflicts.push(otherSlot);
    }
  }

  if (conflicts.length > 0) {
    // Shake and highlight conflicting slots in red
    conflicts.forEach(c => {
      c.card.classList.remove('slot-card-conflict');
      void c.card.offsetWidth; // force DOM reflow
      c.card.classList.add('slot-card-conflict');
      setTimeout(() => c.card.classList.remove('slot-card-conflict'), 1800);
    });

    const conflictNames = conflicts.map(c => {
      const h = c.handleInput.value.trim();
      return h ? `@${h}` : `卡片`;
    }).join('、');

    showToast(`⚠️ 无法放大为 ${targetH}×${targetW}：周边格子 (${conflictNames}) 已有内容。请先将周边的格子移开，或把它们清除掉后再试。`, 'warning', 5000);
    return;
  }

  // No content conflict! Update widget position & dimensions
  grid.update(slot.element, { x: targetX, y: targetY, w: targetW, h: targetH });
  updateSlotSizeUI(slot, targetW, targetH);
  saveGridLayout(grid);
}

module.exports = {
  calculateCellHeight,
  parsePreset,
  applyGridLayout,
  requestSlotResize
};
