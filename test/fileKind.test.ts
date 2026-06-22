import { describe, expect, it } from 'vitest'
import { fileKind, kindLabel } from '../src/renderer/lib/fileKind'

describe('image file kinds', () => {
  it('renders PNG and JPEG directly', () => {
    expect(fileKind('image.png')).toBe('image')
    expect(fileKind('photo.jpg')).toBe('image')
    expect(fileKind('photo.jpeg')).toBe('image')
  })

  it('routes HEIC images through the macOS conversion preview', () => {
    expect(fileKind('photo.heic')).toBe('quicklook')
    expect(fileKind('photo.heif')).toBe('quicklook')
    expect(kindLabel('photo.heic')).toBe('HEIC 图片')
  })
})
