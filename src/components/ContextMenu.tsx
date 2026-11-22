import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioChannelMode, ClipColorLabel, MarkerType, TimelineClip } from '../types/editor';

export type ContextMenuAction =
  | { type: 'cut' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'pasteInsert' }
  | { type: 'pasteAttributes' }
  | { type: 'clear' }
  | { type: 'rippleDelete' }
  | { type: 'closeGap' }
  | { type: 'rippleDeleteGaps' }
  | { type: 'selectAtOrAfterPlayhead' }
  | { type: 'selectBeforePlayhead' }
  | { type: 'removeThroughEdit' }
  | { type: 'toggleEnabled' }
  | { type: 'toggleLink' }
  | { type: 'toggleGroup' }
  | { type: 'setColorLabel'; label: ClipColorLabel }
  | { type: 'nest' }
  | { type: 'nestNewSequence' }
  | { type: 'speedDuration' }
  | { type: 'timeRemapping' }
  | { type: 'frameHold' }
  | { type: 'holdSegment' }
  | { type: 'addEdit' }
  | { type: 'matchFrame' }
  | { type: 'replaceFromSource' }
  | { type: 'markIn' }
  | { type: 'markOut' }
  | { type: 'clearInOut' }
  | { type: 'scaleToFrameSize' }
  | { type: 'setToFrameSize' }
  | { type: 'autoMixAudio' }
  | { type: 'audioChannels'; mode: AudioChannelMode }
  | { type: 'audioGain' }
  | { type: 'synchronize' }
  | { type: 'addMarker'; markerType: MarkerType }
  | { type: 'clearMarker' }
  | { type: 'clearAllMarkers' }
  | { type: 'savePreset' }
  | { type: 'removeEffects' }
  | { type: 'removeVideoEffects' }
  | { type: 'removeAudioEffects' }
  | { type: 'removeAttributes' }
  | { type: 'renderAndReplace' }
  | { type: 'exportSelectedClip' }
  | { type: 'properties' }
  | { type: 'interpretFootage' }
  | { type: 'revealInProject' }
  | { type: 'revealInExplorer' };

interface ContextMenuProps {
  x: number;
  y: number;
  clip: TimelineClip | null;
  hasClipboard: boolean;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
}

const COLOR_LABELS: Array<{ id: ClipColorLabel; name: string; hex: string }> = [
  { id: 'default', name: 'Default', hex: '#475569' },
  { id: 'iris', name: 'Iris', hex: '#818cf8' },
  { id: 'cerulean', name: 'Cerulean', hex: '#38bdf8' },
  { id: 'forest', name: 'Forest', hex: '#34d399' },
  { id: 'amber', name: 'Amber', hex: '#fbbf24' },
  { id: 'rose', name: 'Rose', hex: '#fb7185' },
  { id: 'violet', name: 'Violet', hex: '#c084fc' },
  { id: 'mango', name: 'Mango', hex: '#fb923c' },
];

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  clip,
  hasClipboard,
  onAction,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const sections = useMemo(() => {
    const run = (action: ContextMenuAction) => () => {
      onAction(action);
      onClose();
    };

    const all: Array<{
      group: string;
      items: Array<{ label: string; hint?: string; disabled?: boolean; onClick: () => void }>;
    }> = [
      {
        group: 'Clipboard & Edit',
        items: [
          { label: 'Cut', hint: 'Ctrl+X', disabled: !clip, onClick: run({ type: 'cut' }) },
          { label: 'Copy', hint: 'Ctrl+C', disabled: !clip, onClick: run({ type: 'copy' }) },
          { label: 'Paste', hint: 'Ctrl+V', disabled: !hasClipboard, onClick: run({ type: 'paste' }) },
          { label: 'Paste Insert', disabled: !hasClipboard, onClick: run({ type: 'pasteInsert' }) },
          { label: 'Paste Attributes', disabled: !hasClipboard || !clip, onClick: run({ type: 'pasteAttributes' }) },
          { label: 'Clear', hint: 'Del', disabled: !clip, onClick: run({ type: 'clear' }) },
          { label: 'Ripple Delete', hint: 'Shift+Del', disabled: !clip, onClick: run({ type: 'rippleDelete' }) },
          { label: 'Close Gap', onClick: run({ type: 'closeGap' }) },
          { label: 'Ripple Delete Gaps', onClick: run({ type: 'rippleDeleteGaps' }) },
          { label: 'Select All Clips at or After Playhead', onClick: run({ type: 'selectAtOrAfterPlayhead' }) },
          { label: 'Select All Clips Before Playhead', onClick: run({ type: 'selectBeforePlayhead' }) },
          { label: 'Remove Through Edit', disabled: !clip, onClick: run({ type: 'removeThroughEdit' }) },
        ],
      },
      {
        group: 'Clip State & Structure',
        items: [
          {
            label: clip?.disabled ? 'Enable' : 'Disable',
            hint: 'Shift+E',
            disabled: !clip,
            onClick: run({ type: 'toggleEnabled' }),
          },
          {
            label: clip?.linkGroupId ? 'Unlink' : 'Link',
            hint: 'Ctrl+L',
            disabled: !clip,
            onClick: run({ type: 'toggleLink' }),
          },
          {
            label: clip?.groupId ? 'Ungroup' : 'Group',
            hint: 'Ctrl+G',
            disabled: !clip,
            onClick: run({ type: 'toggleGroup' }),
          },
          { label: 'Nest', disabled: !clip, onClick: run({ type: 'nest' }) },
          { label: 'Nest into New Sequence', disabled: !clip, onClick: run({ type: 'nestNewSequence' }) },
          { label: 'Add Edit (Razor at Playhead)', hint: 'B', onClick: run({ type: 'addEdit' }) },
          { label: 'Match Frame', hint: 'F', disabled: !clip, onClick: run({ type: 'matchFrame' }) },
          {
            label: 'Replace with Clip from Source Monitor',
            disabled: !clip,
            onClick: run({ type: 'replaceFromSource' }),
          },
        ],
      },
      {
        group: 'Speed, Frame & Scaling',
        items: [
          { label: 'Speed/Duration...', disabled: !clip, onClick: run({ type: 'speedDuration' }) },
          { label: 'Time Remapping (Keyframes)', disabled: !clip, onClick: run({ type: 'timeRemapping' }) },
          { label: 'Frame Hold (Freeze)', hint: 'Shift+F', disabled: !clip, onClick: run({ type: 'frameHold' }) },
          { label: 'Hold Segment', disabled: !clip, onClick: run({ type: 'holdSegment' }) },
          { label: 'Scale to Frame Size', disabled: !clip, onClick: run({ type: 'scaleToFrameSize' }) },
          { label: 'Set to Frame Size', disabled: !clip, onClick: run({ type: 'setToFrameSize' }) },
          { label: 'Mark In', hint: 'I', onClick: run({ type: 'markIn' }) },
          { label: 'Mark Out', hint: 'O', onClick: run({ type: 'markOut' }) },
          { label: 'Clear In and Out', hint: 'Alt+X', onClick: run({ type: 'clearInOut' }) },
        ],
      },
      {
        group: 'Audio Mix & Sync',
        items: [
          { label: 'Auto-Mix Seamless Crossfade', onClick: run({ type: 'autoMixAudio' }) },
          { label: 'Audio Gain...', disabled: !clip, onClick: run({ type: 'audioGain' }) },
          { label: 'Audio Channels: Stereo', disabled: !clip, onClick: run({ type: 'audioChannels', mode: 'stereo' }) },
          { label: 'Audio Channels: Fill Left with Right', disabled: !clip, onClick: run({ type: 'audioChannels', mode: 'fillLeftWithRight' }) },
          { label: 'Audio Channels: Fill Right with Left', disabled: !clip, onClick: run({ type: 'audioChannels', mode: 'fillRightWithLeft' }) },
          { label: 'Audio Channels: Swap Channels', disabled: !clip, onClick: run({ type: 'audioChannels', mode: 'swapChannels' }) },
          { label: 'Synchronize Clips', onClick: run({ type: 'synchronize' }) },
        ],
      },
      {
        group: 'Markers',
        items: [
          { label: 'Add Marker', hint: 'M', onClick: run({ type: 'addMarker', markerType: 'standard' }) },
          { label: 'Add Chapter Marker', onClick: run({ type: 'addMarker', markerType: 'chapter' }) },
          { label: 'Add Web Link Marker', onClick: run({ type: 'addMarker', markerType: 'webLink' }) },
          { label: 'Add Flash Cue Point Marker', onClick: run({ type: 'addMarker', markerType: 'flashCue' }) },
          { label: 'Add Event Cue Point Marker', onClick: run({ type: 'addMarker', markerType: 'eventCue' }) },
          { label: 'Clear Marker at Playhead', onClick: run({ type: 'clearMarker' }) },
          { label: 'Clear All Markers', onClick: run({ type: 'clearAllMarkers' }) },
        ],
      },
      {
        group: 'Effects, Presets & Render',
        items: [
          { label: 'Save Preset...', disabled: !clip, onClick: run({ type: 'savePreset' }) },
          { label: 'Remove Video Effects', disabled: !clip, onClick: run({ type: 'removeVideoEffects' }) },
          { label: 'Remove Audio Effects', disabled: !clip, onClick: run({ type: 'removeAudioEffects' }) },
          { label: 'Remove Effects (All)', disabled: !clip, onClick: run({ type: 'removeEffects' }) },
          { label: 'Remove Attributes (All)', disabled: !clip, onClick: run({ type: 'removeAttributes' }) },
          { label: 'Render and Replace', disabled: !clip, onClick: run({ type: 'renderAndReplace' }) },
          { label: 'Export Selected Clip...', disabled: !clip, onClick: run({ type: 'exportSelectedClip' }) },
        ],
      },
      {
        group: 'Media & Info',
        items: [
          { label: 'Modify / Interpret Footage...', disabled: !clip, onClick: run({ type: 'interpretFootage' }) },
          { label: 'Properties', disabled: !clip, onClick: run({ type: 'properties' }) },
          { label: 'Reveal in Project', disabled: !clip, onClick: run({ type: 'revealInProject' }) },
          { label: 'Reveal in Explorer / Finder', disabled: !clip, onClick: run({ type: 'revealInExplorer' }) },
        ],
      },
    ];

    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => it.label.toLowerCase().includes(q)),
      }))
      .filter((s) => s.items.length > 0);
  }, [clip, hasClipboard, filter, onAction, onClose]);

  const menuW = 264;
  const menuH = 440;
  const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuW - 12));
  const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuH - 12));

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left, top, width: menuW, maxHeight: menuH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-search-wrap">
        <input
          type="search"
          placeholder={clip ? `Actions for "${clip.name}"...` : 'Timeline actions...'}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
      </div>

      {clip && !filter && (
        <div className="ctx-color-row">
          <span className="ctx-group-label">Label</span>
          <div style={{ display: 'flex', gap: 5 }}>
            {COLOR_LABELS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={`Clip Label: ${c.name}`}
                className={`ctx-swatch ${(clip.colorLabel || 'default') === c.id ? 'active' : ''}`}
                style={{ background: c.hex }}
                onClick={() => {
                  onAction({ type: 'setColorLabel', label: c.id });
                  onClose();
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="ctx-scroll">
        {sections.map((sec) => (
          <div key={sec.group} className="ctx-section">
            <div className="ctx-group-label">{sec.group}</div>
            {sec.items.map((item) => (
              <button
                key={item.label}
                type="button"
                className="ctx-item"
                disabled={item.disabled}
                onClick={item.onClick}
              >
                <span>{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
