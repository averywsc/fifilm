import React, { useRef, useState } from 'react';
import { Copy, Download, FolderKanban, Plus, Trash2, Upload } from 'lucide-react';
import type { FifilmProject } from '../types/editor';
import { formatTimecode } from '../engine/timecode';

interface ProjectsModalProps {
  projects: FifilmProject[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onCreateProject: (name?: string) => void;
  onDuplicateProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onExportProjectFile: (id: string) => void;
  onImportProjectFile: (file: File) => void;
  onClose: () => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
  onExportProjectFile,
  onImportProjectFile,
  onClose,
}) => {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVal, setEditingVal] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreate = () => {
    onCreateProject(newName.trim() || undefined);
    setNewName('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={importInputRef}
          type="file"
          accept=".fifilm,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              onImportProjectFile(f);
              e.target.value = '';
            }
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <FolderKanban size={16} />
            Projects ({projects.length})
          </h2>
          <button type="button" className="subtle ghost-sm" onClick={() => importInputRef.current?.click()}>
            <Upload size={12} />
            Open .fifilm
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <input
            type="text"
            style={{ flex: 1 }}
            placeholder="New project name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <button type="button" className="primary" onClick={handleCreate}>
            <Plus size={13} />
            New Project
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
          {projects.map((proj) => {
            const isActive = proj.id === activeProjectId;
            const dur = proj.clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
            const isEditing = editingId === proj.id;

            return (
              <div
                key={proj.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: isActive ? 'var(--surface-3)' : 'var(--bg)',
                  boxShadow: isActive ? 'inset 0 0 0 1.5px var(--acc)' : 'none',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  if (!isEditing) onSelectProject(proj.id);
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingVal}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingVal(e.target.value)}
                      onBlur={() => {
                        if (editingVal.trim()) onRenameProject(proj.id, editingVal.trim());
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingVal.trim()) onRenameProject(proj.id, editingVal.trim());
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      style={{ width: '100%', padding: '3px 6px' }}
                    />
                  ) : (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingId(proj.id);
                        setEditingVal(proj.name);
                      }}
                      title="Double-click to rename"
                    >
                      <strong style={{ fontSize: 13, color: 'var(--acc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {proj.name}
                      </strong>
                      {isActive && (
                        <span className="mono" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--acc)', color: 'var(--acc-ink)', fontWeight: 600 }}>
                          Active
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mono" style={{ fontSize: 11, color: 'var(--mute)', marginTop: 2 }}>
                    {proj.clips.length} clip{proj.clips.length === 1 ? '' : 's'} / {formatTimecode(dur, 24)}
                  </div>
                </div>

                <button
                  type="button"
                  className="subtle ghost-sm"
                  title="Rename project"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(proj.id);
                    setEditingVal(proj.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="subtle ghost-sm"
                  title="Duplicate project"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateProject(proj.id);
                  }}
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  className="subtle ghost-sm"
                  title="Save editable .fifilm project file"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExportProjectFile(proj.id);
                  }}
                >
                  <Download size={12} />
                </button>
                <button
                  type="button"
                  className="subtle ghost-sm"
                  disabled={projects.length <= 1}
                  title="Delete project"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProject(proj.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <p className="status-note" style={{ marginTop: 12 }}>
          Projects auto-save locally so you can keep multiple edits open and switch instantly.
        </p>

        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
