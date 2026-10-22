const { MAX_SLOTS } = require('./constants');
const { showToast } = require('./utils');
const { getSavedGridLayout, saveGridLayout } = require('./storage');
const { updateSlotSizeUI, slotHasContent } = require('./slot');
const { t } = require('./i18n');

function calculateCellHeight(rows) {
  const availableHeight = window.innerHeight - 62; // top nav (50px) + bottom padding
  const margin = 8;
  const totalMargin = (rows - 1) * margin;
  return Math.max(160, Math.floor((availableHeight - totalMargin) / rows));
}

function parsePreset(presetStr) {
  const [r, c] = String(presetStr || '2x2').split('x').map(Number);
  return { rows: r || 2, cols: c || 2 };
}

/**
 * GridStack (>= 13) calls a private `_sortDom()` at the end of every change event, which
 * re-appends each widget so DOM order matches the x/y layout order. Re-attaching a node
 * recreates its layout boxes, so every slot's `.slot-content-container` loses its scroll
 * position (jumps back to the oldest message) whenever any slot is dragged or resized.
 *
 * We never rely on DOM order (slots are addressed via `data-slot-index` / `gs-id` and
 * `saveGridLayout` persists slotIndex per item), so the reorder is pure churn — disable it.
 */
function disableGridDomSorting(grid) {
  if (!grid || typeof grid._sortDom !== 'function') return;
  grid._sortDom = () => grid;
}

function applyGridLayout({ grid, gridContainer, slots, rows, cols, resetPositions = false, maxSlots = MAX_SLOTS }) {
  if (!grid || !gridContainer || !Array.isArray(slots)) return;

  resetColumnHoverEffect(slots);

  const totalSlots = rows * cols;
  const savedLayout = !resetPositions ? getSavedGridLayout() : null;
  const savedBySlot = {};

  if (Array.isArray(savedLayout) && savedLayout.length === totalSlots) {
    savedLayout.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const sIdx = typeof item.slotIndex === 'number'
        ? item.slotIndex
        : (typeof item.id === 'string' && item.id.startsWith('slot-')
            ? parseInt(item.id.replace('slot-', ''), 10)
            : idx);
      if (
        Number.isFinite(sIdx) &&
        sIdx >= 0 &&
        sIdx < totalSlots &&
        typeof item.x === 'number' &&
        typeof item.y === 'number' &&
        typeof item.w === 'number' &&
        typeof item.h === 'number' &&
        item.x >= 0 &&
        item.y >= 0 &&
        item.w >= 1 &&
        item.h >= 1 &&
        item.x + item.w <= cols &&
        item.h <= rows
      ) {
        savedBySlot[sIdx] = { x: item.x, y: item.y, w: item.w, h: item.h };
      }
    });
  }

  // Build target positions for active slots [0 .. totalSlots - 1]
  const occupiedRects = [];
  const activePlans = [];
  for (let i = 0; i < totalSlots; i++) {
    const slot = slots[i];
    if (!slot) continue;
    if (!resetPositions && savedBySlot[i]) {
      occupiedRects.push(savedBySlot[i]);
    }
  }

  const isCellOccupied = (x, y, w = 1, h = 1) =>
    occupiedRects.some(
      r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y
    );

  const findFirstFreeCell = () => {
    for (let y = 0; ; y++) {
      for (let x = 0; x < cols; x++) {
        if (!isCellOccupied(x, y, 1, 1)) {
          return { x, y, w: 1, h: 1 };
        }
      }
    }
  };

  for (let i = 0; i < totalSlots; i++) {
    const slot = slots[i];
    if (!slot) continue;
    let pos;
    if (!resetPositions && savedBySlot[i]) {
      pos = savedBySlot[i];
    } else if (resetPositions || occupiedRects.length === 0) {
      pos = { x: i % cols, y: Math.floor(i / cols), w: 1, h: 1 };
      occupiedRects.push(pos);
    } else {
      const defX = i % cols;
      const defY = Math.floor(i / cols);
      pos = !isCellOccupied(defX, defY, 1, 1)
        ? { x: defX, y: defY, w: 1, h: 1 }
        : findFirstFreeCell();
      occupiedRects.push(pos);
    }
    activePlans.push({ index: i, slot, pos });
  }

  // Sort active slots by target (y, x) ascending so top-gravity packing in GridStack
  // never pulls lower-row widgets upward into not-yet-populated upper cells.
  activePlans.sort((a, b) => (a.pos.y - b.pos.y) || (a.pos.x - b.pos.x) || (a.index - b.index));

  if (typeof grid.batchUpdate === 'function') {
    grid.batchUpdate(true);
  }
  if (grid.engine) {
    grid.engine._loading = true;
  }

  try {
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

    // 2. Purge any orphan elements that do not belong to active slots
    const activeElements = new Set(slots.slice(0, totalSlots).filter(Boolean).map(s => s.element));
    Array.from(gridContainer.children).forEach(child => {
      if (!activeElements.has(child) && !child.classList.contains('grid-stack-placeholder')) {
        try {
          grid.removeWidget(child, true, false);
        } catch (e) {}
        if (child.parentElement) {
          child.remove();
        }
      }
    });

    // 3. Temporarily detach existing active nodes from engine.nodes before column change & repositioning
    // so neither columnChanged nor out-of-order stale coordinates cause collisions.
    if (grid.engine && Array.isArray(grid.engine.nodes)) {
      grid.engine.nodes = grid.engine.nodes.filter(n => !n || !activeElements.has(n.el));
    }

    grid.column(cols, 'none');
    grid.cellHeight(calculateCellHeight(rows));

    // 4. Attach and position active slots in sorted (y, x) order
    for (const { index: i, slot, pos } of activePlans) {
      const el = slot.element;
      const isAttached = !!el.parentElement;

      el.setAttribute('gs-x', String(pos.x));
      el.setAttribute('gs-y', String(pos.y));
      el.setAttribute('gs-w', String(pos.w));
      el.setAttribute('gs-h', String(pos.h));

      if (!isAttached) {
        gridContainer.appendChild(el);
        grid.makeWidget(el, {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          autoPosition: false,
          id: `slot-${i}`
        });
      } else if (el.gridstackNode) {
        const node = el.gridstackNode;
        if (grid.engine && Array.isArray(grid.engine.nodes) && !grid.engine.nodes.includes(node)) {
          grid.engine.nodes.push(node);
        }
        if (node.x === pos.x && node.y === pos.y && node.w === pos.w && node.h === pos.h) {
          if (typeof grid.moveNode === 'function' && grid.engine && grid.engine.nodes.length > 1) {
            grid.moveNode(node, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, forceCollide: true });
          }
          node._dirty = true;
        } else {
          grid.update(el, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, autoPosition: false });
        }
      } else {
        grid.makeWidget(el, {
          x: pos.x,
          y: pos.y,
          w: pos.w,
          h: pos.h,
          autoPosition: false,
          id: `slot-${i}`
        });
      }
      updateSlotSizeUI(slot, pos.w, pos.h);
    }
  } finally {
    if (grid.engine) {
      delete grid.engine._loading;
    }
    if (typeof grid.batchUpdate === 'function') {
      grid.batchUpdate(false);
    }
  }

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
    showToast(t('grid.notEnoughCols', { currentCols, targetW }), 'warning', 4500);
    return;
  }
  if (targetH > currentRows) {
    showToast(t('grid.notEnoughRows', { currentRows, targetH }), 'warning', 4500);
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
      return h ? `@${h}` : t('grid.cardFallbackName');
    }).join(', ');

    showToast(t('grid.conflictResize', { targetH, targetW, conflictNames }), 'warning', 5000);
    return;
  }

  // No content conflict! Update widget position & dimensions
  resetColumnHoverEffect(slots);
  grid.update(slot.element, { x: targetX, y: targetY, w: targetW, h: targetH });
  updateSlotSizeUI(slot, targetW, targetH);
  saveGridLayout(grid);
}

const SECTION_STAY_RESTORE_MS = 20000;
const HEADER_HOVER_DWELL_MS = 140;

let hoverEffectState = {
  expandedSlotIndex: null,
  staySlotIndex: null,
  stayTimer: null,
  headerTimer: null,
  pendingHeaderSlotIndex: null,
  pointerDownInfo: null,
  lastClientX: -1,
  lastClientY: -1,
  isInteractingWithGrid: false
};

function clearHoverTimers() {
  if (hoverEffectState.stayTimer) {
    clearTimeout(hoverEffectState.stayTimer);
    hoverEffectState.stayTimer = null;
  }
  if (hoverEffectState.headerTimer) {
    clearTimeout(hoverEffectState.headerTimer);
    hoverEffectState.headerTimer = null;
  }
  hoverEffectState.pendingHeaderSlotIndex = null;
}

function restartSectionStayTimer(slots) {
  if (hoverEffectState.stayTimer) {
    clearTimeout(hoverEffectState.stayTimer);
    hoverEffectState.stayTimer = null;
  }
  if (hoverEffectState.expandedSlotIndex === null) {
    return;
  }
  hoverEffectState.stayTimer = setTimeout(() => {
    hoverEffectState.stayTimer = null;
    if (hoverEffectState.expandedSlotIndex !== null) {
      restoreColumnHoverEffect(slots);
    }
  }, SECTION_STAY_RESTORE_MS);
}

function formatCellCalc(multiplier) {
  const rounded = Math.round(multiplier * 1000) / 1000;
  if (rounded === 0) return '0px';
  if (rounded === 1) return 'var(--gs-cell-height)';
  return `calc(${rounded} * var(--gs-cell-height))`;
}

function applySlotVerticalGeometry(slot, newY, newH, isExpanded) {
  if (!slot || !slot.element) return;
  slot.element.style.top = formatCellCalc(newY);
  slot.element.style.height = formatCellCalc(newH);
  slot.element.classList.toggle('is-hover-expanded', Boolean(isExpanded));
  slot.element.classList.toggle('is-hover-squeezed', !isExpanded);
}

function restoreSlotVerticalGeometry(slot) {
  if (!slot || !slot.element) return;
  slot.element.classList.remove('is-hover-expanded', 'is-hover-squeezed');
  const n = slot.element.gridstackNode;
  if (!n) {
    slot.element.style.top = '';
    slot.element.style.height = '';
    return;
  }
  slot.element.style.top = n.y
    ? (n.y === 1 ? 'var(--gs-cell-height)' : `calc(${n.y} * var(--gs-cell-height))`)
    : '';
  slot.element.style.height = n.h > 1 ? `calc(${n.h} * var(--gs-cell-height))` : '';
}

function restoreColumnHoverEffect(slots) {
  clearHoverTimers();
  hoverEffectState.staySlotIndex = null;

  if (hoverEffectState.expandedSlotIndex === null) {
    return;
  }

  hoverEffectState.expandedSlotIndex = null;

  if (Array.isArray(slots)) {
    slots.forEach(s => restoreSlotVerticalGeometry(s));
  }
}

function resetColumnHoverEffect(slots) {
  clearHoverTimers();
  hoverEffectState.expandedSlotIndex = null;
  hoverEffectState.staySlotIndex = null;
  hoverEffectState.pointerDownInfo = null;
  if (Array.isArray(slots)) {
    slots.forEach(s => restoreSlotVerticalGeometry(s));
  }
}

function expandSlotInColumn(targetSlot, slots, getGridDimensions) {
  if (!targetSlot || !targetSlot.element || !targetSlot.element.parentElement) return;
  const targetNode = targetSlot.element.gridstackNode;
  if (!targetNode) return;

  const { rows: currentRows, cols: currentCols } = getGridDimensions
    ? getGridDimensions()
    : { rows: 2, cols: 2 };
  const totalSlots = currentRows * currentCols;

  const activeSlots = [];
  for (let i = 0; i < totalSlots; i++) {
    const s = slots[i];
    if (s && s.element && s.element.parentElement && s.element.gridstackNode) {
      activeSlots.push(s);
    }
  }

  // Group slots in the same column span vs other columns
  const colSlots = [];
  const otherSlots = [];
  activeSlots.forEach(s => {
    const n = s.element.gridstackNode;
    const overlapsColumn = (n.x < targetNode.x + targetNode.w) && (n.x + n.w > targetNode.x);
    if (overlapsColumn) {
      colSlots.push(s);
    } else {
      otherSlots.push(s);
    }
  });

  // Restore any slots in other columns
  otherSlots.forEach(s => restoreSlotVerticalGeometry(s));

  // If this column only has a single slot, nothing to squeeze
  if (colSlots.length <= 1) {
    clearHoverTimers();
    hoverEffectState.expandedSlotIndex = null;
    hoverEffectState.staySlotIndex = null;
    restoreSlotVerticalGeometry(targetSlot);
    return;
  }

  clearHoverTimers();
  hoverEffectState.expandedSlotIndex = targetSlot.index;
  hoverEffectState.staySlotIndex = targetSlot.index;

  // Compute new vertical positions per column covered by targetSlot
  const startCol = targetNode.x;
  const endCol = targetNode.x + (targetNode.w || 1);
  let targetApplied = false;

  for (let c = startCol; c < endCol; c++) {
    const trackSlots = colSlots
      .filter(s => {
        const n = s.element.gridstackNode;
        return n.x <= c && (n.x + (n.w || 1)) > c;
      })
      .sort((a, b) => {
        const na = a.element.gridstackNode;
        const nb = b.element.gridstackNode;
        if (na.y !== nb.y) return na.y - nb.y;
        return a.index - b.index;
      });

    if (trackSlots.length <= 1) {
      if (trackSlots[0]) restoreSlotVerticalGeometry(trackSlots[0]);
      continue;
    }

    let bonusH = 0;
    trackSlots.forEach(s => {
      const n = s.element.gridstackNode;
      const origH = (n && n.h) || 1;
      if (s.index !== targetSlot.index) {
        bonusH += origH * 0.5;
      }
    });

    let currentY = (trackSlots[0].element.gridstackNode && trackSlots[0].element.gridstackNode.y) || 0;
    trackSlots.forEach(s => {
      const n = s.element.gridstackNode;
      const origH = (n && n.h) || 1;
      const isTarget = s.index === targetSlot.index;
      const newH = isTarget ? (origH + bonusH) : (origH * 0.5);
      const newY = currentY;
      currentY += newH;

      if (!isTarget || !targetApplied) {
        applySlotVerticalGeometry(s, newY, newH, isTarget);
        if (isTarget) targetApplied = true;
      }
    });
  }

  // Restore after staying in the same section for > 20s
  restartSectionStayTimer(slots);
}

function initColumnHoverEffect({ gridContainer, slots, getGrid, getGridDimensions }) {
  if (!gridContainer || !Array.isArray(slots)) return;

  const isAnyOverlayOpen = () => {
    const postPopup = document.getElementById('tweet-popup-overlay');
    if (postPopup && !postPopup.classList.contains('is-closed')) return true;
    const settingsModal = document.getElementById('settings-modal-overlay');
    if (settingsModal && !settingsModal.classList.contains('is-closed')) return true;
    return false;
  };

  gridContainer.addEventListener('mouseleave', () => {
    if (hoverEffectState.headerTimer) {
      clearTimeout(hoverEffectState.headerTimer);
      hoverEffectState.headerTimer = null;
      hoverEffectState.pendingHeaderSlotIndex = null;
    }
  });

  gridContainer.addEventListener('mousedown', (e) => {
    if (e.button && e.button !== 0) {
      hoverEffectState.pointerDownInfo = null;
      return;
    }
    const target = e.target;
    const inBubbleOrControl = Boolean(
      target &&
      typeof target.closest === 'function' &&
      target.closest('.im-bubble, .im-date-pill, .slot-header, a, button, input, textarea, select, label')
    );
    hoverEffectState.pointerDownInfo = {
      x: e.clientX,
      y: e.clientY,
      inBubbleOrControl
    };
  });

  // Clicking on blank space (outside message bubbles) in a section triggers height expansion
  gridContainer.addEventListener('click', (e) => {
    const downInfo = hoverEffectState.pointerDownInfo;
    hoverEffectState.pointerDownInfo = null;

    if (hoverEffectState.isInteractingWithGrid || isAnyOverlayOpen()) {
      return;
    }
    if (e.button && e.button !== 0) {
      return;
    }
    if (downInfo) {
      if (downInfo.inBubbleOrControl) return;
      if (Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) > 6) return;
    }
    if (typeof window.getSelection === 'function') {
      const sel = window.getSelection();
      if (sel && String(sel).trim().length > 0) return;
    }

    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    // Ignore clicks on message bubbles, date pills, headers, or interactive controls
    if (target.closest('.im-bubble, .im-date-pill, .slot-header, .slot-size-menu, a, button, input, textarea, select, label')) {
      return;
    }

    const contentEl = target.closest('.slot-content-container');
    if (!contentEl) return;

    // Ignore clicks on the scrollbar area of the content container
    const contentRect = contentEl.getBoundingClientRect();
    if (
      e.clientX > contentRect.left + contentEl.clientWidth ||
      e.clientY > contentRect.top + contentEl.clientHeight
    ) {
      return;
    }

    const itemEl = contentEl.closest('.grid-stack-item');
    if (!itemEl || itemEl.parentElement !== gridContainer) return;

    const slotIndex = parseInt(itemEl.getAttribute('data-slot-index'), 10);
    if (!Number.isFinite(slotIndex) || !slots[slotIndex]) return;
    const slot = slots[slotIndex];

    if (hoverEffectState.expandedSlotIndex === slot.index) {
      restoreColumnHoverEffect(slots);
      return;
    }

    expandSlotInColumn(slot, slots, getGridDimensions);
  });

  gridContainer.addEventListener('mousemove', (e) => {
    // Ignore synthetic mousemove fired by layout reflow when cursor is stationary
    if (e.clientX === hoverEffectState.lastClientX && e.clientY === hoverEffectState.lastClientY) {
      return;
    }
    hoverEffectState.lastClientX = e.clientX;
    hoverEffectState.lastClientY = e.clientY;

    if (hoverEffectState.isInteractingWithGrid || isAnyOverlayOpen()) {
      return;
    }

    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    const itemEl = target.closest('.grid-stack-item');
    if (!itemEl || itemEl.parentElement !== gridContainer) return;

    const slotIndex = parseInt(itemEl.getAttribute('data-slot-index'), 10);
    if (!Number.isFinite(slotIndex) || !slots[slotIndex]) return;
    const slot = slots[slotIndex];

    // Moving cursor onto a section's header (用户名那栏) restores column heights
    const headerEl = target.closest('.slot-header');
    if (headerEl) {
      if (hoverEffectState.expandedSlotIndex !== null) {
        const node = slot.element.gridstackNode;
        const isTopRowHeader = Boolean(node && node.y === 0);
        const isExpandedSectionHeader = slot.index === hoverEffectState.expandedSlotIndex;

        if (isTopRowHeader || isExpandedSectionHeader) {
          if (hoverEffectState.headerTimer) {
            clearTimeout(hoverEffectState.headerTimer);
            hoverEffectState.headerTimer = null;
          }
          hoverEffectState.pendingHeaderSlotIndex = null;
          restoreColumnHoverEffect(slots);
        } else if (hoverEffectState.pendingHeaderSlotIndex !== slot.index) {
          if (hoverEffectState.headerTimer) {
            clearTimeout(hoverEffectState.headerTimer);
          }
          hoverEffectState.pendingHeaderSlotIndex = slot.index;
          hoverEffectState.headerTimer = setTimeout(() => {
            hoverEffectState.headerTimer = null;
            hoverEffectState.pendingHeaderSlotIndex = null;
            restoreColumnHoverEffect(slots);
          }, HEADER_HOVER_DWELL_MS);
        }
      }
      return;
    }

    // Cursor is not in header: cancel any pending header restore timer
    if (hoverEffectState.headerTimer) {
      clearTimeout(hoverEffectState.headerTimer);
      hoverEffectState.headerTimer = null;
      hoverEffectState.pendingHeaderSlotIndex = null;
    }

    // Track 20s stay duration per section while a column is expanded
    if (hoverEffectState.expandedSlotIndex !== null && hoverEffectState.staySlotIndex !== slot.index) {
      hoverEffectState.staySlotIndex = slot.index;
      restartSectionStayTimer(slots);
    }
  });

  const grid = getGrid ? getGrid() : null;
  if (grid) {
    grid.on('dragstart resizestart', () => {
      hoverEffectState.isInteractingWithGrid = true;
      resetColumnHoverEffect(slots);
    });
    grid.on('dragstop resizestop', () => {
      hoverEffectState.isInteractingWithGrid = false;
      saveGridLayout(grid);
    });
  }
}

module.exports = {
  calculateCellHeight,
  parsePreset,
  disableGridDomSorting,
  applyGridLayout,
  requestSlotResize,
  initColumnHoverEffect,
  resetColumnHoverEffect
};

