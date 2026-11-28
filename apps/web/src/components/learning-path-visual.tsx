import { Box, Check, MousePointer2, Play, Sparkles } from 'lucide-react';
/** A lightweight explanation of the product journey; no WebGL or model download. */
export function LearningPathVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div className={'learning-path-visual' + (compact ? ' is-compact' : '')} aria-hidden="true">
      <div className="path-visual-top">
        <span>
          <Box size={14} /> Interactive lesson
        </span>
        <span>
          <i /> Ready to explore
        </span>
      </div>
      <div className="path-visual-scene">
        <div className="path-visual-grid" />
        <div className="path-visual-shape path-shape-cube">
          <span />
          <span />
          <span />
        </div>
        <div className="path-visual-shape path-shape-sphere" />
        <div className="path-visual-pin">
          <span>01</span> Explore a component
        </div>
        <div className="path-visual-pointer">
          <MousePointer2 size={18} /> Select to understand
        </div>
      </div>
      <div className="path-visual-bottom">
        <span>
          <Play size={13} /> Explore
        </span>
        <span>
          <Sparkles size={13} /> Ask & practise
        </span>
        <span>
          <Check size={13} /> Take it with you
        </span>
      </div>
    </div>
  );
}
