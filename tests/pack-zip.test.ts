import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir } from './helpers'
import { createZip, extractZip, listZipEntries, validateZipEntries, walkFiles } from '../src/main/pack-zip'

describe('pack-zip', () => {
  it('写出 zip 后可被系统工具解压，内容一致', async () => {
    const dir = mkTmpDir('pack-zip-')
    try {
      const src = path.join(dir, 'src')
      fs.mkdirSync(path.join(src, 'payload'), { recursive: true })
      fs.writeFileSync(path.join(src, 'payload', 'a.json'), '{"hello":"world"}')
      fs.writeFileSync(path.join(src, 'payload', 'b.bin'), Buffer.from([1, 2, 3, 4]))
      const entries = walkFiles(src)
      const zip = path.join(dir, 'out.zip')
      await createZip(entries.map(e => ({ name: e.rel, file: e.abs })), zip)

      const list = listZipEntries(zip)
      expect(list.map(e => e.name).sort()).toEqual(['payload/a.json', 'payload/b.bin'])
      expect(list.find(e => e.name === 'payload/a.json')!.size).toBe(17)

      const dest = path.join(dir, 'unpacked')
      await extractZip(zip, dest)
      expect(fs.readFileSync(path.join(dest, 'payload', 'a.json'), 'utf-8')).toBe('{"hello":"world"}')
      expect(fs.readFileSync(path.join(dest, 'payload', 'b.bin')).length).toBe(4)
    } finally {
      rmTmpDir(dir)
    }
  })

  it('拒绝路径穿越与符号链接', () => {
    expect(() => validateZipEntries([{ name: '../evil.txt', size: 1, compressedSize: 1, externalAttr: 0, flags: 0 }], 'x.zip')).toThrow()
    expect(() => validateZipEntries([{ name: '/abs.txt', size: 1, compressedSize: 1, externalAttr: 0, flags: 0 }], 'x.zip')).toThrow()
    // 0xa000 << 16 = Unix symlink 模式
    expect(() => validateZipEntries([{ name: 'link', size: 1, compressedSize: 1, externalAttr: 0xa000 << 16, flags: 0 }], 'x.zip')).toThrow()
  })

  it('写入时拒绝不安全条目名', async () => {
    const dir = mkTmpDir('pack-zip-bad-')
    try {
      await expect(createZip([{ name: '../x.txt', buffer: 'x' }], path.join(dir, 'bad.zip'))).rejects.toThrow()
    } finally {
      rmTmpDir(dir)
    }
  })
})
