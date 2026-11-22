import React from 'react';
import {
  ArrowRightToLine,
  Circle,
  Columns2,
  Expand,
  FastForward,
  Hand,
  MoveHorizontal,
  MousePointer2,
  PenTool,
  Scissors,
  Search,
  SlidersHorizontal,
  Square,
  Type,
  AlignVerticalJustifyCenter,
} from 'lucide-react';
import type { EditorTool } from '../types/editor';

interface ToolsPanelProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onCreateQuickOverlay: (tool: 'pen' | 'rectangle' | 'ellipse' | 'type' | 'verticalType') => void;
}

const TOOLS: Array<{
  id: EditorTool;
  label: string;
  keyHint: string;
  icon: React.ReactNode;
  isCreate?: boolean;
}> = [
  { id: 'select', label: 'Selection Tool', keyHint: 'V', icon: <MousePointer2 size={13} /> },
  { id: 'trackForward', label: 'Track Select Forward', keyHint: 'A', icon: <FastForward size={13} /> },
  { id: 'ripple', label: 'Ripple Edit Tool', keyHint: 'Shift+R', icon: <ArrowRightToLine size={13} /> },
  { id: 'rolling', label: 'Rolling Edit Tool', keyHint: 'Shift+E', icon: <Columns2 size={13} /> },
  { id: 'rateStretch', label: 'Rate Stretch Tool', keyHint: 'R', icon: <Expand size={13} /> },
  { id: 'razor', label: 'Razor Tool', keyHint: 'C', icon: <Scissors size={13} /> },
  { id: 'slip', label: 'Slip Tool', keyHint: 'Y', icon: <SlidersHorizontal size={13} /> },
  { id: 'slide', label: 'Slide Tool', keyHint: 'U', icon: <MoveHorizontal size={13} /> },
  { id: 'pen', label: 'Pen Tool (Shape / Mask)', keyHint: 'P', icon: <PenTool size={13} />, isCreate: true },
  { id: 'rectangle', label: 'Rectangle Tool', keyHint: '', icon: <Square size={13} />, isCreate: true },
  { id: 'ellipse', label: 'Ellipse Tool', keyHint: '', icon: <Circle size={13} />, isCreate: true },
  { id: 'hand', label: 'Hand Tool', keyHint: 'H', icon: <Hand size={13} /> },
  { id: 'zoom', label: 'Zoom Tool', keyHint: 'Z', icon: <Search size={13} /> },
  { id: 'type', label: 'Type Tool', keyHint: 'T', icon: <Type size={13} />, isCreate: true },
  { id: 'verticalType', label: 'Vertical Type Tool', keyHint: 'Shift+T', icon: <AlignVerticalJustifyCenter size={13} />, isCreate: true },
];

export const ToolsPanel: React.FC<ToolsPanelProps> = ({
  activeTool,
  onSelectTool,
  onCreateQuickOverlay,
}) => {
  return (
    <div className="tools-strip" role="toolbar" aria-label="Editing Tools Panel">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`tool-icon-btn ${activeTool === tool.id ? 'active' : ''}`}
          title={`${tool.label}${tool.keyHint ? ` (${tool.keyHint})` : ''}`}
          onClick={() => {
            onSelectTool(tool.id);
            if (tool.isCreate) {
              onCreateQuickOverlay(tool.id as 'pen' | 'rectangle' | 'ellipse' | 'type' | 'verticalType');
            }
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
};
