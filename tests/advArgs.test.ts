import { describe, it, expect } from 'vitest'
import { buildAdvancedArgs, parseAdvancedArgs, ADV_KEYS } from '../src/shared/advArgs'

describe('buildAdvancedArgs', () => {
  it('空输入返回空数组', () => {
    expect(buildAdvancedArgs(null)).toEqual([])
    expect(buildAdvancedArgs(undefined)).toEqual([])
    expect(buildAdvancedArgs({})).toEqual([])
  })

  it('布尔 flag：truthy 才生成', () => {
    expect(buildAdvancedArgs({ listen: true })).toEqual(['--listen'])
    expect(buildAdvancedArgs({ listen: false })).toEqual([])
  })

  it('三态选项：on/off 分别展开，默认空串不生成', () => {
    expect(buildAdvancedArgs({ autoLaunch: 'on' })).toEqual(['--auto-launch'])
    expect(buildAdvancedArgs({ autoLaunch: 'off' })).toEqual(['--disable-auto-launch'])
    expect(buildAdvancedArgs({ autoLaunch: '' })).toEqual([])
    expect(buildAdvancedArgs({ cudaMalloc: 'off' })).toEqual(['--disable-cuda-malloc'])
  })

  it('数值选项：默认值不生成（maxUploadSize=100、previewSize=512）', () => {
    expect(buildAdvancedArgs({ maxUploadSize: 100 })).toEqual([])
    expect(buildAdvancedArgs({ maxUploadSize: 200 })).toEqual(['--max-upload-size', '200'])
    expect(buildAdvancedArgs({ previewSize: 512 })).toEqual([])
    expect(buildAdvancedArgs({ previewSize: 256 })).toEqual(['--preview-size', '256'])
    expect(buildAdvancedArgs({ maxUploadSize: 0 })).toEqual([])
  })

  it('互斥精度组：forceFp/unet/vae/textEnc', () => {
    expect(buildAdvancedArgs({ forceFp: 'fp16' })).toEqual(['--force-fp16'])
    expect(buildAdvancedArgs({ forceFp: 'fp32' })).toEqual(['--force-fp32'])
    expect(buildAdvancedArgs({ forceFp: '' })).toEqual([])
    expect(buildAdvancedArgs({ unetPrecision: 'bf16' })).toEqual(['--bf16-unet'])
    expect(buildAdvancedArgs({ vaePrecision: 'cpu' })).toEqual(['--cpu-vae'])
    expect(buildAdvancedArgs({ textEncPrecision: 'fp8_e4m3fn' })).toEqual(['--fp8_e4m3fn-text-enc'])
  })

  it('缓存组：none/classic/lru，lru 缺省 n=3', () => {
    expect(buildAdvancedArgs({ cache: 'none' })).toEqual(['--cache-none'])
    expect(buildAdvancedArgs({ cache: 'classic' })).toEqual(['--cache-classic'])
    expect(buildAdvancedArgs({ cache: 'lru' })).toEqual(['--cache-lru', '3'])
    expect(buildAdvancedArgs({ cache: 'lru', cacheLruN: 8 })).toEqual(['--cache-lru', '8'])
  })

  it('注意力组：sage/flash 专属 flag，其余走 cross-attention', () => {
    expect(buildAdvancedArgs({ attention: 'sage' })).toEqual(['--use-sage-attention'])
    expect(buildAdvancedArgs({ attention: 'flash' })).toEqual(['--use-flash-attention'])
    expect(buildAdvancedArgs({ attention: 'split' })).toEqual(['--use-split-cross-attention'])
    expect(buildAdvancedArgs({ upcastAttention: 'on' })).toEqual(['--force-upcast-attention'])
    expect(buildAdvancedArgs({ upcastAttention: 'off' })).toEqual(['--dont-upcast-attention'])
  })

  it('VRAM 模式与 reserveVram', () => {
    expect(buildAdvancedArgs({ vramMode: 'lowvram' })).toEqual(['--lowvram'])
    expect(buildAdvancedArgs({ reserveVram: 2 })).toEqual(['--reserve-vram', '2'])
    expect(buildAdvancedArgs({ reserveVram: -1 })).toEqual([])
  })

  it('hashFunction 默认 sha256 不生成', () => {
    expect(buildAdvancedArgs({ hashFunction: 'sha256' })).toEqual([])
    expect(buildAdvancedArgs({ hashFunction: 'xxh64' })).toEqual(['--default-hashing-function', 'xxh64'])
  })

  it('Manager 子选项仅在 enableManager 打开时生成', () => {
    expect(buildAdvancedArgs({ disableManagerUi: true })).toEqual([])
    expect(buildAdvancedArgs({ enableManager: true, disableManagerUi: true })).toEqual([
      '--enable-manager',
      '--disable-manager-ui'
    ])
    expect(buildAdvancedArgs({ enableManager: true, managerLegacyUi: true })).toEqual([
      '--enable-manager',
      '--enable-manager-legacy-ui'
    ])
  })

  it('参数顺序与文档分组一致', () => {
    const args = buildAdvancedArgs({
      listen: true,
      autoLaunch: 'off',
      cudaDevice: '1',
      forceFp: 'fp16',
      vramMode: 'lowvram',
      fast: true,
      verbose: 'DEBUG'
    })
    expect(args).toEqual([
      '--listen',
      '--disable-auto-launch',
      '--cuda-device',
      '1',
      '--force-fp16',
      '--lowvram',
      '--fast',
      '--verbose',
      'DEBUG'
    ])
  })
})

describe('parseAdvancedArgs', () => {
  it('空 token 返回空对象', () => {
    expect(parseAdvancedArgs([])).toEqual({})
  })

  it('布尔 flag 解析', () => {
    const out = parseAdvancedArgs(['--listen', '--enable-cors-header', '--fast'])
    expect(out.listen).toBe(true)
    expect(out.enableCors).toBe(true)
    expect(out.fast).toBe(true)
  })

  it('带值参数解析', () => {
    const out = parseAdvancedArgs(['--max-upload-size', '200', '--preview-size', '768', '--reserve-vram', '1.5'])
    expect(out.maxUploadSize).toBe(200)
    expect(out.previewSize).toBe(768)
    expect(out.reserveVram).toBe(1.5)
  })

  it('三态解析', () => {
    expect(parseAdvancedArgs(['--auto-launch']).autoLaunch).toBe('on')
    expect(parseAdvancedArgs(['--disable-auto-launch']).autoLaunch).toBe('off')
    expect(parseAdvancedArgs(['--cuda-malloc']).cudaMalloc).toBe('on')
    expect(parseAdvancedArgs(['--disable-cuda-malloc']).cudaMalloc).toBe('off')
  })

  it('下一个 token 是 flag 时不吞值', () => {
    const out = parseAdvancedArgs(['--cuda-device', '--fast'])
    expect(out.cudaDevice).toBeUndefined()
    expect(out.fast).toBe(true)
  })

  it('unet/vae/textEnc 精度从 --xxx-后缀解析', () => {
    const out = parseAdvancedArgs(['--bf16-unet', '--fp32-vae', '--fp8_e5m2-text-enc'])
    expect(out.unetPrecision).toBe('bf16')
    expect(out.vaePrecision).toBe('fp32')
    expect(out.textEncPrecision).toBe('fp8_e5m2')
  })

  it('cross-attention 选项正确还原', () => {
    expect(parseAdvancedArgs(['--use-quad-cross-attention']).attention).toBe('quad')
    expect(parseAdvancedArgs(['--use-sage-attention']).attention).toBe('sage')
    expect(parseAdvancedArgs(['--use-flash-attention']).attention).toBe('flash')
  })

  it('cache-lru 同时还原容量', () => {
    const out = parseAdvancedArgs(['--cache-lru', '6'])
    expect(out.cache).toBe('lru')
    expect(out.cacheLruN).toBe(6)
  })

  it('非本协议 token 被忽略', () => {
    const out = parseAdvancedArgs(['--unknown-flag', 'random.txt', '--listen'])
    expect(out).toEqual({ listen: true })
  })
})

describe('build/parse 往返一致', () => {
  it('全量选项（避开默认值）往返后 token 完全一致', () => {
    const source = {
      listen: true,
      enableCors: true,
      compressResponse: true,
      maxUploadSize: 250,
      autoLaunch: 'off',
      cudaDevice: '0',
      directml: true,
      cudaMalloc: 'on',
      forceFp: 'fp16',
      unetPrecision: 'fp8_e4m3fn',
      vaePrecision: 'bf16',
      textEncPrecision: 'fp32',
      fp16Intermediates: true,
      previewMethod: 'taesd',
      previewSize: 256,
      cache: 'lru',
      cacheLruN: 5,
      attention: 'sage',
      disableXformers: true,
      upcastAttention: 'off',
      vramMode: 'lowvram',
      reserveVram: 2,
      asyncOffload: 'on',
      dynamicVram: 'off',
      fastDisk: true,
      disableSmartMemory: true,
      disablePinnedMemory: true,
      mmap: 'on',
      fast: true,
      deterministic: true,
      hashFunction: 'xxh64',
      enableManager: true,
      disableManagerUi: true,
      managerLegacyUi: true,
      disableAllCustomNodes: true,
      disableApiNodes: true,
      disableMetadata: true,
      multiUser: true,
      verbose: 'DEBUG',
      logStdout: true,
      dontPrintServer: true
    }
    const tokens = buildAdvancedArgs(source)
    expect(buildAdvancedArgs(parseAdvancedArgs(tokens))).toEqual(tokens)
  })
})

describe('ADV_KEYS', () => {
  it('包含全部文档化设置键', () => {
    expect(ADV_KEYS).toContain('listen')
    expect(ADV_KEYS).toContain('vramMode')
    expect(ADV_KEYS).toContain('enableManager')
    expect(ADV_KEYS.length).toBeGreaterThan(30)
  })
})
