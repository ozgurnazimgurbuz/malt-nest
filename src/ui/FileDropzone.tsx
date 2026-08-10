import { useId, useRef, useState, type DragEvent, type ChangeEvent } from 'react'

type Props = {
  fileName: string | null
  onFile: (file: File) => void
}

export function FileDropzone({ fileName, onFile }: Props) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function takeFile(file: File | undefined) {
    if (file) onFile(file)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    takeFile(e.dataTransfer.files[0])
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    takeFile(e.target.files?.[0])
    e.target.value = ''
  }

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--active' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <p className="dropzone__label">SVG yükle</p>
      <p className="dropzone__hint">Sürükle bırak veya seç</p>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => inputRef.current?.click()}
      >
        Dosya seç
      </button>
      <input
        id={inputId}
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".svg,image/svg+xml"
        onChange={onChange}
      />
      {fileName && <p className="dropzone__file">{fileName}</p>}
    </div>
  )
}
