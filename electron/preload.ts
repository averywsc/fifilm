import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ExportRequest } from '../src/types/editor';
import type { StabilizeJobParams } from './backend';

contextBridge.exposeInMainWorld('fifilm', {
  isElectron: true,
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  getCapabilities: () => ipcRenderer.invoke('fifilm:capabilities'),
  listLuts: () => ipcRenderer.invoke('fifilm:list-luts'),
  readLut: (filePath: string) => ipcRenderer.invoke('fifilm:read-lut', filePath),
  saveLutToColorstudies: (name: string, content: string) =>
    ipcRenderer.invoke('fifilm:save-lut', name, content),
  stabilizeVideo: (params: StabilizeJobParams) =>
    ipcRenderer.invoke('fifilm:stabilize', params),
  onStabilizeProgress: (cb: (data: { progress: number; stage: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, data: { progress: number; stage: string }) => cb(data);
    ipcRenderer.on('fifilm:stabilize-progress', listener);
    return () => ipcRenderer.removeListener('fifilm:stabilize-progress', listener);
  },
  exportVideo: (req: ExportRequest) => ipcRenderer.invoke('fifilm:export', req),
  extractWaveform: (filePath: string) => ipcRenderer.invoke('fifilm:waveform', filePath),
  analyzeBeats: (filePath: string) => ipcRenderer.invoke('fifilm:analyze-beats', filePath),
  stageMedia: (fileName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('fifilm:stage-media', fileName, bytes),
  pickVideoFiles: () => ipcRenderer.invoke('fifilm:pick-video'),
  pickExportPath: (defaultName: string) =>
    ipcRenderer.invoke('fifilm:pick-export-path', defaultName),
  revealInExplorer: (filePath: string) =>
    ipcRenderer.invoke('fifilm:reveal-path', filePath),
});
