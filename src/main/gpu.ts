import { run } from './util'
import type { GpuInfo } from '../shared/api'
import { t } from './i18n'

function vendorOf(name: string): GpuInfo['vendor'] {
  const n = name.toLowerCase()
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('gtx')) return 'nvidia'
  if (n.includes('amd') || n.includes('radeon')) return 'amd'
  if (n.includes('intel')) return 'intel'
  return 'unknown'
}

/** nvidia-smi 读显存（MB）：WMI 的 AdapterRAM 上限 4GB，不可靠 */
async function nvidiaVram(): Promise<number[]> {
  try {
    const r = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeoutMs: 8000 })
    if (r.code === 0) return r.out.split(/\r?\n/).map(l => parseInt(l.trim(), 10) || 0).filter(n => n > 0)
  } catch {
    /* ignore */
  }
  return []
}

/** WMI 检测显卡型号与驱动版本，NVIDIA 卡附带显存 */
export async function detectGpu(): Promise<GpuInfo[]> {
  const ps = 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'
  try {
    const r = await run('powershell', ['-NoProfile', '-Command', ps], { timeoutMs: 15000 })
    if (r.code === 0 && r.out.trim()) {
      const data = JSON.parse(r.out.trim())
      const arr: { Name: string; DriverVersion: string }[] = Array.isArray(data) ? data : [data]
      const gpus = arr.map(x => ({
        name: x.Name || t('m.gpu.unknownName'),
        driver: x.DriverVersion || '',
        vendor: vendorOf(x.Name || ''),
        vram: 0
      }))
      if (gpus.some(g => g.vendor === 'nvidia')) {
        // nvidia-smi 只列 NVIDIA 卡，按出现顺序一一对应
        const vrams = await nvidiaVram()
        let i = 0
        for (const g of gpus) {
          if (g.vendor === 'nvidia' && i < vrams.length) g.vram = vrams[i++]
        }
      }
      return gpus
    }
  } catch {
    /* ignore */
  }
  return []
}
