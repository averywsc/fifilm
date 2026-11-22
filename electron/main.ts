import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  analyzeBeatsOnDisk,
  extractFfmpegWaveform,
  probeHardwareCapabilities,
  readLutFilePayload,
  runHardwareExport,
  runVideoStabilization,
  saveCubeLutToColorstudies,
  scanColorstudiesLuts,
  stageUploadedMedia,
  type StabilizeJobParams,
} from './backend';
import type { ExportRequest } from '../src/types/editor';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#080C18',
    title: 'Fifilm',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/app.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('fifilm:capabilities', () => probeHardwareCapabilities());
  ipcMain.handle('fifilm:list-luts', () => scanColorstudiesLuts());
  ipcMain.handle('fifilm:read-lut', (_e, filePath: string) => readLutFilePayload(filePath));
  ipcMain.handle('fifilm:save-lut', (_e, name: string, content: string) =>
    saveCubeLutToColorstudies(name, content)
  );
  ipcMain.handle('fifilm:stabilize', (event, params: StabilizeJobParams) =>
    runVideoStabilization(params, (progress, stage) => {
      event.sender.send('fifilm:stabilize-progress', { progress, stage });
    })
  );
  ipcMain.handle('fifilm:export', (_e, req: ExportRequest) => runHardwareExport(req));
  ipcMain.handle('fifilm:waveform', (_e, filePath: string) => extractFfmpegWaveform(filePath));
  ipcMain.handle('fifilm:analyze-beats', (_e, filePath: string) => analyzeBeatsOnDisk(filePath));
  ipcMain.handle('fifilm:stage-media', (_e, fileName: string, bytes: Uint8Array) =>
    stageUploadedMedia(fileName, Buffer.from(bytes))
  );

  ipcMain.handle('fifilm:pick-video', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import Video or Music Media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media Files',
          extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wav', 'flac', 'mp3', 'm4a', 'ogg'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('fifilm:pick-export-path', async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Export Graded Video',
      defaultPath: defaultName,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'QuickTime ProRes', extensions: ['mov'] },
        { name: 'WAV Audio', extensions: ['wav'] },
        { name: 'MP3 Audio', extensions: ['mp3'] },
      ],
    });
    return res.canceled ? null : res.filePath;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
