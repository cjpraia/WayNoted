// Galeria própria de capas: cores sólidas e gradientes.
import type { CSSProperties } from 'react'

export interface CoverOption {
  label: string
  value: string
}

export const SOLID_COVERS: CoverOption[] = [
  { label: 'Areia', value: '#e9e2d6' },
  { label: 'Terracota', value: '#d9826b' },
  { label: 'Mostarda', value: '#e5b85c' },
  { label: 'Sálvia', value: '#9cb89a' },
  { label: 'Oceano', value: '#6c9bc4' },
  { label: 'Lavanda', value: '#a99acb' },
  { label: 'Rosado', value: '#e4a6b8' },
  { label: 'Grafite', value: '#55585e' },
]

export const GRADIENT_COVERS: CoverOption[] = [
  { label: 'Amanhecer', value: 'linear-gradient(120deg, #f9d7a6 0%, #f19a8e 55%, #c97fb0 100%)' },
  { label: 'Lagoa', value: 'linear-gradient(135deg, #a6e3d6 0%, #5fa8d3 100%)' },
  { label: 'Pomar', value: 'linear-gradient(135deg, #d8eaa0 0%, #7cc38f 100%)' },
  { label: 'Crepúsculo', value: 'linear-gradient(160deg, #3d3b72 0%, #8c5aa6 55%, #e58d8d 100%)' },
  { label: 'Névoa', value: 'linear-gradient(180deg, #eef1f5 0%, #c5cedb 100%)' },
  { label: 'Brasa', value: 'linear-gradient(135deg, #ffcf70 0%, #ff7a59 60%, #d6455f 100%)' },
  { label: 'Aurora', value: 'linear-gradient(115deg, #2b5876 0%, #4e9a8f 50%, #b6e388 100%)' },
  { label: 'Algodão', value: 'linear-gradient(135deg, #fbe3f0 0%, #d9e4fb 100%)' },
  { label: 'Noturno', value: 'radial-gradient(circle at 30% 20%, #3a4d7a 0%, #161b2e 70%)' },
  { label: 'Pêssego', value: 'radial-gradient(circle at 70% 30%, #ffe2c6 0%, #f6a98e 80%)' },
  { label: 'Menta', value: 'linear-gradient(90deg, #d4f5e9 0%, #9adbc5 50%, #6bbfb0 100%)' },
  { label: 'Ametista', value: 'linear-gradient(135deg, #c3b1e1 0%, #7f6bbf 100%)' },
]

const ALL = [...SOLID_COVERS, ...GRADIENT_COVERS]

export function randomCover(): string {
  return ALL[Math.floor(Math.random() * ALL.length)].value
}

export function isImageCover(cover: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(cover) || /^(blob:|file:)/i.test(cover)
}

export function coverStyle(cover: string, position: number): CSSProperties {
  if (isImageCover(cover)) {
    return {
      backgroundImage: `url("${cover.replace(/"/g, '%22')}")`,
      backgroundSize: 'cover',
      backgroundPosition: `center ${position}%`,
      backgroundRepeat: 'no-repeat',
    }
  }
  if (ALL.some((option) => option.value === cover) || /^#[0-9a-f]{3,8}$/i.test(cover)) {
    return { background: cover }
  }
  // Legacy remote URLs and arbitrary CSS must never trigger network requests.
  return { background: SOLID_COVERS[0].value }
}
