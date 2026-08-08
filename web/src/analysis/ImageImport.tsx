import { ImagePlus } from 'lucide-react';
import { useState } from 'react';
import { useAnalysis } from '@/store/analysis';
import { builtinTemplates } from '@/puzzles/ocr/builtin';
import type { Template } from '@/puzzles/ocr/classify';
import { PhotoImport } from '@/puzzles/PhotoImport';
import { Button } from '@/ui/Button';

/**
 * Import a position from a picture — the SAME PhotoImport dialog the
 * editor uses (corner adjustment, orientation toggle, template reading),
 * so the flow is identical everywhere; only the destination differs:
 * here the reading lands on the analysis board.
 */
export function ImportImageButton() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Import a position from an image"
        onClick={() => {
          void builtinTemplates()
            .then(setTemplates)
            .catch(() => setTemplates([]));
        }}
      >
        <ImagePlus className="size-3.5" />
      </Button>
      {templates !== null && (
        <PhotoImport
          templates={templates}
          onApply={(reading) => {
            if (reading.fen) useAnalysis.getState().loadFen(reading.fen);
            setTemplates(null);
          }}
          onClose={() => setTemplates(null)}
        />
      )}
    </>
  );
}
