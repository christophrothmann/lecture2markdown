import React, { useState, useEffect } from 'react';
import { UploadCloud, FileText, Layers, ShieldCheck } from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useTranslation } from 'react-i18next';

export interface SelectedFileInfo {
  path: string;
  name: string;
}

interface DropzoneProps {
  onFilesSelected: (files: SelectedFileInfo[]) => void;
  disabled?: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({ onFilesSelected, disabled }) => {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  // Native OS Drag & Drop listener via Tauri v2 Webview (100% reliable on Windows 11, macOS, Linux)
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disabled) return;

        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDragging(true);
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            const pdfFiles: SelectedFileInfo[] = paths
              .filter((p) => typeof p === 'string' && p.toLowerCase().endsWith('.pdf'))
              .map((p) => {
                const parts = p.split(/[\/\\]/);
                const fileName = parts[parts.length - 1] || 'Vorlesung.pdf';
                return { path: p, name: fileName };
              });

            if (pdfFiles.length > 0) {
              onFilesSelected(pdfFiles);
            }
          }
        }
      })
      .then((unlisten) => {
        unlistenFn = unlisten;
      });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [disabled, onFilesSelected]);

  const handleClick = async () => {
    if (disabled) return;

    try {
      // Native Tauri file picker with multiple files support
      const selected = await openFileDialog({
        multiple: true,
        filters: [{ name: t('dropzone.browse_filter'), extensions: ['pdf'] }],
      });

      if (selected) {
        const filePaths = Array.isArray(selected) ? selected : [selected];
        const files: SelectedFileInfo[] = filePaths
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          .map((p) => {
            const pathParts = p.split(/[\/\\]/);
            const fileName = pathParts[pathParts.length - 1] || 'Vorlesung.pdf';
            return { path: p, name: fileName };
          });

        if (files.length > 0) {
          onFilesSelected(files);
        }
      }
    } catch {
      // User cancelled dialog
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      const files: SelectedFileInfo[] = [];

      for (const file of droppedFiles) {
        const filePath = (file as any).path;
        if (filePath && filePath.toLowerCase().endsWith('.pdf')) {
          files.push({ path: filePath, name: file.name });
        }
      }

      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`glass-card rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 border-2 border-dashed ${
        isDragging
          ? 'border-accent bg-accent/10 scale-[1.01]'
          : 'border-border hover:border-slate-500 hover:bg-surface-hover/50'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className="p-4 bg-card border border-border rounded-2xl text-accent shadow-inner">
          <UploadCloud className="w-10 h-10" />
        </div>

        <div>
          <h3 className="text-lg font-bold text-slate-100">
            {t('dropzone.title')}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {t('dropzone.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <div className="flex items-center space-x-2 text-[11px] text-slate-400 bg-background/60 px-3 py-1.5 rounded-lg border border-border/50">
            <Layers className="w-3.5 h-3.5 text-accent" />
            <span>{t('dropzone.batch_queue')}</span>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-slate-400 bg-background/60 px-3 py-1.5 rounded-lg border border-border/50">
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span>{t('dropzone.smart_routing')}</span>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-slate-400 bg-background/60 px-3 py-1.5 rounded-lg border border-border/50">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t('dropzone.encrypted')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
