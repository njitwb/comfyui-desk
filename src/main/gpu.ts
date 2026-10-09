import { run } from './util'
import type { GpuInfo } from '../shared/api'
import { t } from './i18n'
import { isWin } from './platform'

function vendorOf(name: string): GpuInfo['vendor'] {
  const n = name.toLowerCase()
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('gtx')) return 'nvidia'
  if (n.includes('amd') || n.includes('radeon')) return 'amd'
  if (n.includes('intel')) return 'intel'
  return 'unknown'
}

/** nvidia-smi 读显存（MB）：WMI/Windows 的 AdapterRAM 上限 4GB，不可靠 */
async function nvidiaVram(): Promise<number[]> {
  try {
    const r = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { timeoutMs: 8000 })
    if (r.code === 0) return r.out.split(/\r?\n/).map(l => parseInt(l.trim(), 10) || 0).filter(n => n > 0)
  } catch {
    /* ignore */
  }
  return []
}

/** Windows：WMI 检测显卡型号与驱动版本，NVIDIA 卡附带显存 */
async function detectWindows(): Promise<GpuInfo[]> {
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

/** POSIX：nvidia-smi（CSV：name,driver,memory）检测 NVIDIA；无 NVIDIA 时用 lspci 识别 AMD/Intel */
async function detectPosix(): Promise<GpuInfo[]> {
  const gpus: GpuInfo[] = []
  try {
    const r = await run('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'], { timeoutMs: 8000 })
    for (const line of r.out.split(/\r?\n/)) {
      const [name, driver, vram] = line.split(',').map(s => s.trim())
      if (!name) continue
      gpus.push({ name, driver: driver || '', vendor: vendorOf(name), vram: parseInt(vram, 10) || 0 })
    }
  } catch {
    /* nvidia-smi 不存在或不可用 */
  }
  // 无 NVIDIA 卡时才用 lspci 补充 AMD / Intel 集成卡
  if (!gpus.some(g => g.vendor === 'nvidia')) {
    try {
      const r = await run('lspci', ['-nn'], { timeoutMs: 8000 })
      for (const line of r.out.split(/\r?\n/)) {
        const m = line.match(/VGA compatible controller: (.+)/)
        if (!m) continue
        const name = m[1].replace(/\[[0-9a-f]{4}:[0-9a-f]{4}\]/g, '').trim()
        if (!name) continue
        gpus.push({ name, driver: '', vendor: vendorOf(name), vram: 0 })
      }
    } catch {
      /* lspci 不可用 */
    }
  }
  return gpus
}

export async function detectGpu(): Promise<GpuInfo[]> {
  return isWin ? detectWindows() : detectPosix()
}
