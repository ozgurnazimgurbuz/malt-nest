import { useEffect, useState } from 'react'

type Props = {
  raw: string | null
  fileName: string | null
}

export function SvgPreview({ raw, fileName }: Props) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!raw) {
      setUrl(null)
      return
    }
    const blob = new Blob([raw], { type: 'image/svg+xml' })
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [raw])

  if (!url) return null

  return (
    <div className="workspace-preview">
      <img
        className="workspace-preview__img"
        src={url}
        alt={fileName ? `${fileName} önizleme` : 'SVG önizleme'}
        draggable={false}
      />
    </div>
  )
}
