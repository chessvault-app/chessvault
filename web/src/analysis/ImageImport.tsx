import { ImagePlus, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAnalysis } from '@/store/analysis';
import { grayFromCanvas } from '@/puzzles/ocr/browser';
import { cropDiagram } from '@/puzzles/ocr/browser';
import { classifyBoardNet, loadCellNet } from '@/puzzles/ocr/cellnet';
import { labelsToFen } from '@/puzzles/ocr/classify';
import { detectDiagrams } from '@/puzzles/ocr/detect';
import { Button } from '@/ui/Button';

/**
 * Import a position from a picture — screenshot, book photo, whatever. The
 * same reader as the puzzle-book pipeline: find the diagram (or assume the
 * whole image is one), rectify it, classify the 64 cells, load the FEN.
 * The side to move is unrecognizable from pixels; White is assumed and the
 * player can flip it via FEN if needed.
 */
export function ImportImageButton() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const read = async (file: File): Promise<void> => {
    setState('busy');
    try {
      const bitmap = await createImageBitmap(file);
      // Cap the working size: detection was tuned near page-render scale.
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const gray = grayFromCanvas(canvas);
      const rect = detectDiagrams(gray)[0] ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
      const { board } = cropDiagram(canvas, rect);
      const net = await loadCellNet();
      if (!net) throw new Error('model unavailable');
      const readings = classifyBoardNet(net, board);
      const fen = labelsToFen(readings.map((r) => r.label), false);
      if (!useAnalysis.getState().loadFen(fen)) throw new Error('unreadable');
      setState('idle');
    } catch {
      setState('failed');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={state === 'busy'}
        title={state === 'failed' ? 'Could not read a board from that image' : 'Import a position from an image'}
        className={state === 'failed' ? 'text-bad' : undefined}
        onClick={() => input.current?.click()}
      >
        {state === 'busy' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ImagePlus className="size-3.5" />
        )}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void read(file);
        }}
      />
    </>
  );
}
