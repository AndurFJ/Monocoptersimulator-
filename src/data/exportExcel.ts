/**
 * exportExcel — descarga una grabación como .xlsx para PID Tuner.
 *
 * Hojas: PID_Tuner (Ts constante), Datos_crudos (tal cual llegaron), Info.
 */

import type { TelemetrySample } from './types';
import { resampleUniform, pidTunerRows, rawRows, infoRows } from './recording';

const SOURCE_LABELS: Record<string, string> = {
  simulacion: 'Simulación',
  serial: 'Serial en vivo',
  reproduccion: 'Reproducción',
};

function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Genera y descarga el Excel. Devuelve el nombre del archivo. */
export async function exportRecording(samples: readonly TelemetrySample[], source: string): Promise<string> {
  if (samples.length < 2) throw new Error('No hay suficientes datos grabados.');

  // SheetJS pesa ~1 MB: se carga solo cuando se usa
  const XLSX = await import('xlsx');
  const date = new Date();
  const fileName = `ensayo_${source}_${fileStamp(date)}.xlsx`;
  const series = resampleUniform(samples);

  const wb = XLSX.utils.book_new();
  const tuner = XLSX.utils.aoa_to_sheet(pidTunerRows(series));
  tuner['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, tuner, 'PID_Tuner');

  const raw = XLSX.utils.aoa_to_sheet(rawRows(samples));
  raw['!cols'] = [{ wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, raw, 'Datos_crudos');

  const info = XLSX.utils.aoa_to_sheet(infoRows(samples, series, {
    source: SOURCE_LABELS[source] ?? source,
    date,
    fileName,
  }));
  info['!cols'] = [{ wch: 32 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, info, 'Info');

  XLSX.writeFile(wb, fileName, { compression: true });
  return fileName;
}
