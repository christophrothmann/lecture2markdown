import React, { useRef, useState } from 'react';
import { UploadCloud, FileText } from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';

interface DropzoneProps {
  onFileSelectedPath: (filePath: string, fileName: string) => void;
  disabled?: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({ onFileSelectedPath, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleClick = async () => {
    if (disabled) return;

    try {
      // Native Tauri file picker returns absolute path
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: 'PDF Vorlesungen', extensions: ['pdf'] }],
      });

      if (selected && typeof selected === 'string') {
        const pathParts = selected.split(/[\/\\]/);
        const fileName = pathParts[pathParts.length - 1] || 'Vorlesung.pdf';
        onFileSelectedPath(selected, fileName);
      }
    } catch {
      // Fallback for HTML file input if needed
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
      const file = e.dataTransfer.files[0];
      const filePath = (file as any).path;
      if (!filePath) {
        alert('Drag & Drop liefert keinen Dateipfad. Bitte klicke, um eine PDF auszuwählen.');
        return;
      }
      onFileSelectedPath(filePath, file.name);
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
            Ziehe deine Vorlesungs-PDF hierher
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Oder klicke hier, um eine PDF-Datei auf deinem Computer auszuwählen
          </p>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-slate-500 bg-background/50 px-3 py-1.5 rounded-lg border border-border/50">
          <FileText className="w-3.5 h-3.5" />
          <span>Unterstützt PDF-Vorlesungsfolien jeder Größe</span>
        </div>
      </div>
    </div>
  );
};
