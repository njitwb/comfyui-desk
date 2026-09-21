import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkTmpDir, rmTmpDir, electronMockFactory, freshImport } from './helpers'

const h = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => electronMockFactory(() => h.userData))

type SettingsModule = typeof import('../src/main/settings')
type ModelsModule = typeof import('../src/main/models')

let settings: SettingsModule
let models: ModelsModule
let userData: string
let modelsRoot: string

const setMtime = (p: string, t: number) => fs.utimesSync(p, t / 1000, t / 1000)
const touch = (p: string, mtime: number) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, 'x')
  setMtime(p, mtime)
}

beforeEach(async () => {
  userData = mkTmpDir()
  h.userData = userData
  modelsRoot = path.join(userData, 'models')
  settings = await freshImport<SettingsModule>('../src/main/settings')
  settings.saveSettings({ modelPath: modelsRoot, installPath: path.join(userData, 'runtime') })
  models = await import('../src/main/models')
})

afterEach(() => rmTmpDir(userData))

describe('modelCategories', () => {
  it('返回全部内置类别', () => {
    const cats = models.modelCategories()
    expect(cats).toContain('checkpoints')
    expect(cats).toContain('loras')
    expect(cats).toContain('diffusion_models')
    expect(cats.length).toBeGreaterThan(10)
  })
})

describe('scanModels', () => {
  it('目录不存在返回空数组', () => {
    expect(models.scanModels()).toEqual([])
  })

  it('扫描已知类别、按修改时间倒序', () => {
    touch(path.join(modelsRoot, 'checkpoints', 'old.safetensors'), 1000)
    touch(path.join(modelsRoot, 'checkpoints', 'new.safetensors'), 3000)
    touch(path.join(modelsRoot, 'checkpoints', 'mid.safetensors'), 2000)
    touch(path.join(modelsRoot, 'loras', 'a.safetensors'), 500)

    const result = models.scanModels()
    const ckpt = result.find(c => c.name === 'checkpoints')!
    expect(ckpt.count).toBe(3)
    expect(ckpt.files.map(f => f.name)).toEqual(['new.safetensors', 'mid.safetensors', 'old.safetensors'])
    expect(ckpt.files[0].size).toBe(1)
    expect(ckpt.files[0].category).toBe('checkpoints')

    const loras = result.find(c => c.name === 'loras')!
    expect(loras.count).toBe(1)

    // 结果只包含已知类别
    expect(result.every(c => models.modelCategories().includes(c.name))).toBe(true)
  })

  it('递归两层子目录，忽略隐藏文件与第 3 层', () => {
    touch(path.join(modelsRoot, 'vae', 'sub1', 'a.safetensors'), 1000)
    touch(path.join(modelsRoot, 'vae', 'sub1', 'sub2', 'b.safetensors'), 2000)
    touch(path.join(modelsRoot, 'vae', 'sub1', 'sub2', 'sub3', 'c.safetensors'), 3000)
    touch(path.join(modelsRoot, 'vae', '.hidden.safetensors'), 4000)

    const vae = models.scanModels().find(c => c.name === 'vae')!
    expect(vae.files.map(f => f.name).sort()).toEqual(['a.safetensors', 'b.safetensors'])
  })

  it('未知类别目录不出现在结果中', () => {
    touch(path.join(modelsRoot, 'not-a-category', 'x.bin'), 1000)
    expect(models.scanModels()).toEqual([])
  })
})

describe('在线模型库搜索', () => {
  it('HF 搜索站点随镜像开关切换，关键词编码，走相关度排序', () => {
    expect(models.hfSearchUrl('flux', true)).toBe('https://hf-mirror.com/api/models?search=flux&limit=30')
    expect(models.hfSearchUrl('flux', false)).toContain('https://huggingface.co/api/models?search=flux')
    expect(models.hfSearchUrl('a b&c', true)).toContain('search=a%20b%26c')
    // 不再强制按下载量排序（会把精确命中的长尾仓库挤出前几页）
    expect(models.hfSearchUrl('flux', true)).not.toContain('sort=downloads')
  })

  it('HF 文件直链与搜索同一主机，路径段逐个编码', () => {
    expect(models.hfResolveUrl('u/r', 'vae/my model.safetensors', true)).toBe(
      'https://hf-mirror.com/u/r/resolve/main/vae/my%20model.safetensors'
    )
    expect(models.hfResolveUrl('u/r', 'm.safetensors', false)).toBe(
      'https://huggingface.co/u/r/resolve/main/m.safetensors'
    )
  })

  it('魔搭地址固定走 modelscope.cn，路径段逐个编码', () => {
    expect(models.MS_SEARCH_URL).toBe('https://modelscope.cn/api/v1/models')
    expect(models.msSearchBody('flux')).toEqual({ PageSize: 20, PageNumber: 1, SortBy: 'DownloadsCount', Name: 'flux' })
    expect(models.msFilesUrl('a/b', 'master')).toBe(
      'https://modelscope.cn/api/v1/models/a/b/repo/files?Revision=master&Recursive=true'
    )
    expect(models.msResolveUrl('a/b', 'master', 'text_encoder/my model.safetensors')).toBe(
      'https://modelscope.cn/models/a/b/resolve/master/text_encoder/my%20model.safetensors'
    )
  })

  it('检索词规范化：链接取仓库 ID、文件名去扩展名', () => {
    // 用户常直接粘贴页面/文件链接
    expect(models.normalizeQuery('https://hf-mirror.com/Kijai/MiniMax-H3-experimental/blob/main/minimax_h3_ref2va.safetensors')).toBe(
      'Kijai/MiniMax-H3-experimental'
    )
    expect(models.normalizeQuery('https://huggingface.co/Kijai/MiniMax-H3-experimental')).toBe('Kijai/MiniMax-H3-experimental')
    expect(models.normalizeQuery('https://www.modelscope.cn/models/AI-ModelScope/MiniMax-H3-w4a8/files')).toBe(
      'AI-ModelScope/MiniMax-H3-w4a8'
    )
    // 直接搜文件名时去掉扩展名
    expect(models.normalizeQuery('minimax_h3_ref2va_pruned_w4a8_mixed.safetensors')).toBe('minimax_h3_ref2va_pruned_w4a8_mixed')
    expect(models.normalizeQuery(' MiniMax-H3 ')).toBe('MiniMax-H3')
  })

  it('魔搭只按模型名匹配：owner/name 取名字段', () => {
    expect(models.msNameQuery('AI-ModelScope/MiniMax-H3-w4a8')).toBe('MiniMax-H3-w4a8')
    expect(models.msNameQuery('MiniMax-H3-w4a8')).toBe('MiniMax-H3-w4a8')
  })

  it('HF 兜底检索词：长查询收敛到前两个关键词，短查询不兜底', () => {
    expect(models.hfFallbackQuery('minimax_h3_ref2va_pruned_w4a8_mixed')).toBe('minimax_h3')
    expect(models.hfFallbackQuery('MiniMax-H3-experimental')).toBe('MiniMax_H3')
    expect(models.hfFallbackQuery('MiniMax-H3')).toBe('')
    expect(models.hfFallbackQuery('flux')).toBe('')
    expect(models.queryTokens('Kijai/MiniMax-H3-experimental')).toEqual(['Kijai', 'MiniMax', 'H3', 'experimental'])
  })

  it('空关键词不发起请求', async () => {
    expect(await models.searchOnlineModels('hf', '  ', true)).toEqual({ query: '', models: [] })
    expect(await models.searchOnlineModels('ms', '', false)).toEqual({ query: '', models: [] })
  })

  it('仓库 ID 非法时抛错，合法时去掉首尾斜杠', () => {
    expect(() => models.normalizeRepoId('../../etc')).toThrow()
    expect(() => models.normalizeRepoId('only-owner')).toThrow()
    expect(models.normalizeRepoId(' owner/name ')).toBe('owner/name')
  })

  it('HF 搜索结果映射：缺失字段兜底，非数组返回空', () => {
    const list = models.mapHfSearch([
      { id: 'a/b', downloads: 10, likes: 2, pipeline_tag: 'text-to-image', gated: 'manual' },
      { id: 'c/d' },
      { nope: true }
    ])
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({
      id: 'a/b',
      source: 'hf',
      revision: 'main',
      downloads: 10,
      likes: 2,
      tag: 'text-to-image',
      gated: true
    })
    expect(list[1]).toEqual({ id: 'c/d', source: 'hf', revision: 'main', downloads: 0, likes: 0, tag: '', gated: false })
    expect(models.mapHfSearch(null)).toEqual([])
  })

  it('魔搭搜索结果映射：Path/Name 拼仓库 ID，Stars 作点赞数', () => {
    const list = models.mapMsSearch({
      Data: {
        TotalCount: 2,
        Models: [
          {
            Path: 'AI-ModelScope',
            Name: 'FLUX.1-dev',
            Downloads: 88,
            Stars: 7,
            Revision: 'master',
            Tasks: [{ Name: 'text-to-image-synthesis' }]
          },
          { Path: 'iic', Name: 'Whisper-large-v3-turbo' },
          { Name: 'no-owner' }
        ]
      }
    })
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({
      id: 'AI-ModelScope/FLUX.1-dev',
      source: 'ms',
      revision: 'master',
      downloads: 88,
      likes: 7,
      tag: 'text-to-image-synthesis'
    })
    expect(list[1]).toEqual({ id: 'iic/Whisper-large-v3-turbo', source: 'ms', revision: 'master', downloads: 0, likes: 0, tag: '' })
    expect(models.mapMsSearch({ Data: {} })).toEqual([])
  })

  it('HF 文件列表：权重文件优先、忽略隐藏文件、带下载直链', () => {
    const files = models.mapHfFiles(
      { siblings: [{ rfilename: 'README.md' }, { rfilename: '.gitattributes' }, { rfilename: 'model.safetensors', size: 7 }] },
      'u/r',
      true
    )
    expect(files.map(f => f.name)).toEqual(['model.safetensors', 'README.md'])
    expect(files[0]).toEqual({
      name: 'model.safetensors',
      size: 7,
      url: 'https://hf-mirror.com/u/r/resolve/main/model.safetensors'
    })
    expect(models.mapHfFiles({}, 'u/r', true)).toEqual([])
  })

  it('魔搭文件列表：只取文件项（忽略目录与隐藏文件），带下载直链', () => {
    const files = models.mapMsFiles(
      {
        Data: {
          Files: [
            { Path: 'text_encoder', Type: 'tree', Size: 0 },
            { Path: '.gitattributes', Type: 'blob', Size: 1 },
            { Path: 'README.md', Type: 'blob', Size: 2 },
            { Path: 'text_encoder/model.safetensors', Type: 'blob', Size: 9 }
          ]
        }
      },
      'a/b',
      'master'
    )
    expect(files.map(f => f.name)).toEqual(['text_encoder/model.safetensors', 'README.md'])
    expect(files[0]).toEqual({
      name: 'text_encoder/model.safetensors',
      size: 9,
      url: 'https://modelscope.cn/models/a/b/resolve/master/text_encoder/model.safetensors'
    })
    expect(models.mapMsFiles({ Data: { Files: [] } }, 'a/b', 'master')).toEqual([])
  })
})

describe('deleteModel', () => {
  it('删除模型目录内文件', () => {
    const f = path.join(modelsRoot, 'loras', 'a.safetensors')
    touch(f, 1000)
    models.deleteModel(f)
    expect(fs.existsSync(f)).toBe(false)
  })

  it('拒绝模型目录外的路径', () => {
    const outside = path.join(userData, 'elsewhere', 'x.safetensors')
    touch(outside, 1000)
    expect(() => models.deleteModel(outside)).toThrow('非法路径')
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('不存在的文件不强报错（force 删除）', () => {
    expect(() => models.deleteModel(path.join(modelsRoot, 'loras', 'ghost.safetensors'))).not.toThrow()
  })
})

describe('moveModel', () => {
  it('移动到其他类别目录：自动建目录并返回新路径', () => {
    const src = path.join(modelsRoot, 'loras', 'a.safetensors')
    touch(src, 1000)
    const dest = models.moveModel(src, 'vae')
    expect(dest).toBe(path.join(modelsRoot, 'vae', 'a.safetensors'))
    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.existsSync(src)).toBe(false)
  })

  it('子目录内的文件移动到目标类别根目录；移动到原类别为原地不动', () => {
    const src = path.join(modelsRoot, 'checkpoints', 'sub', 'c.safetensors')
    touch(src, 1000)
    expect(models.moveModel(src, 'vae')).toBe(path.join(modelsRoot, 'vae', 'c.safetensors'))
    const same = path.join(modelsRoot, 'vae', 'c.safetensors')
    expect(models.moveModel(same, 'vae')).toBe(same)
    expect(fs.existsSync(same)).toBe(true)
  })

  it('目标已有同名文件时拒绝且不动任何文件', () => {
    const src = path.join(modelsRoot, 'loras', 'dup.safetensors')
    touch(src, 1000)
    const occupied = path.join(modelsRoot, 'vae', 'dup.safetensors')
    touch(occupied, 2000)
    expect(() => models.moveModel(src, 'vae')).toThrow('已存在同名文件')
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.readFileSync(occupied, 'utf-8')).toBe('x')
  })

  it('拒绝未知类别与模型目录外的路径', () => {
    const src = path.join(modelsRoot, 'loras', 'b.safetensors')
    touch(src, 1000)
    expect(() => models.moveModel(src, '../evil')).toThrow('未知的模型类别')
    expect(() => models.moveModel(src, 'not-a-category')).toThrow('未知的模型类别')
    const outside = path.join(userData, 'elsewhere', 'x.safetensors')
    touch(outside, 1000)
    expect(() => models.moveModel(outside, 'vae')).toThrow('非法路径')
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('源文件不存在时报错', () => {
    expect(() => models.moveModel(path.join(modelsRoot, 'loras', 'ghost.safetensors'), 'vae')).toThrow('源文件不存在')
  })
})
