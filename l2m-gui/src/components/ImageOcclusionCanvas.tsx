import React, { useState, useRef, useEffect } from 'react';
import { Trash2, Check, EyeOff, Move } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ImageOcclusionMask } from '../utils/anki';

interface ImageOcclusionCanvasProps {
  masks: ImageOcclusionMask[];
  activeMaskId: string | null;
  mode: 'hide_one' | 'hide_all';
  isDrawingMode: boolean;
  onAddMask: (mask: ImageOcclusionMask) => void;
  onUpdateMask: (mask: ImageOcclusionMask) => void;
  onDeleteMask: (id: string) => void;
  onSelectMask: (id: string | null) => void;
  onChangeMode: (mode: 'hide_one' | 'hide_all') => void;
  onToggleDrawingMode: () => void;
  onClearSlideMasks?: () => void;
}

export const ImageOcclusionCanvas: React.FC<ImageOcclusionCanvasProps> = ({
  masks,
  activeMaskId,
  mode,
  isDrawingMode,
  onAddMask,
  onUpdateMask,
  onDeleteMask,
  onSelectMask,
  onChangeMode,
  onToggleDrawingMode,
  onClearSlideMasks,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing state
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);

  // Moving existing mask state
  const [draggingMaskId, setDraggingMaskId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);

  // Resizing existing mask state
  const [resizingMaskId, setResizingMaskId] = useState<string | null>(null);

  // Label editing state
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState<string>('');

  const getRelativeCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    return { x, y };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-mask-element]') || target.closest('button') || target.closest('input')) {
      return;
    }

    if (!isDrawingMode) {
      onSelectMask(null);
      return;
    }

    const coords = getRelativeCoords(e);
    setIsMouseDown(true);
    setStartPos(coords);
    setCurrentPos(coords);
  };

  // Start moving an existing mask
  const handleMaskMouseDown = (e: React.MouseEvent, mask: ImageOcclusionMask) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('[data-resize-handle]')) {
      return;
    }
    e.stopPropagation();
    onSelectMask(mask.id);

    const coords = getRelativeCoords(e);
    setDraggingMaskId(mask.id);
    setDragOffset({
      x: coords.x - mask.x,
      y: coords.y - mask.y,
    });
  };

  // Start resizing an existing mask (bottom-right handle)
  const handleResizeMouseDown = (e: React.MouseEvent, mask: ImageOcclusionMask) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectMask(mask.id);
    setResizingMaskId(mask.id);
  };

  // Global window listeners for mousemove and mouseup to guarantee drags/resizes don't get stuck
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isMouseDown && !draggingMaskId && !resizingMaskId) return;
      const coords = getRelativeCoords(e);

      if (resizingMaskId) {
        const mask = masks.find((m) => m.id === resizingMaskId);
        if (mask) {
          const newW = Math.max(2, Math.min(100 - mask.x, coords.x - mask.x));
          const newH = Math.max(2, Math.min(100 - mask.y, coords.y - mask.y));
          onUpdateMask({
            ...mask,
            width: Math.round(newW * 10) / 10,
            height: Math.round(newH * 10) / 10,
          });
        }
      } else if (draggingMaskId && dragOffset) {
        const mask = masks.find((m) => m.id === draggingMaskId);
        if (mask) {
          const newX = Math.max(0, Math.min(100 - mask.width, coords.x - dragOffset.x));
          const newY = Math.max(0, Math.min(100 - mask.height, coords.y - dragOffset.y));
          onUpdateMask({
            ...mask,
            x: Math.round(newX * 10) / 10,
            y: Math.round(newY * 10) / 10,
          });
        }
      } else if (isMouseDown && startPos && isDrawingMode) {
        setCurrentPos(coords);
      }
    };

    const handleGlobalMouseUp = () => {
      if (isMouseDown && startPos && currentPos && isDrawingMode) {
        const minX = Math.min(startPos.x, currentPos.x);
        const maxX = Math.max(startPos.x, currentPos.x);
        const minY = Math.min(startPos.y, currentPos.y);
        const maxY = Math.max(startPos.y, currentPos.y);

        const width = maxX - minX;
        const height = maxY - minY;

        // Minimum size threshold to prevent accidental tiny clicks (2% x 2%)
        if (width >= 2 && height >= 2) {
          const newMask: ImageOcclusionMask = {
            id: `mask-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            x: Math.round(minX * 10) / 10,
            y: Math.round(minY * 10) / 10,
            width: Math.round(width * 10) / 10,
            height: Math.round(height * 10) / 10,
            label: '',
          };
          onAddMask(newMask);
          onSelectMask(newMask.id);
          setEditingLabelId(newMask.id);
          setTempLabel('');
        }
      }

      setIsMouseDown(false);
      setStartPos(null);
      setCurrentPos(null);
      setDraggingMaskId(null);
      setResizingMaskId(null);
      setDragOffset(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [
    isMouseDown,
    draggingMaskId,
    resizingMaskId,
    dragOffset,
    startPos,
    currentPos,
    isDrawingMode,
    masks,
    onAddMask,
    onSelectMask,
    onUpdateMask,
  ]);

  // Draft rectangle coordinates while user is dragging to draw
  const draftRect =
    isMouseDown && startPos && currentPos
      ? {
          x: Math.min(startPos.x, currentPos.x),
          y: Math.min(startPos.y, currentPos.y),
          width: Math.abs(currentPos.x - startPos.x),
          height: Math.abs(currentPos.y - startPos.y),
        }
      : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleCanvasMouseDown}
      className={`absolute inset-0 z-20 select-none ${
        isDrawingMode ? 'cursor-crosshair' : 'cursor-default'
      }`}
    >
      {/* Top Floating Mini-Toolbar */}
      <div className="absolute top-2 left-2 right-2 flex flex-wrap items-center justify-between gap-2 z-30 pointer-events-auto">
        <div className="flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700/80 shadow-lg text-xs">
          <button
            type="button"
            onClick={onToggleDrawingMode}
            className={`px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              isDrawingMode
                ? 'bg-rose-500 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={t('occlusion.draw_tooltip')}
          >
            <EyeOff className="w-3.5 h-3.5" />
            {isDrawingMode ? t('occlusion.draw_active') : t('occlusion.draw_button')}
          </button>

          <div className="h-4 w-px bg-slate-700 mx-1" />

          {/* Mode Selector: Hide One vs Hide All */}
          <div className="flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-slate-700">
            <button
              type="button"
              onClick={() => onChangeMode('hide_one')}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition cursor-pointer ${
                mode === 'hide_one'
                  ? 'bg-accent text-white font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('occlusion.hide_one_tooltip')}
            >
              {t('occlusion.hide_one')}
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('hide_all')}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition cursor-pointer ${
                mode === 'hide_all'
                  ? 'bg-accent text-white font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('occlusion.hide_all_tooltip')}
            >
              {t('occlusion.hide_all')}
            </button>
          </div>
        </div>

        {/* Counter Badge & Clear Button */}
        {masks.length > 0 && (
          <div className="flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-700/80 shadow-lg text-xs">
            <span className="text-[11px] font-medium text-slate-300">
              {t(masks.length === 1 ? 'occlusion.mask_count' : 'occlusion.mask_count_plural', { count: masks.length })}
            </span>
            {onClearSlideMasks && (
              <button
                type="button"
                onClick={onClearSlideMasks}
                className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline ml-1 cursor-pointer font-medium"
              >
                {t('occlusion.clear_masks')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Draft rectangle while dragging to draw */}
      {draftRect && (
        <div
          style={{
            left: `${draftRect.x}%`,
            top: `${draftRect.y}%`,
            width: `${draftRect.width}%`,
            height: `${draftRect.height}%`,
          }}
          className="absolute border-2 border-rose-500 bg-rose-500/30 rounded-md pointer-events-none transition-none shadow-md"
        />
      )}

      {/* Render Existing Masks */}
      {masks.map((mask, idx) => {
        const isSelected = mask.id === activeMaskId;

        return (
          <div
            key={mask.id}
            data-mask-element="true"
            onMouseDown={(e) => handleMaskMouseDown(e, mask)}
            style={{
              left: `${mask.x}%`,
              top: `${mask.y}%`,
              width: `${mask.width}%`,
              height: `${mask.height}%`,
            }}
            className={`absolute rounded-md transition-all group pointer-events-auto cursor-move flex items-center justify-center ${
              isSelected
                ? 'bg-rose-600/90 border-2 border-white shadow-xl ring-2 ring-rose-500/50 z-20'
                : mode === 'hide_all'
                ? 'bg-blue-600/85 border border-blue-400 shadow-md hover:border-white z-10'
                : 'bg-rose-500/85 border border-rose-400 shadow-md hover:border-white z-10'
            }`}
          >
            {/* Mask Text / Question Mark Indicator */}
            <span className="text-white font-bold text-xs px-1 truncate select-none drop-shadow-md pointer-events-none">
              {mask.label ? mask.label : `? (${idx + 1})`}
            </span>

            {/* Resize Handle in bottom-right corner of selected mask */}
            {isSelected && (
              <div
                data-resize-handle="true"
                data-mask-element="true"
                onMouseDown={(e) => handleResizeMouseDown(e, mask)}
                className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-rose-600 rounded-full cursor-nwse-resize shadow-md z-30"
                title={t('occlusion.resize_tooltip')}
              />
            )}

            {/* Controls when mask is selected */}
            {isSelected && (
              <div
                data-mask-element="true"
                onClick={(e) => e.stopPropagation()}
                className={`absolute ${
                  mask.y < 15 ? 'top-full mt-2' : '-top-10'
                } left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-900 border border-slate-700 shadow-2xl rounded-lg p-1 z-30 whitespace-nowrap`}
              >
                {editingLabelId === mask.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      autoFocus
                      value={tempLabel}
                      onChange={(e) => setTempLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onUpdateMask({ ...mask, label: tempLabel.trim() });
                          setEditingLabelId(null);
                        } else if (e.key === 'Escape') {
                          setEditingLabelId(null);
                        }
                      }}
                      placeholder={t('occlusion.label_placeholder')}
                      className="px-2 py-0.5 text-xs bg-slate-800 border border-slate-600 rounded text-slate-100 focus:outline-none focus:border-rose-400 w-44"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateMask({ ...mask, label: tempLabel.trim() });
                        setEditingLabelId(null);
                      }}
                      className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-500 cursor-pointer"
                      title={t('occlusion.save_label')}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTempLabel(mask.label || '');
                      setEditingLabelId(mask.id);
                    }}
                    className="px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:text-white bg-slate-800 rounded hover:bg-slate-700 cursor-pointer max-w-[120px] truncate"
                    title={t('occlusion.edit_label')}
                  >
                    {mask.label || t('occlusion.add_label')}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onDeleteMask(mask.id)}
                  className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 rounded cursor-pointer transition"
                  title={t('occlusion.delete_mask')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ImageOcclusionCanvas;
