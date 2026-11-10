/**
 * 整合包 zip 读写：
 * - 读：先解析中央目录做安全检查（路径穿越 / 符号链接 / 大小上限），再用系统工具解压
 *   （Windows=PowerShell Expand-Archive；POSIX=unzip，缺失时回退 tar，复用安装器已验证的策略）。
 * - 写：node:zlib 手写 store/deflate 的 zip，支持文件流式写入（store + data descriptor），
 *   不引入新依赖；限制单文件 2GB / 总包 4GB，避免实现 zip64。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { run } from './util'
import { isWin } from './platform'
import { t } from './i18n'

/** 单个条目上限：2GB（超过应改用云端链接） */
export const ZIP_MAX_ENTRY_BYTES = 2 * 1024 * 1024 * 1024
/** 整包解压后上限：8GB（防 zip bomb） */
export const ZIP_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024
/** 条目数上限（标准 EOCD 上限） */
export const ZIP_MAX_ENTRIES = 65535

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_DESC = 0x08074b50

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** 增量 CRC32（prev 传上一段的返回值） */
function crc32Update(prev: number, buf: Buffer): number {
  let c = (prev ^ 0xffffffff) >>> 0
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntryInfo {
  name: string
  /** 未压缩大小 */
  size: number
  compressedSize: number
  /** Unix 模式高 16 位（判断符号链接） */
  externalAttr: number
  flags: number
}

/** 解析中央目录，只读元数据，不解压 */
export function listZipEntries(zipPath: string): ZipEntryInfo[] {
  const fd = fs.openSync(zipPath, 'r')
  try {
    const stat = fs.fstatSync(fd)
    const tailLen = Math.min(stat.size, 65557)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error(t('m.pack.errBadZip'))
    const count = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error(t('m.pack.errZip64'))
    }
    if (count > ZIP_MAX_ENTRIES) throw new Error(t('m.pack.errTooManyEntries', { n: String(count) }))
    const cd = Buffer.alloc(cdSize)
    fs.readSync(fd, cd, 0, cdSize, cdOffset)
    const entries: ZipEntryInfo[] = []
    let off = 0
    for (let i = 0; i < count; i++) {
      if (off + 46 > cd.length || cd.readUInt32LE(off) !== SIG_CENTRAL) throw new Error(t('m.pack.errBadZip'))
      const flags = cd.readUInt16LE(off + 8)
      const compressedSize = cd.readUInt32LE(off + 20)
      const size = cd.readUInt32LE(off + 24)
      const nameLen = cd.readUInt16LE(off + 28)
      const extraLen = cd.readUInt16LE(off + 30)
      const commentLen = cd.readUInt16LE(off + 32)
      const externalAttr = cd.readUInt32LE(off + 38)
      const name = cd.subarray(off + 46, off + 46 + nameLen).toString(flags & 0x800 ? 'utf-8' : 'latin1')
      entries.push({ name, size, compressedSize, externalAttr, flags })
      off += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    fs.closeSync(fd)
  }
}

/** 校验 zip 条目：拒绝绝对路径、..、符号链接与超限体积 */
export function validateZipEntries(entries: ZipEntryInfo[], zipPath: string): void {
  let total = 0
  const seen = new Set<string>()
  for (const e of entries) {
    const name = e.name.replace(/\\/g, '/')
    if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw new Error(t('m.pack.errUnsafeEntry', { name: e.name }))
    if (name.split('/').some(s => s === '..')) throw new Error(t('m.pack.errUnsafeEntry', { name: e.name }))
    // 目录条目以 / 结尾
    if (!name.endsWith('/')) {
      if (seen.has(name)) throw new Error(t('m.pack.errDuplicateEntry', { name }))
      seen.add(name)
      const mode = (e.externalAttr >>> 16) & 0xf000
      if (mode === 0xa000) throw new Error(t('m.pack.errSymlink', { name }))
      if (e.size > ZIP_MAX_ENTRY_BYTES) throw new Error(t('m.pack.errEntryTooLarge', { name, mb: String(Math.round(e.size / 1048576)) }))
      total += e.size
      if (total > ZIP_MAX_TOTAL_BYTES) throw new Error(t('m.pack.errTotalTooLarge', { zip: path.basename(zipPath) }))
    }
  }
}

/** 解压 zip 到 dest（调用前会先做安全检查） */
export async function extractZip(zipPath: string, dest: string): Promise<void> {
  const entries = listZipEntries(zipPath)
  validateZipEntries(entries, zipPath)
  fs.mkdirSync(dest, { recursive: true })
  if (isWin) {
    const r = await run(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`],
      { timeoutMs: 300000 }
    )
    if (r.code !== 0) throw new Error(t('m.pack.errExtract', { detail: (r.err || r.out).slice(-300) }))
    return
  }
  let r = await run('unzip', ['-o', zipPath, '-d', dest], { timeoutMs: 300000 })
  if (r.code !== 0) r = await run('tar', ['-xf', zipPath, '-C', dest], { timeoutMs: 300000 })
  if (r.code !== 0) throw new Error(t('m.pack.errExtract', { detail: (r.err || r.out).slice(-300) }))
}

interface ZipWriteEntry {
  /** zip 内路径，使用 / 分隔 */
  name: string
  /** 内存内容（JSON/文本，走 deflate） */
  buffer?: Buffer | string
  /** 磁盘文件（走 store 流式写入，避免大文件占内存） */
  file?: string
  mtime?: Date
}

/** 写入 zip 的 DOS 时间/日期 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
  }
}

interface CentralRecord {
  name: Buffer
  flags: number
  method: number
  time: number
  date: number
  crc: number
  csize: number
  usize: number
  offset: number
}

/** 把一组文件/内存内容写成 zip */
export async function createZip(entries: ZipWriteEntry[], outPath: string): Promise<void> {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error(t('m.pack.errTooManyEntries', { n: String(entries.length) }))
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const out = fs.createWriteStream(outPath)
  const write = (buf: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      out.write(buf, err => (err ? reject(err) : resolve()))
    })
  const records: CentralRecord[] = []
  let offset = 0
  let total = 0
  try {
    for (const e of entries) {
      const name = e.name.replace(/\\/g, '/')
      if (!name || name.startsWith('/') || name.split('/').some(s => s === '..')) {
        throw new Error(t('m.pack.errUnsafeEntry', { name: e.name }))
      }
      const nameBuf = Buffer.from(name, 'utf-8')
      if (nameBuf.length > 0xffff) throw new Error(t('m.pack.errNameTooLong', { name }))
      const dt = dosDateTime(e.mtime || new Date())
      let crc = 0
      let usize = 0
      let csize = 0
      let flags = 0x0800 // UTF-8
      let method = 0
      let data: Buffer

      if (e.file) {
        // 流式 store：先写占位头（带 data descriptor 标记），再边读边算 CRC
        const stat = fs.statSync(e.file)
        if (stat.size > ZIP_MAX_ENTRY_BYTES) throw new Error(t('m.pack.errEntryTooLarge', { name, mb: String(Math.round(stat.size / 1048576)) }))
        total += stat.size
        if (total > ZIP_MAX_TOTAL_BYTES) throw new Error(t('m.pack.errTotalTooLarge', { zip: outPath }))
        flags |= 0x0008
        const header = Buffer.alloc(30)
        header.writeUInt32LE(SIG_LOCAL, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(flags, 6)
        header.writeUInt16LE(0, 8)
        header.writeUInt16LE(dt.time, 10)
        header.writeUInt16LE(dt.date, 12)
        header.writeUInt32LE(0, 14)
        header.writeUInt32LE(0, 18)
        header.writeUInt32LE(0, 22)
        header.writeUInt16LE(nameBuf.length, 26)
        header.writeUInt16LE(0, 28)
        await write(header)
        offset += header.length
        await write(nameBuf)
        offset += nameBuf.length
        let read = 0
        let last = 0
        const rs = fs.createReadStream(e.file)
        for await (const chunk of rs) {
          const buf = chunk as Buffer
          last = crc32Update(last, buf)
          read += buf.length
          await write(buf)
          offset += buf.length
        }
        if (read !== stat.size) throw new Error(t('m.pack.errReadSize', { name }))
        crc = last
        usize = read
        csize = read
        const desc = Buffer.alloc(16)
        desc.writeUInt32LE(SIG_DESC, 0)
        desc.writeUInt32LE(crc, 4)
        desc.writeUInt32LE(csize, 8)
        desc.writeUInt32LE(usize, 12)
        await write(desc)
        offset += desc.length
      } else {
        data = Buffer.isBuffer(e.buffer) ? e.buffer : Buffer.from(e.buffer ?? '', 'utf-8')
        if (data.length > ZIP_MAX_ENTRY_BYTES) throw new Error(t('m.pack.errEntryTooLarge', { name, mb: String(Math.round(data.length / 1048576)) }))
        total += data.length
        if (total > ZIP_MAX_TOTAL_BYTES) throw new Error(t('m.pack.errTotalTooLarge', { zip: outPath }))
        usize = data.length
        crc = crc32Update(0, data)
        if (name.endsWith('.json') || name.endsWith('.md') || name.endsWith('.txt')) {
          const deflated = zlib.deflateRawSync(data, { level: 9 })
          if (deflated.length < data.length) {
            data = deflated
            method = 8
            flags |= 0x0002 // 最大压缩
          }
        }
        csize = data.length
        const header = Buffer.alloc(30)
        header.writeUInt32LE(SIG_LOCAL, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(flags, 6)
        header.writeUInt16LE(method, 8)
        header.writeUInt16LE(dt.time, 10)
        header.writeUInt16LE(dt.date, 12)
        header.writeUInt32LE(crc, 14)
        header.writeUInt32LE(csize, 18)
        header.writeUInt32LE(usize, 22)
        header.writeUInt16LE(nameBuf.length, 26)
        header.writeUInt16LE(0, 28)
        await write(header)
        await write(nameBuf)
        await write(data)
        offset += header.length + nameBuf.length + data.length
      }
      records.push({ name: nameBuf, flags, method, time: dt.time, date: dt.date, crc, csize, usize, offset: offset - (csize + nameBuf.length + 30 + (flags & 0x0008 ? 16 : 0)) })
    }

    const cdStart = offset
    const cdParts: Buffer[] = []
    for (const r of records) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(SIG_CENTRAL, 0)
      h.writeUInt16LE(20, 4)
      h.writeUInt16LE(20, 6)
      h.writeUInt16LE(r.flags, 8)
      h.writeUInt16LE(r.method, 10)
      h.writeUInt16LE(r.time, 12)
      h.writeUInt16LE(r.date, 14)
      h.writeUInt32LE(r.crc, 16)
      h.writeUInt32LE(r.csize, 20)
      h.writeUInt32LE(r.usize, 24)
      h.writeUInt16LE(r.name.length, 28)
      h.writeUInt16LE(0, 30)
      h.writeUInt16LE(0, 32)
      h.writeUInt16LE(0, 34)
      h.writeUInt16LE(0, 36)
      h.writeUInt32LE(0, 38)
      h.writeUInt32LE(r.offset, 42)
      cdParts.push(h, r.name)
    }
    const cd = Buffer.concat(cdParts)
    await write(cd)
    offset += cd.length
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(SIG_EOCD, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(records.length, 8)
    eocd.writeUInt16LE(records.length, 10)
    eocd.writeUInt32LE(cd.length, 12)
    eocd.writeUInt32LE(cdStart, 16)
    eocd.writeUInt16LE(0, 20)
    await write(eocd)
  } finally {
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  }
}

/** 递归收集目录下的文件，返回相对路径（/ 分隔），跳过符号链接与隐藏缓存目录 */
export function walkFiles(root: string): Array<{ rel: string; abs: string; size: number }> {
  const out: Array<{ rel: string; abs: string; size: number }> = []
  const walk = (dir: string, prefix: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') && e.name !== '.gitignore') continue
      if (e.name === '__pycache__') continue
      const abs = path.join(dir, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        walk(abs, rel)
      } else if (e.isFile()) {
        try {
          out.push({ rel, abs, size: fs.statSync(abs).size })
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(root, '')
  return out
}
